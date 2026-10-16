import { sql, one, rows, count } from "@/lib/db/client.server";
import type { Database } from "@/lib/db/types";
import { requireAdmin } from "@/lib/admin/session.server";
import { EBOOK_PREFIX, HHB_STORE_ID, HHB_WORKS } from "@/lib/catalog/hhb";
import { get } from "@vercel/blob";
import { PURCHASE_ENTRY_SLUGS, purchaseEntryProduct } from "./purchase-entry";
import { decryptSecret, randomToken } from "./crypto.server";
import { buildEbookCheckoutSessionParams, checkoutIdempotencyKey, validateEbookCheckoutSession } from "./checkout-session.server";
import { StripeService } from "./stripe.server";
import { CheckoutFailure, classifyCheckoutFailure, logCheckoutFailure, safeCheckoutError } from "./checkout-log.server";

export const CHECKOUT_ENV_NAMES = ["DATABASE_URL", "PAYMENTS_ENCRYPTION_KEY", "BLOB_STORE_ID", "BLOB_READ_WRITE_TOKEN", "ADMIN_PANEL_PASSWORD", "ADMIN_SESSION_SECRET"] as const;
type Product = Database["public"]["Tables"]["products"]["Row"];
type Store = Database["public"]["Tables"]["stores"]["Row"];
type Integration = Database["public"]["Tables"]["stripe_integrations"]["Row"];
type Failure = { stage: ReturnType<typeof classifyCheckoutFailure>; operation: string; message: string };

function failure(error: unknown, operation: string): Failure {
  return { stage: logCheckoutFailure(error, operation), operation: error instanceof CheckoutFailure ? error.operation : operation, message: safeCheckoutError(error) };
}

