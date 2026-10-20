import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { createTestClient } from "@/lib/db/test-client";
import { purchaseEntryProduct } from "./purchase-entry";

const H = vi.hoisted(() => ({ current: null as Awaited<ReturnType<typeof createTestClient>> | null, get: vi.fn() }));
vi.mock("@/lib/db/client.server", async original => {
  const actual = await original<typeof import("@/lib/db/client.server")>();
  return { ...actual, sql: new Proxy(function (...args: unknown[]) {
    return (H.current!.client as unknown as (...args: unknown[]) => unknown)(...args);
  }, { get(_target, key) { const value = Reflect.get(H.current!.client, key); return typeof value === "function" ? value.bind(H.current!.client) : value; } }) };
});
vi.mock("@vercel/blob", () => ({ get: H.get }));
import { loadReceipt } from "./receipt.server";
import { downloadWork } from "./fulfillment.server";

const STORE = "10000000-0000-4000-8000-000000000001";
const ORDER = "20000000-0000-4000-8000-000000000001";
const TOKEN = "receipt-product-token";
const product = purchaseEntryProduct("the-adventures-of-tom-sawyer")!;

beforeAll(async () => {
  H.current = await createTestClient();
  await H.current.db.exec(await readFile(new URL("../db/test-schema.sql", import.meta.url), "utf8"));
});
afterAll(async () => { await H.current?.close(); });
beforeEach(async () => {
  H.get.mockReset();
  await H.current!.db.exec("TRUNCATE stores CASCADE");
  const q = H.current!.client;
  await q`INSERT INTO stores (id,name,slug,environment,currency) VALUES (${STORE},'Books','books','test','USD')`;
  await q`INSERT INTO products (id,store_id,name,slug,sku,price_cents,currency,weight_grams)
    VALUES (${product.id},${STORE},${product.name},${product.slug},${product.sku},2000,'USD',0)`;
  await q`INSERT INTO orders (id,store_id,order_number,environment,currency,subtotal_cents,total_cents,public_token,status,origin_hhf)
    VALUES (${ORDER},${STORE},'ORD-RECEIPT','test','USD',2000,2000,${TOKEN},'PENDING_PAYMENT',true)`;
  await q`INSERT INTO order_items (order_id,product_id,product_name,sku,quantity,unit_price_cents,total_cents)
    VALUES (${ORDER},${product.id},${product.name},${product.sku},1,2000,2000)`;
});

describe("product receipts for both persisted origins", () => {
  it("exposes HHF items before payment while keeping files locked", async () => {
    const receipt = await loadReceipt(TOKEN);
    expect(receipt).toMatchObject({ hhf: true, status: "PENDING_PAYMENT",
      items: [{ name: "The Adventures of Tom Sawyer — Mark Twain", quantity: 1, totalCents: 2000 }], works: [] });
    await expect(downloadWork(TOKEN, "the-adventures-of-tom-sawyer")).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(H.get).not.toHaveBeenCalled();
  });

  it("exposes the identical purchased items and works for paid HHF and native receipts", async () => {
    await H.current!.client`UPDATE orders SET status='PAID' WHERE id=${ORDER}`;
    const hhf = await loadReceipt(TOKEN);
    expect(hhf.hhf).toBe(true);
    expect(hhf.items).toEqual([{ name: "The Adventures of Tom Sawyer — Mark Twain", quantity: 1, totalCents: 2000 }]);
    expect(hhf.works).toEqual([expect.objectContaining({ title: "The Adventures of Tom Sawyer", author: "Mark Twain",
      downloadPath: `/api/public/v1/downloads/${TOKEN}/the-adventures-of-tom-sawyer` })]);
    await H.current!.client`UPDATE orders SET origin_hhf=false WHERE id=${ORDER}`;
    const native = await loadReceipt(TOKEN);
    expect(native.hhf).toBe(false);
    expect({ ...native, hhf: null }).toEqual({ ...hhf, hhf: null });
  });

  it("streams the purchased file from a paid HHF receipt", async () => {
    await H.current!.client`UPDATE orders SET status='PAID' WHERE id=${ORDER}`;
    const receipt = await loadReceipt(TOKEN);
    H.get.mockResolvedValue({ statusCode: 200, stream: new Blob(["purchased ebook"]).stream() });
    const response = await downloadWork(TOKEN, receipt.works[0]!.workId);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("purchased ebook");
    expect(H.get).toHaveBeenCalledExactlyOnceWith("v1/the-adventures-of-tom-sawyer.txt", { access: "private" });
  });

  it.each(["CANCELLED", "REFUNDED"])("keeps items but revokes works for a %s HHF receipt", async status => {
    await H.current!.client`UPDATE orders SET status=${status} WHERE id=${ORDER}`;
    const receipt = await loadReceipt(TOKEN);
    expect(receipt.hhf).toBe(true);
    expect(receipt.items).toHaveLength(1);
    expect(receipt.works).toEqual([]);
  });

  it("rejects an unknown receipt token", async () => {
    await expect(loadReceipt("unknown-receipt-token")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
