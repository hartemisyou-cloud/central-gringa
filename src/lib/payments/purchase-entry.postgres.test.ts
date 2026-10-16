import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { createTestClient } from "@/lib/db/test-client";
import { HHB_PRODUCTS, HHB_STORE_ID, HHB_STORE_SLUG } from "@/lib/catalog/hhb";
import { purchaseEntryProduct, PURCHASE_ENTRY_SLUGS } from "./purchase-entry";

const H = vi.hoisted(() => ({ current: null as Awaited<ReturnType<typeof createTestClient>> | null, fetch: vi.fn(), lastSession: null as Record<string, unknown> | null }));
vi.mock("@/lib/db/client.server", async (original) => {
  const actual = await original<typeof import("@/lib/db/client.server")>();
  return { ...actual, sql: new Proxy(function (...args: unknown[]) {
    return (H.current!.client as unknown as (...args: unknown[]) => unknown)(...args);
  }, { get(_target, key) { const value = Reflect.get(H.current!.client, key); return typeof value === "function" ? value.bind(H.current!.client) : value; } }) };
});
import { buildOrderPaymentMetadata, buildPaymentDescription, createOrder } from "./orders.server";
import { defaultPurchaseEntryDeps, handlePurchaseEntry } from "./purchase-entry.server";
import type { StoreRow } from "./store-auth.server";
import { encryptSecret } from "./crypto.server";
import { createEbookCheckoutSession } from "./checkout-session.server";

const INTEGRATION = "c1000000-0000-4000-8000-000000000002";

const expected = [
  ["the-adventures-of-tom-sawyer", "b0b5e000-4848-4b00-8000-000000000104", "HHB-EB-020", 2000, 1],
  ["little-women", "b0b5e000-4848-4b00-8000-000000000105", "HHB-EB-030", 3000, 1],
  ["adventures-of-huckleberry-finn", "b0b5e000-4848-4b00-8000-000000000106", "HHB-EB-050", 5000, 1],
  ["moby-dick", "b0b5e000-4848-4b00-8000-000000000108", "HHB-EB-100", 10000, 1],
  ["american-classics-collection", "b0b5e000-4848-4b00-8000-000000000110", "HHB-COL-250", 25000, 6],
  ["american-classics-library", "b0b5e000-4848-4b00-8000-000000000111", "HHB-LIB-500", 50000, 10],
] as const;

