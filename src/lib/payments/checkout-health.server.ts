import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { HHB_PRODUCTS, HHB_STORE_SLUG } from "@/lib/catalog/hhb";
import { requireAdmin } from "@/lib/admin/session.server";
import type { Database } from "@/integrations/supabase/types";
import { decryptSecret, randomToken } from "./crypto.server";
import { buildPurchaseSessionRequest } from "./purchase.server";
import { resolveStripeCredentials, verifyEnvironmentAccount, environmentStripeIntegrationId } from "./stripe-credentials.server";
import { StripeService } from "./stripe.server";
import { safePurchaseCheckoutUrl } from "@/lib/catalog/purchase";
import { CheckoutFailure, logCheckoutFailure, safeCheckoutError } from "./checkout-diagnostics.server";

export const CHECKOUT_ENV_NAMES = [
  "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_PUBLISHABLE_KEY",
  "PAYMENTS_ENCRYPTION_KEY", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET",
] as const;

type Product = Database["public"]["Tables"]["products"]["Row"];
type Order = Database["public"]["Tables"]["orders"]["Row"];
type Failure = { stage: ReturnType<typeof logCheckoutFailure>; operation: string; message: string };

function failure(error: unknown, operation: string): Failure {
  return { stage: logCheckoutFailure(error, operation), operation: error instanceof CheckoutFailure ? error.operation : operation, message: safeCheckoutError(error) };
}

function serviceRoleConfigured(): boolean {
  const key = process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "";
  if (key.startsWith("sb_secret_")) return true;
  // This checks the declared role only; Supabase verifies the JWT signature.
  try { return JSON.parse(atob(key.split(".")[1]?.replace(/-/g, "+").replace(/_/g, "/") ?? "")).role === "service_role"; }
  catch { return false; }
}

function matchesProduct(row: Product | undefined, expected: (typeof HHB_PRODUCTS)[number]): row is Product {
  return !!row && row.active && row.weight_grams === 0 && row.sku === expected.sku
    && row.currency === "USD" && row.price_cents === expected.priceCents;
}

