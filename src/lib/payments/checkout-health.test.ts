import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HHB_PRODUCTS, HHB_STORE_ID } from "@/lib/catalog/hhb";
import { CheckoutFailure } from "./checkout-diagnostics.server";
import { PaymentError } from "./errors";

const mocks = vi.hoisted(() => ({ from: vi.fn(), admin: vi.fn(), resolve: vi.fn(), decrypt: vi.fn(), create: vi.fn(), account: vi.fn() }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: mocks.from } }));
vi.mock("@/lib/admin/session.server", () => ({ requireAdmin: mocks.admin }));
vi.mock("./stripe-credentials.server", async original => ({ ...await original<typeof import("./stripe-credentials.server")>(), resolveStripeCredentials: mocks.resolve }));
vi.mock("./crypto.server", async original => ({ ...await original<typeof import("./crypto.server")>(), decryptSecret: mocks.decrypt }));
vi.mock("./stripe.server", () => ({ StripeService: class { createCheckoutSession = mocks.create; retrieveAccount = mocks.account; } }));
import { CHECKOUT_ENV_NAMES, checkoutHealthResponse } from "./checkout-health.server";

const store = { id: HHB_STORE_ID, status: "ACTIVE", environment: "test", stripe_integration_id: "integration" };
const integration = { id: "integration", environment: "test", status: "ACTIVE", secret_key_ciphertext: "encrypted-api", webhook_secret_ciphertext: "encrypted-webhook", stripe_account_id: "acct_fixture" };
const products = HHB_PRODUCTS.filter(p => ["little-women", "the-adventures-of-tom-sawyer"].includes(p.slug)).map(p => ({
  id: p.id, store_id: HHB_STORE_ID, name: p.name, slug: p.slug, sku: p.sku, price_cents: p.priceCents,
  description: p.description, category: p.category, weight_grams: 0, active: true, currency: "USD",
}));
function queue(...results: Array<{ data?: unknown; error?: unknown }>) {
  mocks.from.mockImplementation(() => {
    const result = { error: null, ...results.shift() };
    const builder: Record<string, unknown> = { then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve) };
    for (const method of ["select", "eq", "maybeSingle", "in"]) builder[method] = () => builder;
    return builder;
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  for (const name of CHECKOUT_ENV_NAMES) vi.stubEnv(name, "");
  vi.stubEnv("SUPABASE_URL", "https://db.example.test");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sb_secret_mockOnlyServiceRole");
  vi.stubEnv("PAYMENTS_ENCRYPTION_KEY", "mock-master-encryption-key-32-chars");
  mocks.admin.mockResolvedValue(undefined);
  mocks.decrypt.mockResolvedValue("mock-decrypted");
  mocks.resolve.mockResolvedValue({ source: "database", integrationId: "integration", environment: "test", secretKey: "sk_test_mockOnlyApiKey", webhookSecret: "whsec_mockOnlySigning" });
  mocks.account.mockResolvedValue({ id: "acct_fixture" });
  mocks.create.mockImplementation(async params => ({ id: "cs_test_fixture", status: "open", livemode: false, metadata: params.metadata, url: "https://checkout.stripe.com/c/pay/cs_test_fixture" }));
  queue({ data: store }, { data: products }, { data: integration });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("authenticated checkout diagnostic", () => {
  it("rejects unauthenticated access before reading the database or creating a Session", async () => {
    mocks.admin.mockRejectedValue(new PaymentError("UNAUTHORIZED", "Expired"));
    const response = await checkoutHealthResponse("https://shop.example.test");
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.from).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({ error: "Admin authentication required." });
  });
  it("reports names in order, decrypts DB credentials and creates exactly one real-request-shaped TEST Session", async () => {
    const response = await checkoutHealthResponse("https://shop.example.test");
    const report = await response.json();
    expect(response.status).toBe(200);
    expect(Object.keys(report)).toEqual(["environment", "supabase", "catalog", "integration", "dry_run"]);
    expect(report.environment.defined).toEqual(["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "PAYMENTS_ENCRYPTION_KEY"]);
    expect(report).toMatchObject({ supabase: { connected: true, service_role: true }, catalog: { slug: "little-women", exists: true }, integration: { exists: true, source: "database", secret_decrypted: true }, dry_run: { environment: "test", url_session_created: true } });
    expect(mocks.create).toHaveBeenCalledTimes(1);
    const [params, key] = mocks.create.mock.calls[0]!;
    expect(params).toMatchObject({ mode: "payment", metadata: { category: "ebook", delivery_type: "digital", item_count: "1", product_type: "ebook", quantity: "1", sku: "HHB-EB-020", product_name: HHB_PRODUCTS.find(p => p.sku === "HHB-EB-020")!.name }, line_items: [{ quantity: 1, price_data: { currency: "usd", unit_amount: 2000 } }] });
    expect(params.payment_intent_data.description).toBe(`Order ${params.metadata.order_number}`);
    expect(params.metadata.order_number).toMatch(/^ORD-HEALTH-/);
    expect(params.payment_intent_data.metadata).toEqual(params.metadata);
    expect(key).toMatch(/^checkout-health:/);
    expect(mocks.from.mock.calls.map(call => call[0])).toEqual(["stores", "products", "stripe_integrations"]);
    expect(JSON.stringify(report)).not.toMatch(/mockOnly|mock-master|db\.example|checkout\.stripe\.com/);
  });
  it("classifies missing/insufficient server credentials without calling Supabase", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sb_publishable_wrongRole");
    const response = await checkoutHealthResponse("https://shop.example.test");
    expect(response.status).toBe(503);
    expect((await response.json()).supabase.error.stage).toBe("missing_env");
    expect(mocks.from).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
  });
  it("classifies an inaccessible or incomplete database and does not create a Session", async () => {
    queue({ error: { message: "Could not find the table public.stores" } });
    const report = await (await checkoutHealthResponse("https://shop.example.test")).json();
    expect(report.supabase.error.stage).toBe("db_unreachable");
    expect(report.catalog.checked).toBe(false); expect(mocks.create).not.toHaveBeenCalled();
  });
  it("identifies catalog drift without altering product mappings or prices", async () => {
    queue({ data: store }, { data: products.map(p => ({ ...p, price_cents: 1 })) });
    const report = await (await checkoutHealthResponse("https://shop.example.test")).json();
    expect(report.catalog).toMatchObject({ exists: false, error: { stage: "db_unreachable", operation: "health.catalog" } });
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it.each(["no_stripe_integration", "decrypt_failed"] as const)("identifies %s and blocks the dry-run", async stage => {
    mocks.resolve.mockRejectedValue(new CheckoutFailure(stage, "credentials.resolve"));
    const report = await (await checkoutHealthResponse("https://shop.example.test")).json();
    expect(report.integration.error.stage).toBe(stage); expect(report.dry_run.checked).toBe(false);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("reports decryption failure while allowing a valid same-account environment fallback", async () => {
    mocks.decrypt.mockRejectedValue(new DOMException("Decrypt failed", "OperationError"));
    mocks.resolve.mockResolvedValue({ source: "environment", integrationId: "integration", environment: "test", secretKey: "sk_test_mockOnlyApiKey", webhookSecret: "whsec_mockOnlySigning" });
    const response = await checkoutHealthResponse("https://shop.example.test");
    const report = await response.json();
    expect(response.status).toBe(200);
    expect(report.integration).toMatchObject({ secret_decrypted: false, source: "environment", decryption_error: { stage: "decrypt_failed" } });
    expect(report.dry_run.url_session_created).toBe(true);
  });
  it("rejects a different fallback account without creating a Session", async () => {
    mocks.resolve.mockResolvedValue({ source: "environment", environment: "test", secretKey: "sk_test_mockOnlyApiKey", webhookSecret: "whsec_mockOnlySigning" });
    mocks.account.mockResolvedValue({ id: "acct_different" });
    const report = await (await checkoutHealthResponse("https://shop.example.test")).json();
    expect(report.integration.error.stage).toBe("no_stripe_integration"); expect(mocks.create).not.toHaveBeenCalled();
  });
  it.each([{ ...integration, status: "INACTIVE" }, { ...integration, environment: "live" }])("does not report a healthy checkout for an unusable existing integration", async invalidIntegration => {
    queue({ data: store }, { data: products }, { data: invalidIntegration });
    mocks.resolve.mockResolvedValue({ source: "environment", environment: "test", secretKey: "sk_test_mockOnlyApiKey", webhookSecret: "whsec_mockOnlySigning" });
    const response = await checkoutHealthResponse("https://shop.example.test");
    const report = await response.json();
    expect(response.status).toBe(503);
    expect(report.integration.error.stage).toBe("no_stripe_integration"); expect(mocks.create).not.toHaveBeenCalled();
  });
  it("exposes a deterministic non-secret webhook path before bootstrap without writing data", async () => {
    queue({ data: { ...store, stripe_integration_id: null } }, { data: products });
    mocks.resolve.mockRejectedValue(new CheckoutFailure("no_stripe_integration", "credentials.environment"));
    const report = await (await checkoutHealthResponse("https://shop.example.test")).json();
    expect(report.integration.webhook_path).toMatch(/^\/api\/public\/webhooks\/stripe\/[a-f0-9-]{36}$/);
    expect(mocks.from.mock.calls.map(call => call[0])).toEqual(["stores", "products"]);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("rejects a missing persisted integration rather than giving a false-positive environment result", async () => {
    queue({ data: store }, { data: products }, { data: null });
    const report = await (await checkoutHealthResponse("https://shop.example.test")).json();
    expect(report.integration.error.stage).toBe("no_stripe_integration"); expect(mocks.resolve).not.toHaveBeenCalled();
  });
  it("checks account-read access before diagnosing an unbound environment integration as healthy", async () => {
    queue({ data: { ...store, stripe_integration_id: null } }, { data: products });
    mocks.resolve.mockResolvedValue({ source: "environment", environment: "test", secretKey: "sk_test_mockOnlyApiKey", webhookSecret: "whsec_mockOnlySigning" });
    mocks.account.mockRejectedValue(new PaymentError("PROVIDER_ERROR", "Account read permission denied."));
    const response = await checkoutHealthResponse("https://shop.example.test");
    const report = await response.json();
    expect(response.status).toBe(503);
    expect(report.integration.error).toMatchObject({ stage: "stripe_error", message: "Account read permission denied." });
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("never calls Stripe Checkout with LIVE credentials", async () => {
    mocks.resolve.mockResolvedValue({ source: "database", environment: "live", secretKey: "sk_live_mockOnlyApiKey", webhookSecret: "whsec_mockOnlySigning" });
    const report = await (await checkoutHealthResponse("https://shop.example.test")).json();
    expect(report.dry_run.error).toMatchObject({ stage: "stripe_error", message: expect.stringContaining("TEST") });
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("returns a redacted Stripe error message without keys or a checkout URL", async () => {
    mocks.create.mockRejectedValue(new PaymentError("PROVIDER_ERROR", "Invalid API Key provided: sk_test_notReal"));
    const response = await checkoutHealthResponse("https://shop.example.test");
    expect(response.status).toBe(503);
    expect((await response.json()).dry_run).toMatchObject({ url_session_created: false, error: { stage: "stripe_error", message: "Invalid API Key provided: [redacted]" } });
  });
});
