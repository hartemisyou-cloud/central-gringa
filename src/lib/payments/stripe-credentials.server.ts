import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { HHB_STORE_SLUG } from "@/lib/catalog/hhb";
import { decryptSecret, sha256Hex } from "./crypto.server";
import { CheckoutFailure, classifyCheckoutFailure, logCheckoutFailure } from "./checkout-diagnostics.server";
import { StripeService } from "./stripe.server";

export type StripeEnvironment = "test" | "live";
type CredentialPurpose = "checkout" | "webhook" | "binding";
export interface StripeCredentialIntegration {
  id: string;
  status: string;
  environment: StripeEnvironment;
  secret_key_ciphertext: string | null;
  webhook_secret_ciphertext: string | null;
  stripe_account_id?: string | null;
}
export interface ResolvedStripeCredentials {
  source: "database" | "environment";
  integrationId: string | null;
  environment: StripeEnvironment;
  secretKey: string;
  webhookSecret: string;
}
type CheckoutStore = { id: string; name?: string; environment: StripeEnvironment; stripe_integration_id: string | null };

function validSecret(key: string, environment: StripeEnvironment): boolean {
  return new RegExp(`^(sk|rk)_${environment}_[A-Za-z0-9]+$`).test(key);
}
function validWebhook(key: string): boolean {
  return /^whsec_[A-Za-z0-9]+$/.test(key);
}

/** One priority rule for purchase, verified webhook and Admin diagnostics. Never persists environment secrets. */
export async function resolveStripeCredentials(input: {
  integration: StripeCredentialIntegration | null;
  environment: StripeEnvironment;
  env?: NodeJS.ProcessEnv;
  purpose?: CredentialPurpose;
}): Promise<ResolvedStripeCredentials> {
  const { integration, environment } = input;
  const env = input.env ?? process.env;
  const purpose = input.purpose ?? "checkout";
  const needsSecret = purpose !== "webhook", needsWebhook = purpose !== "binding";
  // Retired integrations must still confirm their already-open purchases.
  if (integration && (purpose !== "checkout" || integration.status === "ACTIVE") && integration.environment === environment
      && (!needsSecret || integration.secret_key_ciphertext) && (!needsWebhook || integration.webhook_secret_ciphertext)) {
    try {
      const [secretKey, webhookSecret] = await Promise.all([
        needsSecret ? decryptSecret(integration.secret_key_ciphertext!) : Promise.resolve(""),
        needsWebhook ? decryptSecret(integration.webhook_secret_ciphertext!) : Promise.resolve(""),
      ]);
      if ((needsSecret && !validSecret(secretKey, environment)) || (needsWebhook && !validWebhook(webhookSecret))) throw new Error("Stored Stripe credentials have an invalid format or environment.");
      return { source: "database", integrationId: integration.id, environment, secretKey, webhookSecret };
    } catch (error) {
      logCheckoutFailure(new CheckoutFailure(classifyCheckoutFailure(error, "decrypt_failed"), "stripe_credentials.decrypt", error), "stripe_credentials.decrypt");
    }
  }
  const secretKey = env["STRIPE_SECRET_KEY"];
  const webhookSecret = env["STRIPE_WEBHOOK_SECRET"];
  if (!secretKey || !webhookSecret) {
    throw new CheckoutFailure(integration ? "missing_env" : "no_stripe_integration", "stripe_credentials.environment", new Error("No usable database integration; STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are required for environment fallback."));
  }
  if (!validSecret(secretKey, environment) || !validWebhook(webhookSecret)) {
    throw new CheckoutFailure("missing_env", "stripe_credentials.environment", new Error("Stripe environment credentials have an invalid format or do not match the store environment."));
  }
  return { source: "environment", integrationId: integration?.id ?? null, environment, secretKey, webhookSecret };
}

async function readIntegration(integrationId: string): Promise<StripeCredentialIntegration | null> {
  const result = await supabaseAdmin.from("stripe_integrations").select("*").eq("id", integrationId).maybeSingle();
  if (result.error) throw new CheckoutFailure("db_unreachable", "stripe_credentials.integration_lookup", result.error);
  return result.data;
}

export async function verifyEnvironmentAccount(credentials: ResolvedStripeCredentials, integration: StripeCredentialIntegration, purpose: CredentialPurpose = "checkout") {
  if ((purpose === "checkout" && integration.status !== "ACTIVE") || integration.environment !== credentials.environment || !integration.stripe_account_id) {
    throw new CheckoutFailure("no_stripe_integration", "stripe_credentials.account_binding", new Error("The existing integration needs an ACTIVE account binding in the store environment."));
  }
  let account;
  try {
    account = await new StripeService(credentials.secretKey).retrieveAccount();
  } catch (error) {
    throw new CheckoutFailure("stripe_error", "stripe_credentials.account_lookup", error);
  }
  if (account.id !== integration.stripe_account_id) {
    throw new CheckoutFailure("no_stripe_integration", "stripe_credentials.account_binding", new Error("Environment credentials belong to a different Stripe account than the persisted integration."));
  }
}

