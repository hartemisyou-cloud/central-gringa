import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HHB_PRODUCTS } from "@/lib/catalog/hhb";
import { purchaseProduct, safePurchaseCheckoutUrl } from "@/lib/catalog/purchase";

const mocks = vi.hoisted(() => ({ from: vi.fn(), createOrder: vi.fn(), createSession: vi.fn(), retrieve: vi.fn(), account: vi.fn(), rpc: vi.fn(), writes: [] as Array<{ table: string; patch: unknown }> }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: mocks.from, rpc: mocks.rpc } }));
vi.mock("./crypto.server", () => ({ decryptSecret: vi.fn(async (cipher: string) => { if (cipher === "broken") throw new Error("Stored secret has an invalid format."); return cipher === "webhook" ? "whsec_Database123" : "sk_test_Database123"; }) }));
vi.mock("./stripe.server", async (original) => ({ ...await original<typeof import("./stripe.server")>(), StripeService: class { createCheckoutSession = mocks.createSession; retrieveCheckoutSession = mocks.retrieve; retrieveAccount = mocks.account; } }));
vi.mock("./orders.server", async (original) => ({ ...await original<typeof import("./orders.server")>(), createOrder: mocks.createOrder }));
vi.mock("@/lib/meta/config.server", () => ({ getPublicMetaConfig: vi.fn(async () => ({ pixelId: "pixel-mock", enabled: true })) }));
vi.mock("@/lib/donations/service.server", () => ({ handleDonationEvent: vi.fn(async () => null) }));
vi.mock("@/lib/analytics/ingest.server", () => ({ recordServerEvent: vi.fn(async () => {}) }));
vi.mock("@/lib/meta/capi.server", () => ({ sendPurchaseForOrder: vi.fn(async () => {}) }));
vi.mock("@/lib/utmify/api.server", () => ({ sendSaleForOrder: vi.fn(async () => {}) }));
import { processStripeWebhook } from "./webhooks.server";
import { buildPurchaseSessionRequest, startPurchase, bindPurchaseIntent } from "./purchase.server";
import type { Database } from "@/integrations/supabase/types";

const manifest = HHB_PRODUCTS.find((p) => p.slug === "little-women");
if (!manifest) throw new Error("Fixture missing");
const product: Database["public"]["Tables"]["products"]["Row"] = {
  id: manifest.id, store_id: "store", name: manifest.name, sku: manifest.sku, slug: manifest.slug,
  description: manifest.description, price_cents: 3000, currency: "USD", active: true,
  stock: 100, reserved_stock: 0, weight_grams: 0, image_url: null, category: "ebook", created_at: "", updated_at: "",
};
const order: Database["public"]["Tables"]["orders"]["Row"] = {
  id: "order", store_id: "store", order_number: "ORD-TEST", public_token: "A".repeat(32), status: "PENDING_PAYMENT",
  environment: "test", currency: "USD", total_cents: 3000, subtotal_cents: 3000, shipping_cents: 0, discount_cents: 0,
  customer_id: null, shipping_address_id: null, shipping_method: "Digital delivery", stock_reserved: true, stock_committed: false,
  created_at: "", updated_at: "", paid_at: null,
};
const store = { id: "store", status: "ACTIVE", environment: "test", stripe_integration_id: "integration" };
const integration = { id: "integration", status: "ACTIVE", environment: "test", secret_key_ciphertext: "fixture", webhook_secret_ciphertext: "webhook", stripe_account_id: "acct_Books123" };
const session = { id: "cs_mock", status: "open", livemode: false, metadata: { order_id: "order" }, payment_intent: "pi_mock", url: "https://checkout.stripe.com/c/pay/cs_mock", expires_at: 2000000000 };

function queue(...results: Array<{ data?: unknown; error?: unknown }>) {
  mocks.from.mockImplementation((table: string) => {
    const result = { error: null, ...results.shift() };
    const builder: Record<string, unknown> = { then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve) };
    for (const method of ["select", "eq", "maybeSingle", "single", "insert", "update"]) builder[method] = (patch: unknown) => { if (method === "insert" || method === "update") mocks.writes.push({ table, patch }); return builder; };
    return builder;
  });
}
beforeEach(() => { vi.clearAllMocks(); mocks.writes.length = 0; vi.stubEnv("STRIPE_SECRET_KEY", ""); vi.stubEnv("STRIPE_WEBHOOK_SECRET", ""); mocks.account.mockResolvedValue({ id: "acct_Books123" }); mocks.rpc.mockResolvedValue({ error: null }); mocks.createOrder.mockResolvedValue({ order }); mocks.createSession.mockResolvedValue(session); mocks.retrieve.mockResolvedValue(session); });

