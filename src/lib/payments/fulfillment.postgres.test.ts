import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { createTestClient } from "@/lib/db/test-client";
import { HHB_WORKS } from "@/lib/catalog/hhb";

const H = vi.hoisted(() => ({ current: null as Awaited<ReturnType<typeof createTestClient>> | null, get: vi.fn() }));
vi.mock("@/lib/db/client.server", async (original) => {
  const actual = await original<typeof import("@/lib/db/client.server")>();
  return { ...actual, sql: new Proxy(function (...args: unknown[]) {
    return (H.current!.client as unknown as (...args: unknown[]) => unknown)(...args);
  }, { get(_target, key) { const value = Reflect.get(H.current!.client, key); return typeof value === "function" ? value.bind(H.current!.client) : value; } }) };
});
vi.mock("@vercel/blob", () => ({ get: H.get }));
import { downloadWork, getOrderDeliverables } from "./fulfillment.server";

const STORE = "10000000-0000-4000-8000-000000000001";
const ORDER = "20000000-0000-4000-8000-000000000001";
const PRODUCT = "40000000-0000-4000-8000-000000000001";
beforeAll(async () => {
  H.current = await createTestClient();
  await H.current.db.exec(await readFile(new URL("../db/test-schema.sql", import.meta.url), "utf8"));
});
afterAll(async () => { await H.current?.close(); });
beforeEach(async () => {
  await H.current!.db.exec("TRUNCATE stores CASCADE;");
  const q = H.current!.client;
  await q`INSERT INTO stores (id,name,slug,environment,currency) VALUES (${STORE},'Books','books','test','USD')`;
  await q`INSERT INTO orders (id,store_id,order_number,environment,currency,subtotal_cents,total_cents,public_token,status) VALUES (${ORDER},${STORE},'ORD-A','test','USD',500,500,'receipt-A','PENDING_PAYMENT')`;
  await q`INSERT INTO products (id,store_id,name,slug,sku,price_cents,currency,weight_grams) VALUES (${PRODUCT},${STORE},'Book','book','HHB-EB-005',500,'USD',0)`;
  await q`INSERT INTO order_items (order_id,product_id,product_name,sku,quantity,unit_price_cents,total_cents) VALUES (${ORDER},${PRODUCT},'Book','HHB-EB-005',1,500,500)`;
  H.get.mockReset();
});

describe("private Blob fulfillment with PostgreSQL authorization", () => {
  it("never reads a private blob before a verified PAID state", async () => {
    const work = HHB_WORKS[0]!;
    for (const status of ["PENDING_PAYMENT", "PAYMENT_PROCESSING", "CANCELLED", "REFUNDED"]) {
      await H.current!.client`UPDATE orders SET status = ${status} WHERE id = ${ORDER}`;
      await expect(downloadWork("receipt-A", work.workId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(H.get).not.toHaveBeenCalled();
  });
  it("rejects unknown receipts and titles outside the paid SKU", async () => {
    await H.current!.client`UPDATE orders SET status = 'PAID' WHERE id = ${ORDER}`;
    await expect(downloadWork("unknown", HHB_WORKS[0]!.workId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(downloadWork("receipt-A", HHB_WORKS[1]!.workId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(H.get).not.toHaveBeenCalled();
  });
  it("streams only the purchased file with private no-store caching", async () => {
    await H.current!.client`UPDATE orders SET status = 'PAID' WHERE id = ${ORDER}`;
    const receipt = await getOrderDeliverables("receipt-A");
    expect(receipt.works).toHaveLength(1);
    const work = HHB_WORKS.find((w) => w.workId === receipt.works[0]!.workId)!;
    H.get.mockResolvedValue({ statusCode: 200, stream: new Blob(["verified file"]).stream() });
    const response = await downloadWork("receipt-A", work.workId);
    expect(H.get).toHaveBeenCalledExactlyOnceWith(`v1/${work.file}`, { access: "private" });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await response.text()).toBe("verified file");
  });
  it("fails closed when Blob is unavailable", async () => {
    await H.current!.client`UPDATE orders SET status = 'PAID' WHERE id = ${ORDER}`;
    const receipt = await getOrderDeliverables("receipt-A");
    H.get.mockRejectedValue(new Error("storage unavailable"));
    await expect(downloadWork("receipt-A", receipt.works[0]!.workId)).rejects.toMatchObject({ code: "CONFIG_ERROR" });
  });
});
