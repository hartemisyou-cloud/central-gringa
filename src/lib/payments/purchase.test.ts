import { beforeEach, describe, expect, it, vi } from "vitest";
import { HHB_PRODUCTS } from "@/lib/catalog/hhb";
import { purchaseProduct, safePurchaseCheckoutUrl } from "@/lib/catalog/purchase";

const mocks = vi.hoisted(() => ({ from: vi.fn(), createOrder: vi.fn(), createSession: vi.fn(), retrieve: vi.fn() }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: mocks.from } }));
vi.mock("./crypto.server", () => ({ decryptSecret: vi.fn(async () => "mock-only") }));
vi.mock("./stripe.server", () => ({ StripeService: class { createCheckoutSession = mocks.createSession; retrieveCheckoutSession = mocks.retrieve; } }));
vi.mock("./orders.server", async (original) => ({ ...await original<typeof import("./orders.server")>(), createOrder: mocks.createOrder }));
vi.mock("@/lib/meta/config.server", () => ({ getPublicMetaConfig: vi.fn(async () => ({ pixelId: "pixel-mock", enabled: true })) }));
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
const integration = { id: "integration", status: "ACTIVE", environment: "test", secret_key_ciphertext: "fixture", webhook_secret_ciphertext: "fixture" };
const session = { id: "cs_mock", status: "open", livemode: false, metadata: { order_id: "order" }, payment_intent: "pi_mock", url: "https://checkout.stripe.com/c/pay/cs_mock", expires_at: 2000000000 };

function queue(...results: Array<{ data?: unknown; error?: unknown }>) {
  mocks.from.mockImplementation(() => {
    const result = { error: null, ...results.shift() };
    const builder: Record<string, unknown> = { then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve) };
    for (const method of ["select", "eq", "maybeSingle", "single", "insert", "update"]) builder[method] = () => builder;
    return builder;
  });
}
beforeEach(() => { vi.clearAllMocks(); mocks.createOrder.mockResolvedValue({ order }); mocks.createSession.mockResolvedValue(session); mocks.retrieve.mockResolvedValue(session); });

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
    const viaRequest = buildPurchaseSessionRequest(order, product, "https://hopehumanbooks.com", true);
    expect(viaRequest["success_url"]).toBe(`https://hopehumanbooks.com/order/${order.public_token}?via=hhf`);
    expect(viaRequest["cancel_url"]).toBe(`https://hopehumanbooks.com/order/${order.public_token}`);
    expect(JSON.stringify(viaRequest)).not.toMatch(/campaign|donation|hopehumanfoundation|transfer_data|on_behalf_of/);
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
    queue({ data: saved }, { data: integration }, { data: { id: "payment", environment: "test", provider_payment_id: null } }, {});
    const event = { id: "pi_mock", amount: 3000, currency: "usd", metadata: { order_id: "order" } };
    expect(await bindPurchaseIntent(event, { integrationId: "integration", livemode: false })).toMatchObject({ provider_payment_id: "pi_mock" });
    queue({ data: saved }, { data: integration });
    await expect(bindPurchaseIntent({ ...event, amount: 1 }, { integrationId: "integration", livemode: false })).rejects.toThrow("mismatch");
    expect(await bindPurchaseIntent(event)).toBeNull();
  });
  it("rejects unsafe checkout destinations", () => {
    for (const url of [null, "javascript:alert(1)", "https://checkout.stripe.com.evil.test/x", "https://user@checkout.stripe.com/x", "https://checkout.stripe.com:444/x"]) expect(() => safePurchaseCheckoutUrl(url)).toThrow();
  });
});