afterEach(() => { vi.unstubAllEnvs(); });

describe("ebook purchase handoff", () => {
  it("maps the six amounts to existing real ebooks and bundles", () => {
    expect(["the-adventures-of-tom-sawyer", "little-women", "adventures-of-huckleberry-finn", "moby-dick", "american-classics-collection", "american-classics-library"].map((slug) => purchaseProduct(slug)?.priceCents)).toEqual([2000, 3000, 5000, 10000, 25000, 50000]);
    expect(purchaseProduct("the-yellow-wallpaper")).toBeUndefined();
  });
  it("uses real order metadata, item and price with Books return URLs", () => {
    const request = buildPurchaseSessionRequest(order, product, "https://hopehumanbooks.com");
    expect(request).toMatchObject({ mode: "payment", submit_type: "pay", metadata: { product_type: "ebook", sku: "HHB-EB-030", order_id: "order" }, line_items: [{ quantity: 1, price_data: { unit_amount: 3000, currency: "usd", product_data: { name: product.name } } }] });
    expect(request["success_url"]).toBe(`https://hopehumanbooks.com/order/${order.public_token}`);
    expect(request["cancel_url"]).toBe(request["success_url"]);
    expect(JSON.stringify(request)).not.toMatch(/campaign|donation|hopehumanfoundation|transfer_data|on_behalf_of/);
  });
  it("creates and persists hosted checkout without fake customer details", async () => {
    queue({ data: store }, { data: product }, { data: integration }, { data: { id: "payment" } }, {}, {});
    expect(await startPurchase("little-women", "https://hopehumanbooks.com")).toEqual({ publicToken: order.public_token, url: session.url, metaPixelId: "pixel-mock", product: { id: product.id, name: product.name, priceCents: 3000, currency: "USD" } });
    expect(mocks.createOrder).toHaveBeenCalledWith({ store, items: [{ productId: product.id, quantity: 1 }], collectCustomerAtCheckout: true, shippingOptionId: "no-shipping" });
    expect(mocks.createSession.mock.calls[0]?.[1]).toBe("ebook-checkout:order:1");
  });
  it("reuses a persisted Session on resume without creating orders or Sessions", async () => {
    queue({ data: store }, { data: product }, { data: integration }, { data: { ...order, order_items: [{ product_id: product.id, quantity: 1 }] } }, { data: { session_id: session.id } });
    await startPurchase("little-women", "https://hopehumanbooks.com", order.public_token);
    expect(mocks.createOrder).not.toHaveBeenCalled(); expect(mocks.createSession).not.toHaveBeenCalled();
  });
  it("fails closed on missing configuration before creating an order", async () => {
    queue({ data: null });
    await expect(startPurchase("little-women", "https://hopehumanbooks.com")).rejects.toThrow("not ready");
    expect(mocks.createOrder).not.toHaveBeenCalled();
  });
  it("rejects product price drift and test/live mismatch", async () => {
    for (const [p, i] of [[{ ...product, price_cents: 1 }, integration], [product, { ...integration, environment: "live" }]]) {
      queue({ data: store }, { data: p }, { data: i });
      await expect(startPurchase("little-women", "https://hopehumanbooks.com")).rejects.toThrow();
    }
    expect(mocks.createOrder).not.toHaveBeenCalled();
  });
  it("only binds a verified event to the matching persisted Session and amount", async () => {
    const saved = { order_id: "order", session_id: session.id, base_amount_cents: 3000, base_currency: "USD" };
    queue({ data: saved }, { data: integration }, { data: { id: store.id } }, { data: { id: "payment", environment: "test", provider_payment_id: null } }, {});
    const event = { id: "pi_mock", amount: 3000, currency: "usd", metadata: { order_id: "order" } };
    expect(await bindPurchaseIntent(event, { integrationId: "integration", livemode: false })).toMatchObject({ provider_payment_id: "pi_mock" });
    queue({ data: saved }, { data: integration }, { data: { id: store.id } });
    await expect(bindPurchaseIntent({ ...event, amount: 1 }, { integrationId: "integration", livemode: false })).rejects.toThrow("mismatch");
    expect(await bindPurchaseIntent(event)).toBeNull();
  });
  it("creates and binds an ebook Checkout using environment keys on the persisted account", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_Environment123"); vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_Environment123");
    const environmentIntegration = { ...integration, secret_key_ciphertext: null, webhook_secret_ciphertext: null };
    queue({ data: store }, { data: product }, { data: environmentIntegration }, { data: { id: "payment" } }, {}, {});
    expect(await startPurchase("little-women", "https://hopehumanbooks.com")).toMatchObject({ url: session.url });
    expect(mocks.writes.find((write) => write.table === "payments")?.patch).toMatchObject({ integration_id: "integration" });
    const saved = { order_id: "order", session_id: session.id, base_amount_cents: 3000, base_currency: "USD" };
    queue({ data: saved }, { data: environmentIntegration }, { data: { id: store.id } }, { data: { id: "payment", environment: "test", provider_payment_id: null } }, {});
    expect(await bindPurchaseIntent({ id: "pi_mock", amount: 3000, currency: "usd", metadata: { order_id: "order" } }, { integrationId: "integration", livemode: false })).toMatchObject({ provider_payment_id: "pi_mock" });
    expect(mocks.account).toHaveBeenCalledTimes(2);
  });
  it.each([
    [null, null], [null, "webhook"], ["broken", "webhook"], ["fixture", null],
  ])("confirms the env credential pair with partial DB ciphers %s / %s only after a signed matching webhook", async (secretCipher, webhookCipher) => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_Environment123"); vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_Environment123");
    const environmentIntegration = { ...integration, secret_key_ciphertext: secretCipher, webhook_secret_ciphertext: webhookCipher };
    const saved = { order_id: "order", session_id: session.id, base_amount_cents: 3000, base_currency: "USD" };
    const payment = { id: "payment", order_id: "order", store_id: "store", integration_id: "integration", environment: "test", status: "PENDING", provider_payment_id: null, amount_cents: 3000, currency: "USD", payment_method: null };
    const object = { id: "pi_mock", amount: 3000, currency: "usd", metadata: { order_id: "order" } };
    const rawBody = JSON.stringify({ id: "evt_mock", type: "payment_intent.succeeded", livemode: false, created: 1, data: { object } });
    const timestamp = Math.floor(Date.now() / 1000);
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("whsec_Environment123"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const signature = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${rawBody}`)))].map((b) => b.toString(16).padStart(2, "0")).join("");
    queue({ data: environmentIntegration }, { data: { id: "store" } }, {}, { data: null }, { data: saved }, { data: environmentIntegration }, { data: { id: "store" } }, { data: payment }, {}, {}, { data: { status: "PENDING_PAYMENT", stock_committed: false } }, {}, {}, {});
    expect(await processStripeWebhook({ integrationId: "integration", rawBody, signature: `t=${timestamp},v1=${signature}` })).toEqual({ status: 200, body: { received: true } });
    expect(mocks.writes).toContainEqual({ table: "orders", patch: expect.objectContaining({ status: "PAID" }) });
    expect(mocks.rpc).toHaveBeenCalledWith("commit_order_stock", { _order_id: "order" });
    mocks.writes.length = 0;
    queue({ data: environmentIntegration }, { data: { id: "store" } });
    await expect(processStripeWebhook({ integrationId: "integration", rawBody, signature: `t=${timestamp},v1=${"0".repeat(64)}` })).rejects.toThrow("Invalid webhook signature");
    expect(mocks.writes).toHaveLength(0);
  });
  it("keeps another store's DB webhook-only integration working without environment fallback", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_Environment123"); vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_Environment123");
    const rawBody = JSON.stringify({ id: "evt_other_store", type: "unhandled.test", livemode: false, created: 1, data: { object: { id: "obj_other" } } });
    const timestamp = Math.floor(Date.now() / 1000);
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("whsec_Database123"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const signature = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${rawBody}`)))].map((b) => b.toString(16).padStart(2, "0")).join("");
    queue({ data: { ...integration, secret_key_ciphertext: null } }, { data: null }, {}, {});
    expect(await processStripeWebhook({ integrationId: "integration", rawBody, signature: `t=${timestamp},v1=${signature}` })).toEqual({ status: 200, body: { received: true } });
    expect(mocks.account).not.toHaveBeenCalled();
    expect(mocks.writes).not.toContainEqual({ table: "orders", patch: expect.objectContaining({ status: "PAID" }) });
  });
  it("rejects unsafe checkout destinations", () => {
    for (const url of [null, "javascript:alert(1)", "https://checkout.stripe.com.evil.test/x", "https://user@checkout.stripe.com/x", "https://checkout.stripe.com:444/x"]) expect(() => safePurchaseCheckoutUrl(url)).toThrow();
  });
});