beforeAll(async () => {
  H.current = await createTestClient();
  await H.current.db.exec(await readFile(new URL("../db/test-schema.sql", import.meta.url), "utf8"));
});
afterAll(async () => { await H.current?.close(); });
beforeEach(async () => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.stubEnv("PAYMENTS_ENCRYPTION_KEY", "checkout-entry-fixture-master-key-32-characters");
  vi.stubGlobal("fetch", H.fetch);
  H.lastSession = null;
  H.fetch.mockImplementation(async (_url: string, init: RequestInit) => {
    if (init.method === "GET") return Response.json(H.lastSession);
    const form = new URLSearchParams(String(init.body));
    const metadata = Object.fromEntries([...form.entries()].filter(([key]) => /^metadata\[/.test(key)).map(([key, value]) => [key.slice(9, -1), value]));
    H.lastSession = { id: "cs_test_Entry123", status: "open", mode: "payment", livemode: false, metadata,
      amount_total: Number(form.get("line_items[0][price_data][unit_amount]")), currency: "usd", url: "https://checkout.stripe.com/c/pay/cs_test_Entry123" };
    return Response.json(H.lastSession);
  });
  await H.current!.db.exec("TRUNCATE stores, stripe_integrations CASCADE; TRUNCATE rate_limit_counters;");
  const q = H.current!.client;
  await q`INSERT INTO stripe_integrations (id,name,environment,publishable_key,secret_key_ciphertext,status)
    VALUES (${INTEGRATION},'Checkout fixture','test','pk_test_Entry123',${await encryptSecret("sk_test_Entry123")},'ACTIVE')`;
  await q`INSERT INTO stores (id,name,slug,environment,currency,status,stripe_integration_id) VALUES (${HHB_STORE_ID},'Hope Human Books',${HHB_STORE_SLUG},'test','USD','ACTIVE',${INTEGRATION})`;
  for (const p of HHB_PRODUCTS) {
    await q`INSERT INTO products (id,store_id,name,slug,sku,price_cents,currency,stock,weight_grams,category)
      VALUES (${p.id},${HHB_STORE_ID},${p.name},${p.slug},${p.sku},${p.priceCents},'USD',100,0,${p.category})`;
  }
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

function request(slug: string, referer?: string): Request {
  return new Request(`https://hopehumanbooks.com/comprar/${slug}?amount=1&campaignSlug=ignored&utm_source=ignored`, {
    headers: { "x-forwarded-for": "1.2.3.4, 9.9.9.9", ...(referer ? { referer } : {}) },
  });
}

describe("fixed ebook entry catalog", () => {
  it("exposes exactly the six requested slugs", () => {
    expect(PURCHASE_ENTRY_SLUGS).toEqual(expected.map(([slug]) => slug));
    expect(purchaseEntryProduct("the-yellow-wallpaper")).toBeUndefined();
    expect(purchaseEntryProduct("unknown")).toBeUndefined();
  });
  it.each(expected)("locks %s to its existing ID and SKU", (slug, id, sku, cents, count) => {
    expect(purchaseEntryProduct(slug)).toMatchObject({ id, sku, priceCents: cents });
    expect(purchaseEntryProduct(slug)!.workIds).toHaveLength(count);
  });
});

describe("ebook payment description and metadata audit", () => {
  const order = { id: "order-id", store_id: HHB_STORE_ID, customer_id: null, order_number: "ORD-20261016-ABC123", environment: "test" };
  it.each(PURCHASE_ENTRY_SLUGS)("uses only operational ebook fields for %s", (slug) => {
    const p = purchaseEntryProduct(slug)!;
    const items = [{ product_id: p.id, product_name: p.name, sku: p.sku, quantity: 1 }];
    const products = [{ id: p.id, category: p.category, weight_grams: 0 }];
    expect(buildPaymentDescription(order, items)).toBe("Order ORD-20261016-ABC123");
    expect(buildOrderPaymentMetadata(order, items, products)).toEqual({
      store_id: HHB_STORE_ID, order_id: "order-id", order_number: "ORD-20261016-ABC123", environment: "test",
      item_count: "1", product_type: "ebook", delivery_type: "digital", sku: p.sku,
      product_name: p.name, quantity: "1", category: "ebook",
    });
  });
  it("retains the collection category for existing customer-backed V1/V2 and storefront orders", () => {
    const p = purchaseEntryProduct("american-classics-collection")!;
    expect(buildOrderPaymentMetadata({ ...order, customer_id: "existing-customer" },
      [{ product_id: p.id, product_name: p.name, sku: p.sku, quantity: 1 }],
      [{ id: p.id, category: "collection", weight_grams: 0 }])["category"]).toBe("collection");
  });
});

describe("GET /comprar with real PostgreSQL order pricing and stock", () => {
  it.each([undefined, "https://hopehumanbooks.com/", "https://example.com/", "https://hopehumanfoundation.org/", "https://www.hopehumanfoundation.org/campaign"])("302 directly to Stripe without a local marker for Referer %s", async (referer) => {
    const response = await handlePurchaseEntry(request("little-women", referer), "little-women", await defaultPurchaseEntryDeps());
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://checkout.stripe.com/c/pay/cs_test_Entry123");
    const body = String(H.fetch.mock.calls[0]![1].body);
    const form = new URLSearchParams(body);
    if (referer?.includes("hopehumanfoundation.org")) {
      expect(form.get("success_url")).toBe("https://www.hopehumanfoundation.org/thank-you?amount=30");
      expect(body.match(/hopehumanfoundation\.org/g)).toHaveLength(1);
    } else {
      expect(form.get("success_url")).toMatch(/^https:\/\/hopehumanbooks\.com\/order\/[^/?#]+$/);
      expect(body).not.toContain("hopehumanfoundation.org");
    }
    expect(body).not.toMatch(/via|campaign|utm_source/);
    const metadata = [...form.entries()].filter(([key]) => key.startsWith("metadata[") || key.startsWith("payment_intent_data[metadata]["));
    expect(JSON.stringify(metadata)).not.toMatch(/via|hhf|foundation|campaign|utm_|referrer|tracking/);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
    expect(await response.text()).toBe("");
  });
  it("uses the database price, quantity one, null customer and no attribution", async () => {
    const q = H.current!.client;
    const product = purchaseEntryProduct("little-women")!;
    await q`UPDATE products SET price_cents = 3210 WHERE id = ${product.id}`;
    const response = await handlePurchaseEntry(request("little-women", "https://www.hopehumanfoundation.org/?campaign=ignored"), "little-women", await defaultPurchaseEntryDeps());
    expect(response.status).toBe(302);
    const [order] = await q`SELECT customer_id,shipping_address_id,status,total_cents,shipping_cents,environment,stock_reserved FROM orders`;
    expect(order).toMatchObject({ customer_id: null, shipping_address_id: null, status: "PAYMENT_PROCESSING", total_cents: 3210, shipping_cents: 0, environment: "test", stock_reserved: true });
    const form = new URLSearchParams(H.fetch.mock.calls[0]![1].body);
    expect(form.get("line_items[0][price_data][unit_amount]")).toBe("3210");
    const [item] = await q`SELECT product_id,sku,quantity,unit_price_cents,total_cents FROM order_items`;
    expect(item).toMatchObject({ product_id: product.id, sku: product.sku, quantity: 1, unit_price_cents: 3210, total_cents: 3210 });
    expect(await q`SELECT * FROM customers`).toHaveLength(0);
    expect(await q`SELECT * FROM addresses`).toHaveLength(0);
    expect(await q`SELECT * FROM order_attribution`).toHaveLength(0);
    const [bucket] = await q`SELECT bucket,count FROM rate_limit_counters`;
    expect(bucket).toMatchObject({ bucket: `orders:${HHB_STORE_ID}:1.2.3.4`, count: 1 });
    const [stock] = await q`SELECT reserved_stock FROM products WHERE id = ${product.id}`;
    expect(stock!["reserved_stock"]).toBe(1);
  });
  it("404 for unknown slug without creating an order or using a quota", async () => {
    const response = await handlePurchaseEntry(request("unknown"), "unknown", await defaultPurchaseEntryDeps());
    expect(response.status).toBe(404);
    expect(await H.current!.client`SELECT * FROM orders`).toHaveLength(0);
    expect(await H.current!.client`SELECT * FROM rate_limit_counters`).toHaveLength(0);
    expect(H.fetch).not.toHaveBeenCalled();
  });
  it("rejects non-GET requests before consuming quota or creating an order", async () => {
    const response = await handlePurchaseEntry(new Request("https://hopehumanbooks.com/comprar/little-women", { method: "POST" }), "little-women", await defaultPurchaseEntryDeps());
    expect(response.status).toBe(405); expect(response.headers.get("allow")).toBe("GET");
    expect(await H.current!.client`SELECT * FROM orders`).toHaveLength(0);
    expect(await H.current!.client`SELECT * FROM rate_limit_counters`).toHaveLength(0);
    expect(H.fetch).not.toHaveBeenCalled();
  });
  it("shares the public orders quota and rejects the next request without creating an order", async () => {
    const deps = await defaultPurchaseEntryDeps();
    for (let i = 0; i < 20; i++) await deps.rateLimit(`orders:${HHB_STORE_ID}:1.2.3.4`, 20, 60);
    const response = await handlePurchaseEntry(request("little-women"), "little-women", deps);
    expect(response.status).toBe(429);
    expect(await H.current!.client`SELECT * FROM orders`).toHaveLength(0);
    expect(H.fetch).not.toHaveBeenCalled();
  });
  it("keeps the same generic public error and sanitized stage when Stripe fails", async () => {
    H.fetch.mockResolvedValue(Response.json({ error: { code: "api_error", message: "Rejected sk_test_DoNotExpose" } }, { status: 500 }));
    const response = await handlePurchaseEntry(request("little-women"), "little-women", await defaultPurchaseEntryDeps());
    expect(response.status).toBe(502);
    expect(await response.text()).toBe("Secure checkout is unavailable. Please try again later.");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('"stage":"stripe_error"'));
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("DoNotExpose");
    const [payment] = await H.current!.client`SELECT provider_payment_id,last_error FROM payments`;
    expect(payment).toEqual({ provider_payment_id: null, last_error: "Rejected [redacted]" });
  });
  it("reports missing/decryption configuration without reaching Stripe or exposing ciphertext", async () => {
    vi.stubEnv("PAYMENTS_ENCRYPTION_KEY", "");
    const response = await handlePurchaseEntry(request("little-women"), "little-women", await defaultPurchaseEntryDeps());
    expect(response.status).toBe(500); expect(H.fetch).not.toHaveBeenCalled();
    expect(await response.text()).toBe("Secure checkout is unavailable. Please try again later.");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('"stage":"missing_env"'));
  });
  it("rejects a provider Session with an incorrect amount or destination", async () => {
    H.fetch.mockResolvedValue(Response.json({ id: "cs_test_Entry123", status: "open", mode: "payment", livemode: false, amount_total: 1, currency: "usd", metadata: {}, url: "https://other.example.test/checkout" }));
    const response = await handlePurchaseEntry(request("little-women"), "little-women", await defaultPurchaseEntryDeps());
    expect(response.status).toBe(502); expect(response.headers.get("location")).toBeNull();
    expect(await H.current!.client`SELECT * FROM payment_events WHERE type='CHECKOUT_SESSION_CREATED'`).toHaveLength(0);
  });
  it("reuses the same persisted attempt, snapshot, expiry and provider idempotency key on retry", async () => {
    const q = H.current!.client;
    const [store] = await q`SELECT * FROM stores WHERE id = ${HHB_STORE_ID}`;
    const order = await createOrder({ store: store as StoreRow, items: [{ productId: purchaseEntryProduct("little-women")!.id, quantity: 1 }], shippingOptionId: "no-shipping" });
    await q`UPDATE products SET price_cents=3333 WHERE sku='HHB-EB-030'`;
    const input = { store: store as StoreRow, orderId: order.order.id, slug: "little-women", origin: "https://hopehumanbooks.com" };
    const first = await createEbookCheckoutSession(input);
    const second = await createEbookCheckoutSession(input);
    expect(first).toEqual(second);
    expect(H.fetch.mock.calls[0]![1].headers["Idempotency-Key"]).toBe(`checkout:create:${order.order.id}:1`);
    expect(H.fetch.mock.calls[1]![1].method).toBe("GET");
    expect(H.fetch.mock.calls[1]![0]).toBe("https://api.stripe.com/v1/checkout/sessions/cs_test_Entry123");
    const [persisted] = await q`SELECT created_at FROM payments WHERE order_id=${order.order.id}`;
    expect(new URLSearchParams(H.fetch.mock.calls[0]![1].body).get("expires_at")).toBe(String(Math.floor(new Date(persisted!["created_at"]).getTime() / 1000) + 1860));
    expect(new URLSearchParams(H.fetch.mock.calls[0]![1].body).get("line_items[0][price_data][unit_amount]")).toBe("3000");
    const payments = await q`SELECT attempt,provider_payment_id,status FROM payments`;
    expect(payments).toEqual([{ attempt: 1, provider_payment_id: "cs_test_Entry123", status: "REQUIRES_PAYMENT" }]);
    const records = await q`SELECT metadata FROM payment_events WHERE type='CHECKOUT_SESSION_CREATED'`;
    expect(records).toEqual([{ metadata: { checkout_session_id: "cs_test_Entry123", attempt: 1 } }]);
  });
  it("does not redirect before the Session binding and append-only audit commit, and safely retries a rolled-back write", async () => {
    const q = H.current!.client;
    await H.current!.db.exec(`CREATE FUNCTION reject_checkout_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.type = 'CHECKOUT_SESSION_CREATED' THEN RAISE EXCEPTION 'fixture audit unavailable'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER reject_checkout_audit BEFORE INSERT ON payment_events FOR EACH ROW EXECUTE FUNCTION reject_checkout_audit();`);
    try {
      const response = await handlePurchaseEntry(request("little-women"), "little-women", await defaultPurchaseEntryDeps());
      expect(response.status).toBe(500); expect(response.headers.get("location")).toBeNull();
      expect(await response.text()).toBe("Secure checkout is unavailable. Please try again later.");
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('"operation":"checkout.persist-session"'));
      expect(await q`SELECT provider_payment_id FROM payments`).toEqual([{ provider_payment_id: null }]);
      expect(await q`SELECT status FROM orders`).toEqual([{ status: "PENDING_PAYMENT" }]);
    } finally {
      await H.current!.db.exec("DROP TRIGGER reject_checkout_audit ON payment_events; DROP FUNCTION reject_checkout_audit();");
    }
    const [store] = await q`SELECT * FROM stores WHERE id=${HHB_STORE_ID}`;
    const [order] = await q`SELECT id FROM orders`;
    await expect(createEbookCheckoutSession({ store: store as StoreRow, orderId: order!["id"], slug: "little-women", origin: "https://hopehumanbooks.com" })).resolves.toMatchObject({ url: "https://checkout.stripe.com/c/pay/cs_test_Entry123" });
    expect(H.fetch.mock.calls[0]![1].body).toBe(H.fetch.mock.calls[1]![1].body);
    expect(H.fetch.mock.calls[0]![1].headers["Idempotency-Key"]).toBe(H.fetch.mock.calls[1]![1].headers["Idempotency-Key"]);
    expect(await q`SELECT * FROM payments`).toHaveLength(1);
    expect(await q`SELECT * FROM payment_events WHERE type='CHECKOUT_SESSION_CREATED'`).toHaveLength(1);
  });
  it("keeps physical orders dependent on real customer details", async () => {
    const q = H.current!.client;
    const product = purchaseEntryProduct("little-women")!;
    await q`UPDATE products SET weight_grams = 500 WHERE id = ${product.id}`;
    const [store] = await q`SELECT * FROM stores WHERE id = ${HHB_STORE_ID}`;
    await expect(createOrder({ store: store as StoreRow, items: [{ productId: product.id, quantity: 1 }], shippingOptionId: "no-shipping" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(await q`SELECT * FROM orders`).toHaveLength(0);
  });
  it("preserves customer-backed digital orders for existing callers", async () => {
    const q = H.current!.client;
    const [store] = await q`SELECT * FROM stores WHERE id = ${HHB_STORE_ID}`;
    const order = await createOrder({ store: store as StoreRow, items: [{ productId: purchaseEntryProduct("little-women")!.id, quantity: 1 }], shippingOptionId: "no-shipping", customer: { firstName: "Test", lastName: "Reader", email: "reader@example.com" } });
    const [saved] = await q`SELECT o.customer_id,c.email FROM orders o JOIN customers c ON c.id=o.customer_id WHERE o.id=${order.order.id}`;
    expect(saved!["customer_id"]).not.toBeNull();
    expect(saved!["email"]).toBe("reader@example.com");
  });
});
