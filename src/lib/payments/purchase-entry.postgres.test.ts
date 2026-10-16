import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { createTestClient } from "@/lib/db/test-client";
import { HHB_PRODUCTS, HHB_STORE_ID, HHB_STORE_SLUG } from "@/lib/catalog/hhb";
import { purchaseEntryProduct, PURCHASE_ENTRY_SLUGS } from "./purchase-entry";

const H = vi.hoisted(() => ({ current: null as Awaited<ReturnType<typeof createTestClient>> | null }));
vi.mock("@/lib/db/client.server", async (original) => {
  const actual = await original<typeof import("@/lib/db/client.server")>();
  return { ...actual, sql: new Proxy(function (...args: unknown[]) {
    return (H.current!.client as unknown as (...args: unknown[]) => unknown)(...args);
  }, { get(_target, key) { const value = Reflect.get(H.current!.client, key); return typeof value === "function" ? value.bind(H.current!.client) : value; } }) };
});
import { buildOrderPaymentMetadata, buildPaymentDescription, createOrder } from "./orders.server";
import { defaultPurchaseEntryDeps, handlePurchaseEntry } from "./purchase-entry.server";
import type { StoreRow } from "./store-auth.server";

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
  await H.current!.db.exec("TRUNCATE stores CASCADE; TRUNCATE rate_limit_counters;");
  const q = H.current!.client;
  await q`INSERT INTO stores (id,name,slug,environment,currency,status) VALUES (${HHB_STORE_ID},'Hope Human Books',${HHB_STORE_SLUG},'test','USD','ACTIVE')`;
  for (const p of HHB_PRODUCTS) {
    await q`INSERT INTO products (id,store_id,name,slug,sku,price_cents,currency,stock,weight_grams,category)
      VALUES (${p.id},${HHB_STORE_ID},${p.name},${p.slug},${p.sku},${p.priceCents},'USD',100,0,${p.category})`;
  }
});

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
  it.each([undefined, "https://hopehumanbooks.com/", "https://example.com/"])("302 without local handoff for Referer %s", async (referer) => {
    const response = await handlePurchaseEntry(request("little-women", referer), "little-women", await defaultPurchaseEntryDeps());
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toMatch(/^\/pay\/[A-Za-z0-9]+$/);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
    expect(await response.text()).toBe("");
  });
  it.each(["https://hopehumanfoundation.org/", "https://www.hopehumanfoundation.org/campaign"])("302 with local handoff for Referer %s", async (referer) => {
    const response = await handlePurchaseEntry(request("little-women", referer), "little-women", await defaultPurchaseEntryDeps());
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toMatch(/^\/pay\/[A-Za-z0-9]+\?via=hhf$/);
  });
  it("uses the database price, quantity one, null customer and no attribution", async () => {
    const q = H.current!.client;
    const product = purchaseEntryProduct("little-women")!;
    await q`UPDATE products SET price_cents = 3210 WHERE id = ${product.id}`;
    const response = await handlePurchaseEntry(request("little-women", "https://www.hopehumanfoundation.org/?campaign=ignored"), "little-women", await defaultPurchaseEntryDeps());
    expect(response.status).toBe(302);
    const [order] = await q`SELECT customer_id,shipping_address_id,status,total_cents,shipping_cents,environment,stock_reserved FROM orders`;
    expect(order).toMatchObject({ customer_id: null, shipping_address_id: null, status: "PENDING_PAYMENT", total_cents: 3210, shipping_cents: 0, environment: "test", stock_reserved: true });
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
  });
  it("shares the public orders quota and rejects the next request without creating an order", async () => {
    const deps = await defaultPurchaseEntryDeps();
    for (let i = 0; i < 20; i++) await deps.rateLimit(`orders:${HHB_STORE_ID}:1.2.3.4`, 20, 60);
    const response = await handlePurchaseEntry(request("little-women"), "little-women", deps);
    expect(response.status).toBe(429);
    expect(await H.current!.client`SELECT * FROM orders`).toHaveLength(0);
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