/** Read-only infrastructure checks and ONE unpaid TEST Session; never changes local financial state. */
export async function runCheckoutHealth(origin: string) {
  const defined = CHECKOUT_ENV_NAMES.filter(name => !!process.env[name]?.trim());
  const report = {
    environment: { defined, missing: CHECKOUT_ENV_NAMES.filter(name => !defined.includes(name)) },
    postgres: { connected: false, error: null as Failure | null },
    catalog: {
      checked: false, count: 0, store_count: 0,
      slugs: PURCHASE_ENTRY_SLUGS.map(slug => ({ slug, sku: purchaseEntryProduct(slug)!.sku, resolves: false })),
      error: null as Failure | null,
    },
    integration: { checked: false, exists: false, environment: null as string | null, secret_decrypted: false, publishable_key_present: false, webhook_decrypted: false, error: null as Failure | null },
    blob: { accessible: false, error: null as Failure | null },
    dry_run: { environment: "test", slug: "little-women", checked: false, amount_cents: null as number | null, session_created: false, error: null as Failure | null },
  };
  let store: Store | null = null;
  let littleWomen: Product | undefined;
  let secretKey: string | undefined;
  try {
    if (!process.env["DATABASE_URL"]?.trim()) throw new CheckoutFailure("missing_env", "health.postgres", new Error("DATABASE_URL is required on the server."));
    const result = await one<{ ok: number }>(sql`select 1 as ok`);
    if (result.error || result.data?.ok !== 1) throw new CheckoutFailure("db_unreachable", "health.postgres", result.error);
    report.postgres.connected = true;
  } catch (error) { report.postgres.error = failure(error, "health.postgres"); }

  if (report.postgres.connected) {
    report.catalog.checked = true;
    try {
      const [total, storeResult, products] = await Promise.all([
        count(sql`select count(*) as count from public.products`),
        one<Store>(sql`select * from public.stores where id = ${HHB_STORE_ID}`, true),
        rows<Product>(sql`select * from public.products where store_id = ${HHB_STORE_ID}`),
      ]);
      for (const result of [total, storeResult, products]) if (result.error) throw new CheckoutFailure("db_unreachable", "health.catalog", result.error);
      report.catalog.count = total.count ?? 0;
      report.catalog.store_count = products.data!.length;
      store = storeResult.data;
      report.catalog.slugs = report.catalog.slugs.map(entry => {
        const expected = purchaseEntryProduct(entry.slug)!;
        const row = products.data!.find(product => product.id === expected.id);
        return { ...entry, resolves: !!row && row.active && row.slug === entry.slug && row.sku === expected.sku && row.weight_grams === 0 && row.currency === "USD" };
      });
      littleWomen = products.data!.find(product => product.id === purchaseEntryProduct("little-women")!.id);
      if (!store || store.status !== "ACTIVE" || report.catalog.slugs.some(entry => !entry.resolves)) throw new CheckoutFailure("db_unreachable", "health.catalog", new Error("Active bookstore or one of the six digital catalog entries is missing or invalid."));
    } catch (error) { report.catalog.error = failure(error, "health.catalog"); }
  }

  if (store && !report.catalog.error) {
    report.integration.checked = true;
    try {
      const result = store.stripe_integration_id
        ? await one<Integration>(sql`select * from public.stripe_integrations where id = ${store!.stripe_integration_id}`, true)
        : { data: null, error: null };
      if (result.error) throw new CheckoutFailure("db_unreachable", "health.integration", result.error);
      const integration = result.data;
      report.integration.exists = !!integration;
      report.integration.environment = integration?.environment ?? null;
      if (!integration || integration.status !== "ACTIVE" || integration.environment !== store.environment || !integration.secret_key_ciphertext || !integration.webhook_secret_ciphertext) throw new CheckoutFailure("no_stripe_integration", "health.integration", new Error("An active matching database Stripe integration and webhook signing secret are required."));
      report.integration.publishable_key_present = integration.publishable_key.startsWith(`pk_${integration.environment}_`);
      if (!report.integration.publishable_key_present) throw new CheckoutFailure("no_stripe_integration", "health.integration", new Error("The database integration is missing a matching publishable key for Elements."));
      try {
        secretKey = await decryptSecret(integration.secret_key_ciphertext);
        report.integration.secret_decrypted = true;
        const webhookSecret = await decryptSecret(integration.webhook_secret_ciphertext);
        report.integration.webhook_decrypted = webhookSecret.startsWith("whsec_");
      } catch (error) { throw new CheckoutFailure(classifyCheckoutFailure(error, "decrypt_failed"), "health.decrypt", error); }
      if (!new RegExp(`^(sk|rk)_${integration.environment}_[A-Za-z0-9]+$`).test(secretKey) || !report.integration.webhook_decrypted) throw new CheckoutFailure("no_stripe_integration", "health.integration", new Error("Decrypted database credentials have an invalid format or mode."));
    } catch (error) { secretKey = undefined; report.integration.error = failure(error, "health.integration"); }
  }

  try {
    if (!process.env["BLOB_STORE_ID"] && !process.env["BLOB_READ_WRITE_TOKEN"]) throw new CheckoutFailure("missing_env", "health.blob", new Error("Private Blob requires BLOB_STORE_ID with Vercel OIDC, or BLOB_READ_WRITE_TOKEN."));
    const object = await get(`${EBOOK_PREFIX}${HHB_WORKS[0]!.file}`, { access: "private" });
    if (object?.statusCode !== 200) throw new Error("The private ebook object is unavailable.");
    await object.stream.cancel();
    report.blob.accessible = true;
  } catch (error) { report.blob.error = failure(error instanceof CheckoutFailure ? error : new CheckoutFailure("blob_error", "health.blob", error), "health.blob"); }

  if (store && littleWomen && secretKey && !report.catalog.error && report.blob.accessible) {
    report.dry_run.checked = true;
    try {
      if (store.environment !== "test" || report.integration.environment !== "test" || !/^(sk|rk)_test_/.test(secretKey)) throw new CheckoutFailure("stripe_error", "health.test_mode", new Error("Dry-run requires TEST database integration credentials. No Stripe Session was requested."));
      const order = { id: crypto.randomUUID(), store_id: store.id, order_number: `ORD-HEALTH-${randomToken(12)}`,
        environment: "test" as const, customer_id: null, public_token: randomToken(32),
        total_cents: littleWomen.price_cents, currency: littleWomen.currency };
      const items = [{ product_id: littleWomen.id, product_name: littleWomen.name, sku: littleWomen.sku, quantity: 1,
        unit_price_cents: littleWomen.price_cents, total_cents: littleWomen.price_cents }];
      const params = buildEbookCheckoutSessionParams({ order, items, products: [littleWomen], slug: "little-women", origin, createdAt: new Date() });
      report.dry_run.amount_cents = littleWomen.price_cents;
      const session = await new StripeService(secretKey).createCheckoutSession(params, checkoutIdempotencyKey(order.id, 1));
      validateEbookCheckoutSession(session, order, params.metadata);
      report.dry_run.session_created = true;
    } catch (error) { report.dry_run.error = failure(error instanceof CheckoutFailure ? error : new CheckoutFailure("stripe_error", "health.session_create", error), "health.session_create"); }
  }
  return report;
}

export async function checkoutHealthResponse(origin: string): Promise<Response> {
  const headers = { "content-type": "application/json", "cache-control": "no-store", "vary": "Cookie", "x-robots-tag": "noindex" };
  try { await requireAdmin(); }
  catch (error) {
    return new Response(JSON.stringify({ error: "Admin authentication required." }), { status: error instanceof Error && "code" in error && error.code === "UNAUTHORIZED" ? 401 : 503, headers });
  }
  const report = await runCheckoutHealth(origin);
  return new Response(JSON.stringify(report), { status: report.dry_run.session_created ? 200 : 503, headers });
}
