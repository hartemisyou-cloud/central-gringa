import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { PaymentError } from "@/lib/payments/errors";
import { encryptSecret, lastFour } from "@/lib/payments/crypto.server";
import { StripeService } from "@/lib/payments/stripe.server";

/**
 * Stripe integration management (admin only; callers must run requireAdmin first).
 * Secret key and webhook secret are stored only AES-GCM encrypted and are never returned.
 */

export async function listStripeIntegrations() {
  const { data: stores } = await supabaseAdmin
    .from("stores")
    .select("id, name, slug, environment, stripe_integration_id")
    .order("name");
  const ids = (stores ?? []).map((s) => s.stripe_integration_id).filter((v): v is string => Boolean(v));
  const { data: integrations } = ids.length
    ? await supabaseAdmin
        .from("stripe_integrations")
        .select("id, environment, status, stripe_account_id, secret_key_last4, webhook_secret_ciphertext, publishable_key, last_validated_at, connection_error")
        .in("id", ids)
    : { data: [] };
  const byId = new Map((integrations ?? []).map((i) => [i.id, i]));
  return (stores ?? []).map((s) => {
    const i = s.stripe_integration_id ? byId.get(s.stripe_integration_id) : undefined;
    return {
      storeId: s.id,
      storeName: s.name,
      storeSlug: s.slug,
      storeEnvironment: s.environment,
      integration: i
        ? {
            id: i.id,
            environment: i.environment,
            status: i.status,
            accountId: i.stripe_account_id,
            secretKeyLast4: i.secret_key_last4,
            publishableKeyPrefix: i.publishable_key.slice(0, 8),
            hasWebhookSecret: Boolean(i.webhook_secret_ciphertext),
            lastValidatedAt: i.last_validated_at,
            connectionError: i.connection_error,
          }
        : null,
    };
  });
}

export async function saveStripeIntegration(input: {
  storeId: string;
  environment: "test" | "live";
  publishableKey: string;
  secretKey: string;
  webhookSecret?: string | undefined;
}) {
  const env = input.environment;
  if (!input.publishableKey.startsWith(`pk_${env}_`)) {
    throw new PaymentError("INVALID_INPUT", `Publishable key must start with pk_${env}_.`);
  }
  if (!/^(sk|rk)_/.test(input.secretKey) || !input.secretKey.includes(`_${env}_`)) {
    throw new PaymentError("INVALID_INPUT", `Secret key must be an sk_${env}_ or rk_${env}_ key.`);
  }
  if (input.webhookSecret && !input.webhookSecret.startsWith("whsec_")) {
    throw new PaymentError("INVALID_INPUT", "Webhook signing secret must start with whsec_.");
  }

  const { data: store } = await supabaseAdmin
    .from("stores")
    .select("id, name, stripe_integration_id")
    .eq("id", input.storeId)
    .maybeSingle();
  if (!store) throw new PaymentError("NOT_FOUND", "Store not found.");

  // Validates the key against Stripe (read-only call, no charge).
  const account = await new StripeService(input.secretKey).retrieveAccount();

  const patch = {
    name: `${store.name} (${env})`,
    environment: env,
    publishable_key: input.publishableKey,
    secret_key_ciphertext: await encryptSecret(input.secretKey),
    secret_key_last4: lastFour(input.secretKey),
    stripe_account_id: account.id,
    status: "ACTIVE" as const,
    connection_error: null,
    last_validated_at: new Date().toISOString(),
    ...(input.webhookSecret ? { webhook_secret_ciphertext: await encryptSecret(input.webhookSecret) } : {}),
  };

  let integrationId = store.stripe_integration_id;
  if (integrationId) {
    const { error } = await supabaseAdmin.from("stripe_integrations").update(patch).eq("id", integrationId);
    if (error) throw new PaymentError("INVALID_STATE", "Could not update the integration.");
  } else {
    const { data, error } = await supabaseAdmin.from("stripe_integrations").insert(patch).select("id").single();
    if (error || !data) throw new PaymentError("INVALID_STATE", "Could not create the integration.");
    integrationId = data.id;
  }
  await supabaseAdmin
    .from("stores")
    .update({ stripe_integration_id: integrationId, environment: env })
    .eq("id", store.id);

  return { integrationId, accountId: account.id, webhookPath: `/api/public/webhooks/stripe/${integrationId}` };
}
