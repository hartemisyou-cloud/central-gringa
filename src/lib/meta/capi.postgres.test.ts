import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { createTestClient } from "@/lib/db/test-client";

const H = vi.hoisted(() => ({ current: null as Awaited<ReturnType<typeof createTestClient>> | null, fetch: vi.fn() }));
vi.mock("@/lib/db/client.server", async (original) => {
  const actual = await original<typeof import("@/lib/db/client.server")>();
  const getClient = () => { if (!H.current) throw new Error("Test client unavailable"); return H.current.client; };
  return { ...actual, sql: new Proxy(function (...args: unknown[]) {
    return (getClient() as unknown as (...args: unknown[]) => unknown)(...args);
  }, { get(_target, key) { const client = getClient(); const value = Reflect.get(client, key); return typeof value === "function" ? value.bind(client) : value; } }) };
});
vi.mock("./config.server", () => ({
  getMetaSettingsWithToken: async (storeId: string) => ({ storeId, pixelId: storeId === STORE ? "111" : "222", accessToken: "fixture-private-token", testEventCode: "TEST_FIXTURE" }),
  recordMetaHealth: vi.fn(),
}));
vi.mock("@/lib/analytics/ingest.server", () => ({ recordServerEvent: vi.fn() }));
import { sendPurchaseForOrder, validateMetaResponse } from "./capi.server";
const STORE = "10000000-0000-4000-8000-000000000001";
const ORDER = "20000000-0000-4000-8000-000000000001";
function client() { if (!H.current) throw new Error("Test client unavailable"); return H.current.client; }
beforeAll(async () => {
  H.current = await createTestClient();
  await H.current.db.exec(await readFile(new URL("../db/test-schema.sql", import.meta.url), "utf8"));
});
afterAll(async () => { await H.current?.close(); });
beforeEach(async () => {
  vi.clearAllMocks();
  H.fetch.mockReset();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.stubGlobal("fetch", H.fetch);
  H.fetch.mockResolvedValue(Response.json({ events_received: 1, messages: [], fbtrace_id: "trace-fixture" }));
  const q = client();
  await q`TRUNCATE stores CASCADE`;
  await q`INSERT INTO stores (id,name,slug,environment,currency,status,domain) VALUES (${STORE},'Fixture','fixture','live','USD','ACTIVE','example.com')`;
  await q`INSERT INTO orders (id,store_id,public_token,order_number,environment,status,currency,total_cents,paid_at)
    VALUES (${ORDER},${STORE},'fixture-public-token','ORD-FIXTURE','live','PAID','USD',10000,'2026-10-24T12:00:00Z')`;
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("Meta acceptance contract", () => {
  it.each(["not json", "{}", '{"events_received":0}', '{"events_received":2}', '{"events_received":1,"error":{"code":200}}'])("does not accept HTTP 200 without a valid acknowledgement: %s", text => {
    expect(validateMetaResponse(200, text).ok).toBe(false);
  });
  it("accepts one acknowledged Purchase and retains response evidence", () => {
    expect(validateMetaResponse(200, '{"events_received":1,"messages":[],"fbtrace_id":"trace"}')).toMatchObject({ ok: true, eventsReceived: 1, metaEventId: "trace" });
  });
  it("distinguishes Graph access code 200 from HTTP 200", () => {
    expect(validateMetaResponse(400, '{"error":{"code":200,"message":"API access blocked"}}')).toMatchObject({ ok: false, permanent: true, httpStatus: 400 });
  });
  it("keeps transient Graph errors and rate limits retryable", () => {
    expect(validateMetaResponse(400, '{"error":{"code":2,"is_transient":true}}')).toMatchObject({ ok: false, permanent: false });
    expect(validateMetaResponse(429, '{"error":{"code":4}}')).toMatchObject({ ok: false, permanent: false });
  });
});

describe("durable Purchase dispatch", () => {
  it("uses paid value, USD, original time and a stable event identity; repeated dispatch skips", async () => {
    expect(await sendPurchaseForOrder({ orderId: ORDER, storeId: STORE })).toMatchObject({ ok: true });
    const body = JSON.parse(H.fetch.mock.calls[0]?.[1].body);
    expect(body.data[0]).toMatchObject({ event_name: "Purchase", event_id: `purchase_${ORDER}`, event_time: 1792843200, custom_data: { value: 100, currency: "USD" } });
    expect(body.test_event_code).toBeUndefined();
    expect(await sendPurchaseForOrder({ orderId: ORDER, storeId: STORE })).toMatchObject({ skipped: "already_sent" });
    expect(H.fetch).toHaveBeenCalledTimes(1);
  });
  it("does not report a pending payment or another store's order", async () => {
    await client()`UPDATE orders SET status='PAYMENT_PROCESSING' WHERE id=${ORDER}`;
    expect(await sendPurchaseForOrder({ orderId: ORDER, storeId: STORE })).toMatchObject({ skipped: "order_not_paid" });
    expect((await sendPurchaseForOrder({ orderId: ORDER, storeId: "10000000-0000-4000-8000-000000000002" })).ok).toBe(false);
    expect(H.fetch).not.toHaveBeenCalled();
  });
  it("preserves historical event identity and claims an existing row exclusively", async () => {
    const q = client();
    await q`INSERT INTO meta_conversion_events (store_id,order_id,event_name,event_id) VALUES (${STORE},${ORDER},'Purchase','historical-event-id')`;
    let release: (() => void) | undefined;
    const gate = new Promise<void>(resolve => { release = resolve; });
    H.fetch.mockImplementation(async () => { await gate; return Response.json({ events_received: 1 }); });
    const first = sendPurchaseForOrder({ orderId: ORDER, storeId: STORE });
    await vi.waitFor(() => expect(H.fetch).toHaveBeenCalledTimes(1));
    expect(await sendPurchaseForOrder({ orderId: ORDER, storeId: STORE })).toMatchObject({ skipped: "in_flight_or_backoff" });
    release?.(); await first;
    expect(JSON.parse(H.fetch.mock.calls[0]?.[1].body).data[0].event_id).toBe("historical-event-id");
    const [row] = await q`SELECT status,attempt_count FROM meta_conversion_events`;
    expect(row).toMatchObject({ status: "SENT", attempt_count: 1 });
  });
  it("retries transient failure after backoff with unchanged event identity and time", async () => {
    H.fetch.mockResolvedValueOnce(Response.json({ error: { code: 2, is_transient: true } }, { status: 503 }));
    await sendPurchaseForOrder({ orderId: ORDER, storeId: STORE });
    await sendPurchaseForOrder({ orderId: ORDER, storeId: STORE });
    expect(H.fetch).toHaveBeenCalledTimes(1);
    await client()`UPDATE meta_conversion_events SET updated_at=now()-interval '31 seconds'`;
    await sendPurchaseForOrder({ orderId: ORDER, storeId: STORE });
    const first = JSON.parse(H.fetch.mock.calls[0]?.[1].body).data[0];
    const second = JSON.parse(H.fetch.mock.calls[1]?.[1].body).data[0];
    expect(second.event_id).toBe(first.event_id); expect(second.event_time).toBe(first.event_time);
  });
  it("does not retry a permanent access error on another payment notification", async () => {
    H.fetch.mockResolvedValue(Response.json({ error: { code: 200 } }, { status: 400 }));
    await sendPurchaseForOrder({ orderId: ORDER, storeId: STORE });
    await sendPurchaseForOrder({ orderId: ORDER, storeId: STORE });
    expect(H.fetch).toHaveBeenCalledTimes(1);
    const [row] = await client()`SELECT status FROM meta_conversion_events`;
    expect(row?.status).toBe("FAILED_PERMANENT");
  });
  it("does not mark a zero-event acknowledgement SENT", async () => {
    H.fetch.mockResolvedValue(Response.json({ events_received: 0, messages: ["not accepted"] }));
    expect((await sendPurchaseForOrder({ orderId: ORDER, storeId: STORE })).ok).toBe(false);
    const [row] = await client()`SELECT status,http_status FROM meta_conversion_events`;
    expect(row).toMatchObject({ status: "FAILED", http_status: 200 });
  });
});