/** Allows Admin to configure the webhook before the first environment-backed purchase. */
export async function environmentStripeIntegrationId(store: Pick<CheckoutStore, "id" | "environment">): Promise<string> {
  const digest = await sha256Hex(`hhb-env-stripe:${store.id}:${store.environment}`);
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

/** Stable non-secret identity for FK/session/webhook binding; account changes require an explicit Admin change. */
async function bootstrapEnvironmentIntegration(store: CheckoutStore, credentials: ResolvedStripeCredentials): Promise<string> {
  let account;
  try {
    account = await new StripeService(credentials.secretKey).retrieveAccount();
  } catch (error) {
    throw new CheckoutFailure("stripe_error", "stripe_credentials.account_lookup", error);
  }
  if (!/^acct_[A-Za-z0-9]+$/.test(account.id)) throw new CheckoutFailure("stripe_error", "stripe_credentials.account_lookup", new Error("Stripe returned an invalid account identifier."));
  const integrationId = await environmentStripeIntegrationId(store);
  const inserted = await supabaseAdmin.from("stripe_integrations").upsert({
    id: integrationId, name: `${store.name ?? "Hope Human Books"} (${store.environment}; Vercel environment)`,
    environment: store.environment, status: "ACTIVE", stripe_account_id: account.id,
    publishable_key: "", secret_key_ciphertext: null, webhook_secret_ciphertext: null,
    last_validated_at: new Date().toISOString(),
  }, { onConflict: "id", ignoreDuplicates: true });
  if (inserted.error) throw new CheckoutFailure("db_unreachable", "stripe_credentials.integration_bootstrap", inserted.error);
  const integration = await readIntegration(integrationId);
  if (!integration || integration.status !== "ACTIVE" || integration.environment !== store.environment || integration.stripe_account_id !== account.id || integration.secret_key_ciphertext || integration.webhook_secret_ciphertext) {
    throw new CheckoutFailure("no_stripe_integration", "stripe_credentials.integration_bootstrap", new Error("Environment integration identity conflicts with an existing binding."));
  }
  // Compare-and-set: a concurrent Admin save or checkout wins without being overwritten.
  const linked = await supabaseAdmin.from("stores").update({ stripe_integration_id: integrationId }).eq("id", store.id).is("stripe_integration_id", null);
  if (linked.error) throw new CheckoutFailure("db_unreachable", "stripe_credentials.store_binding", linked.error);
  const reread = await supabaseAdmin.from("stores").select("stripe_integration_id, environment").eq("id", store.id).maybeSingle();
  if (reread.error) throw new CheckoutFailure("db_unreachable", "stripe_credentials.store_binding", reread.error);
  if (reread.data?.stripe_integration_id !== integrationId || reread.data.environment !== store.environment) {
    throw new CheckoutFailure("no_stripe_integration", "stripe_credentials.store_binding", new Error("The store integration changed concurrently; retry with the current binding."));
  }
  return integrationId;
}

export async function resolveStoreStripeCredentials(store: CheckoutStore, loadedIntegration?: StripeCredentialIntegration | null): Promise<ResolvedStripeCredentials & { integrationId: string }> {
  const integration = loadedIntegration === undefined && store.stripe_integration_id ? await readIntegration(store.stripe_integration_id) : loadedIntegration ?? null;
  if (store.stripe_integration_id && (!integration || integration.id !== store.stripe_integration_id)) throw new CheckoutFailure("no_stripe_integration", "stripe_credentials.store_binding", new Error("The store integration is missing or mismatched."));
  const credentials = await resolveStripeCredentials({ integration, environment: store.environment });
  if (credentials.source === "database" && credentials.integrationId) return { ...credentials, integrationId: credentials.integrationId };
  if (integration) {
    await verifyEnvironmentAccount(credentials, integration);
    return { ...credentials, integrationId: integration.id };
  }
  return { ...credentials, integrationId: await bootstrapEnvironmentIntegration(store, credentials) };
}

export async function resolveIntegrationStripeCredentials(integrationId: string, purpose: "webhook" | "binding" = "binding"): Promise<ResolvedStripeCredentials & { integrationId: string }> {
  const integration = await readIntegration(integrationId);
  if (!integration) throw new CheckoutFailure("no_stripe_integration", "stripe_credentials.integration_lookup", new Error("Stripe integration not found."));
  const bookstoreBinding = async () => {
    const store = await supabaseAdmin.from("stores").select("id").eq("slug", HHB_STORE_SLUG).eq("stripe_integration_id", integrationId).eq("environment", integration.environment).maybeSingle();
    if (store.error) throw new CheckoutFailure("db_unreachable", "stripe_credentials.store_binding", store.error);
    return Boolean(store.data);
  };
  const isBookstore = integration.status === "ACTIVE" ? await bookstoreBinding() : undefined;
  // An ACTIVE bookstore uses one complete pair throughout checkout, binding and
  // webhook verification. A partially configured DB pair must never mix with env.
  // Retired integrations and other stores retain their original per-purpose keys.
  const credentials = await resolveStripeCredentials({ integration, environment: integration.environment, purpose: isBookstore ? "checkout" : purpose });
  if (credentials.source === "environment") {
    if (!(isBookstore ?? await bookstoreBinding())) throw new CheckoutFailure("no_stripe_integration", "stripe_credentials.store_binding", new Error("Environment fallback integration is not bound to the bookstore."));
    await verifyEnvironmentAccount(credentials, integration, purpose);
  }
  return { ...credentials, integrationId };
}