/** A real, unpaid TEST Session. No orders, stock, customers or local payment rows. */
export async function runCheckoutHealth(origin: string) {
  const defined = CHECKOUT_ENV_NAMES.filter(name => !!process.env[name]?.trim());
  const report = {
    environment: { defined, missing: CHECKOUT_ENV_NAMES.filter(name => !defined.includes(name)) },
    supabase: { connected: false, service_role: false, error: null as Failure | null },
    catalog: { slug: "little-women", checked: false, exists: false, error: null as Failure | null },
    integration: {
      checked: false, exists: false, secret_decrypted: false, webhook_decrypted: false,
      source: null as "database" | "environment" | null, webhook_path: null as string | null,
      decryption_error: null as Failure | null,
      error: null as Failure | null,
    },
    dry_run: { environment: "test", checked: false, url_session_created: false, error: null as Failure | null },
  };
  let store: Database["public"]["Tables"]["stores"]["Row"] | null = null;
  try {
    if (!process.env["SUPABASE_URL"] || !process.env["SUPABASE_SERVICE_ROLE_KEY"] || !serviceRoleConfigured()) {
      throw new CheckoutFailure("missing_env", "health.supabase", new Error("SUPABASE_URL and a privileged SUPABASE_SERVICE_ROLE_KEY are required."));
    }
    const result = await supabaseAdmin.from("stores").select("*").eq("slug", HHB_STORE_SLUG).maybeSingle();
    if (result.error) throw new CheckoutFailure("db_unreachable", "health.supabase", result.error);
    report.supabase.connected = true;
    report.supabase.service_role = true;
    store = result.data;
  } catch (error) {
    report.supabase.error = failure(error, "health.supabase");
    return report;
  }

  const littleWomen = HHB_PRODUCTS.find(p => p.slug === "little-women")!;
  const tomSawyer = HHB_PRODUCTS.find(p => p.slug === "the-adventures-of-tom-sawyer")!;
  let diagnosticProduct: Product;
  report.catalog.checked = true;
  try {
    if (!store || store.status !== "ACTIVE") throw new CheckoutFailure("db_unreachable", "health.catalog", new Error("The active Hope Human Books store is missing from the database."));
    const result = await supabaseAdmin.from("products").select("*").eq("store_id", store.id).in("id", [littleWomen.id, tomSawyer.id]);
    if (result.error) throw new CheckoutFailure("db_unreachable", "health.catalog", result.error);
    report.catalog.exists = matchesProduct(result.data?.find(p => p.id === littleWomen.id), littleWomen);
    const product = result.data?.find(p => p.id === tomSawyer.id);
    if (!report.catalog.exists || !matchesProduct(product, tomSawyer)) throw new CheckoutFailure("db_unreachable", "health.catalog", new Error("Catalog rows are missing, inactive or differ from the trusted manifest. Apply the catalog seed after restoring the schema."));
    diagnosticProduct = product;
  } catch (error) {
    report.catalog.error = failure(error, "health.catalog");
    return report;
  }

  report.integration.checked = true;
  let credentials: Awaited<ReturnType<typeof resolveStripeCredentials>>;
  try {
    const integrationId = store!.stripe_integration_id ?? await environmentStripeIntegrationId(store!);
    report.integration.webhook_path = `/api/public/webhooks/stripe/${integrationId}`;
    const result = store!.stripe_integration_id
      ? await supabaseAdmin.from("stripe_integrations").select("*").eq("id", store!.stripe_integration_id).maybeSingle()
      : { data: null, error: null };
    if (result.error) throw new CheckoutFailure("db_unreachable", "health.integration", result.error);
    const integration = result.data;
    report.integration.exists = !!integration;
    if (store!.stripe_integration_id && !integration) throw new CheckoutFailure("no_stripe_integration", "health.integration", new Error("The store's persisted integration is missing."));
    if (integration?.secret_key_ciphertext || integration?.webhook_secret_ciphertext) {
      try {
        if (integration.secret_key_ciphertext) { await decryptSecret(integration.secret_key_ciphertext); report.integration.secret_decrypted = true; }
        if (integration.webhook_secret_ciphertext) { await decryptSecret(integration.webhook_secret_ciphertext); report.integration.webhook_decrypted = true; }
      } catch (error) {
        const stage = process.env["PAYMENTS_ENCRYPTION_KEY"] && process.env["PAYMENTS_ENCRYPTION_KEY"]!.length >= 32 ? "decrypt_failed" : "missing_env";
        report.integration.decryption_error = failure(new CheckoutFailure(stage, "health.decrypt", error), "health.decrypt");
      }
    }
    credentials = await resolveStripeCredentials({ integration, environment: store!.environment });
    report.integration.source = credentials.source;
    if (credentials.source === "environment" && integration) {
      await verifyEnvironmentAccount(credentials, integration);
    } else if (credentials.source === "environment") {
      const account = await new StripeService(credentials.secretKey).retrieveAccount();
      if (!/^acct_[A-Za-z0-9]+$/.test(account.id)) throw new CheckoutFailure("stripe_error", "health.account_binding", new Error("Stripe returned an invalid account identifier."));
    }
  } catch (error) {
    report.integration.error = failure(error, "health.integration");
    return report;
  }

  report.dry_run.checked = true;
  try {
    if (credentials.environment !== "test" || !/^(sk|rk)_test_/.test(credentials.secretKey)) {
      throw new CheckoutFailure("stripe_error", "health.test_mode", new Error("Dry-run requires a TEST store and TEST credential. No Checkout Session was requested."));
    }
    const now = new Date().toISOString();
    const order: Order = {
      id: crypto.randomUUID(), store_id: store!.id, order_number: `ORD-HEALTH-${randomToken(12)}`,
      public_token: randomToken(32), status: "PENDING_PAYMENT", environment: "test", currency: "USD",
      total_cents: 2000, subtotal_cents: 2000, shipping_cents: 0, discount_cents: 0,
      customer_id: null, shipping_address_id: null, shipping_method: "Digital delivery",
      stock_reserved: false, stock_committed: false, created_at: now, updated_at: now, paid_at: null,
    };
    const session = await new StripeService(credentials.secretKey).createCheckoutSession(
      buildPurchaseSessionRequest(order, diagnosticProduct, origin), `checkout-health:${order.id}`,
    );
    if (session.livemode !== false || session.status !== "open" || session.metadata?.["order_id"] !== order.id) {
      throw new CheckoutFailure("stripe_error", "health.session_binding", new Error("Stripe returned an unexpected Session mode, status or binding."));
    }
    safePurchaseCheckoutUrl(session.url);
    report.dry_run.url_session_created = true;
  } catch (error) {
    report.dry_run.error = failure(error instanceof CheckoutFailure ? error : new CheckoutFailure("stripe_error", "health.stripe_session", error), "health.stripe_session");
  }
  return report;
}

export async function checkoutHealthResponse(origin: string): Promise<Response> {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store", "Vary": "Cookie", "X-Robots-Tag": "noindex" };
  try {
    await requireAdmin();
  } catch (error) {
    return new Response(JSON.stringify({ error: "Admin authentication required." }), { status: error instanceof Error && "code" in error && error.code === "UNAUTHORIZED" ? 401 : 503, headers });
  }
  const report = await runCheckoutHealth(origin);
  return new Response(JSON.stringify(report), { status: report.dry_run.url_session_created ? 200 : 503, headers });
}
