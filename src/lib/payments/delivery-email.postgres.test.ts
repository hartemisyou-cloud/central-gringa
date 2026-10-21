import { readFile } from "node:fs/promises";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestClient } from "@/lib/db/test-client";
import { HHB_STORE_ID, HHB_PRODUCTS } from "@/lib/catalog/hhb";

const H = vi.hoisted(() => ({ current: null as Awaited<ReturnType<typeof createTestClient>> | null, fetch: vi.fn() }));
vi.mock("@/lib/db/client.server", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/db/client.server")>(),
  sql: new Proxy(function (...args: unknown[]) { return (H.current!.module.sql as unknown as Function)(...args); }, {
    get(_target, key) { return Reflect.get(H.current!.module.sql, key); },
  }),
}));
import { buildDeliveryEmail, sendDeliveryEmailForOrder } from "./delivery-email.server";
import { buildEbookCheckoutSessionParams } from "./checkout-session.server";

const ORDER = "b0b5e000-4848-4b00-8000-000000000701";
const TOKEN = "ReceiptTokenWithoutReturnMarker123";
const product = HHB_PRODUCTS.find(row => row.sku === "HHB-EB-020")!;

beforeAll(async () => {
  H.current = await createTestClient();
  await H.current.db.exec(await readFile(new URL("../db/test-schema.sql", import.meta.url), "utf8"));
});
afterAll(async () => { await H.current?.close(); });
beforeEach(async () => {
  vi.stubEnv("RESEND_API_KEY", "re_TestFixture");
  vi.stubEnv("DELIVERY_EMAIL_FROM", "Hope Human Books <delivery@example.com>");
  vi.stubGlobal("fetch", H.fetch);
  H.fetch.mockReset().mockResolvedValue(Response.json({ id: "email_fixture" }));
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const q = H.current!.client;
  await H.current!.db.exec("TRUNCATE stores CASCADE");
  await q`INSERT INTO stores (id,name,slug,currency,environment,status)
    VALUES (${HHB_STORE_ID},'Hope Human Books','hope-human-books','USD','test','ACTIVE')`;
  await q`INSERT INTO products (id,store_id,name,slug,sku,price_cents,currency,stock,weight_grams,category)
    VALUES (${product.id},${HHB_STORE_ID},${product.name},${product.slug},${product.sku},2000,'USD',100,0,'ebook')`;
  await q`INSERT INTO orders (id,store_id,order_number,status,environment,currency,total_cents,public_token,origin_hhf,checkout_customer_details)
    VALUES (${ORDER},${HHB_STORE_ID},'ORD-EMAIL','PAID','test','USD',2000,${TOKEN},false,
      ${q.json({ name: "Hope Human", email: " Reader@EXAMPLE.COM ", address: { country: "US", city: null } })})`;
  await q`INSERT INTO order_items (order_id,product_id,product_name,sku,unit_price_cents,quantity,total_cents)
    VALUES (${ORDER},${product.id},${product.name},${product.sku},2000,1,2000)`;
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("automatic paid e-book delivery", () => {
  it.each([true, false])("routes origin_hhf=%s through its theme before any provider call", async hhf => {
    await H.current!.client`UPDATE orders SET origin_hhf=${hhf} WHERE id=${ORDER}`;
    if (hhf) {
      expect(await sendDeliveryEmailForOrder(ORDER, HHB_STORE_ID)).toEqual({ skipped: "origin_hhf" });
      expect(H.fetch).not.toHaveBeenCalled();
      const [saved] = await H.current!.client`SELECT delivery_email_sent_at FROM orders WHERE id=${ORDER}`;
      expect(saved!["delivery_email_sent_at"]).toBeNull();
      return;
    }
    expect(await sendDeliveryEmailForOrder(ORDER, HHB_STORE_ID)).toEqual({ sent: true });
    const [url, init] = H.fetch.mock.calls[0]!;
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.headers["Idempotency-Key"]).toBe(`ebook-delivery/${ORDER}`);
    const body = JSON.parse(init.body);
    expect(body.to).toEqual(["reader@example.com"]);
    expect(body.text).toContain("The Adventures of Tom Sawyer — Mark Twain");
    expect(body.text).toContain(`https://hopehumanbooks.com/order/${TOKEN}`);
    expect(body.html).toContain(`href="https://hopehumanbooks.com/order/${TOKEN}"`);
    expect(JSON.stringify(body)).not.toMatch(/\?ret=|&ret=|via=/);
    expect(body.text.includes("Make a Difference Today")).toBe(false);
    const [saved] = await H.current!.client`SELECT delivery_email_sent_at FROM orders WHERE id=${ORDER}`;
    expect(saved!["delivery_email_sent_at"]).not.toBeNull();
    expect(await sendDeliveryEmailForOrder(ORDER, HHB_STORE_ID)).toEqual({ skipped: "already_sent" });
    expect(H.fetch).toHaveBeenCalledOnce();
  });

  it.each(["PAYMENT_PROCESSING", "REFUNDED", "CANCELLED"])("does not send or unlock a %s order", async status => {
    await H.current!.client`UPDATE orders SET status=${status} WHERE id=${ORDER}`;
    expect(await sendDeliveryEmailForOrder(ORDER, HHB_STORE_ID)).toEqual({ skipped: "not_paid" });
    expect(H.fetch).not.toHaveBeenCalled();
  });

  it("does not fabricate a recipient or require email configuration for financial confirmation", async () => {
    await H.current!.client`UPDATE orders SET checkout_customer_details=${H.current!.client.json({name:"Hope Human",email:null})}`;
    expect(await sendDeliveryEmailForOrder(ORDER, HHB_STORE_ID)).toEqual({ skipped: "missing_email" });
    expect(H.fetch).not.toHaveBeenCalled();
    await H.current!.client`UPDATE orders SET checkout_customer_details=${H.current!.client.json({email:"reader@example.com"})}`;
    vi.stubEnv("RESEND_API_KEY", "");
    expect(await sendDeliveryEmailForOrder(ORDER, HHB_STORE_ID)).toEqual({ skipped: "not_configured" });
    expect(H.fetch).not.toHaveBeenCalled();
  });

  it("retries provider failure using the same key and keeps the order PAID", async () => {
    H.fetch.mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
    await expect(sendDeliveryEmailForOrder(ORDER, HHB_STORE_ID)).rejects.toThrow("HTTP 503");
    const [order] = await H.current!.client`SELECT status,delivery_email_sent_at FROM orders WHERE id=${ORDER}`;
    expect(order).toEqual({ status: "PAID", delivery_email_sent_at: null });
    await sendDeliveryEmailForOrder(ORDER, HHB_STORE_ID);
    expect(H.fetch.mock.calls[0]![1].headers["Idempotency-Key"]).toBe(H.fetch.mock.calls[1]![1].headers["Idempotency-Key"]);
    expect(H.fetch.mock.calls[0]![1].body).toBe(H.fetch.mock.calls[1]![1].body);
  });

  it("lists all delivered works in the ten-book library and escapes HTML", () => {
    const email = buildDeliveryEmail({ order_number: "ORD-1", public_token: TOKEN, origin_hhf: false,
      items: [{ sku: "HHB-LIB-500", product_name: '<Library & "Books">' }] });
    expect(email.text).toContain("The Scarlet Letter — Nathaniel Hawthorne");
    expect(email.html).toContain("&lt;Library &amp; &quot;Books&quot;&gt;");
    expect(email.html).not.toContain('<Library & "Books">');
  });
});

describe("donor journey across theme layers", () => {
  it("keeps the theme B wire, empty PAID receipt and suppressed email while native stays intact", async () => {
    const q = H.current!.client;
    const input = {
      order: { id: ORDER, store_id: HHB_STORE_ID, order_number: "ORD-EMAIL", public_token: TOKEN, environment: "test" as const, customer_id: null, total_cents: 2000, currency: "USD" },
      items: [{ product_id: product.id, product_name: product.name, sku: product.sku, quantity: 1, unit_price_cents: 2000, total_cents: 2000 }],
      products: [{ id: product.id, category: product.category, weight_grams: 0 }],
      slug: product.slug,
      origin: "https://hopehumanbooks.com",
      createdAt: "2026-10-16T12:00:00.000Z",
    };
    const themed = buildEbookCheckoutSessionParams({ ...input, hhf: true });
    expect(themed.success_url).toBe(`https://hopehumanbooks.com/order/${TOKEN}?ret=1`);
    expect(themed.line_items[0]!.price_data.product_data).toEqual({ name: "$20", description: "Make a Difference Today", images: ["https://hopehumanbooks.com/emblem.png"] });
    expect(JSON.stringify(themed)).not.toMatch(/fundação|foundation|doação|donation|campanha|campaign|mateo|hopehumanfoundation|utm_|referr|tracking|hhf|via=/i);
    expect(buildEbookCheckoutSessionParams(input).line_items[0]!.price_data.product_data.name).toBe(product.name);
    await q`UPDATE orders SET origin_hhf=true WHERE id=${ORDER}`;
    const { loadReceipt } = await import("./receipt.server");
    const receipt = await loadReceipt(TOKEN);
    expect(receipt).toMatchObject({ hhf: true, status: "PAID", items: [], works: [] });
    expect(await sendDeliveryEmailForOrder(ORDER, HHB_STORE_ID)).toEqual({ skipped: "origin_hhf" });
    expect(H.fetch).not.toHaveBeenCalled();
  });
});
