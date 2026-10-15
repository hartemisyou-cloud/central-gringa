import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { createTestClient } from "@/lib/db/test-client";

const H = vi.hoisted(() => ({
  current: null as Awaited<ReturnType<typeof createTestClient>> | null,
}));
vi.mock("@/lib/db/client.server", async (original) => {
  const actual = await original<typeof import("@/lib/db/client.server")>();
  return {
    ...actual,
    sql: new Proxy(
      function (...args: unknown[]) {
        return (H.current!.client as unknown as (...args: unknown[]) => unknown)(...args);
      },
      {
        get(_target, key) {
          const value = Reflect.get(H.current!.client, key);
          return typeof value === "function" ? value.bind(H.current!.client) : value;
        },
      },
    ),
  };
});

import { ingestClientEvents, recordServerEvent } from "./ingest.server";
import { buildReport, exportCsv } from "./query.server";
import { recordPresence, realtimeSnapshot, prunePresence } from "./presence.server";
import { previewAnalyticsPurge, purgeAnalytics } from "./purge.server";
import {
  getPublicMetaConfig,
  saveMetaSettings,
  getMetaSettingsWithToken,
} from "@/lib/meta/config.server";
import { loadOrderContext, sendPurchaseForOrder } from "@/lib/meta/capi.server";
import { saveUtmifySettings, getUtmifySettingsWithToken } from "@/lib/utmify/config.server";
import { sendSaleForOrder, resendUtmifySaleForOrderNumber } from "@/lib/utmify/api.server";

const STORE_A = "10000000-0000-4000-8000-000000000001";
const STORE_B = "10000000-0000-4000-8000-000000000002";
const ORDER_A = "20000000-0000-4000-8000-000000000001";
const ORDER_B = "20000000-0000-4000-8000-000000000002";
const CUSTOMER = "30000000-0000-4000-8000-000000000001";
const PRODUCT = "40000000-0000-4000-8000-000000000001";
const UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile Safari/604.1";

beforeAll(async () => {
  H.current = await createTestClient();
  await H.current.db.exec(
    await readFile(new URL("../db/test-schema.sql", import.meta.url), "utf8"),
  );
});
afterAll(async () => {
  await H.current?.close();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
beforeEach(async () => {
  await H.current!.db.exec(
    "TRUNCATE stores CASCADE; TRUNCATE rate_limit_counters; TRUNCATE audit_logs;",
  );
  const q = H.current!.client;
  await q`INSERT INTO stores (id,name,slug,domain,environment,currency) VALUES (${STORE_A},'Books','books','books.example','test','USD'),(${STORE_B},'Other','other','other.example','test','EUR')`;
  await q`INSERT INTO customers (id,store_id,email,first_name,last_name) VALUES (${CUSTOMER},${STORE_A},'reader@example.com','Ana','Silva')`;
  await q`INSERT INTO orders (id,store_id,customer_id,order_number,environment,currency,subtotal_cents,total_cents,public_token,status) VALUES (${ORDER_A},${STORE_A},${CUSTOMER},'ORD-A','test','USD',2000,2000,'receipt-token-A','PENDING_PAYMENT'),(${ORDER_B},${STORE_B},NULL,'ORD-B','test','EUR',5000,5000,'receipt-token-B','PENDING_PAYMENT')`;
  vi.stubEnv("PAYMENTS_ENCRYPTION_KEY", "test-fixture-key-never-for-production-123456789");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response('{"events_received":1}', { status: 200 })),
  );
});

function payload(publicToken = "receipt-token-A", session = "checkout-session-A") {
  return {
    publicToken,
    anonymousSessionId: "anonymous-session-A",
    checkoutSessionId: session,
    events: [
      {
        eventId: `${session}-view`,
        type: "checkout_viewed" as const,
        metadata: { readable: true, client_secret: "must-be-stripped" },
      },
    ],
  };
}
const context = { userAgent: UA, country: "US" };
const filters = {
  from: "2020-01-01T00:00:00.000Z",
  to: "2099-01-01T00:00:00.000Z",
  storeId: STORE_A,
};

describe("PostgreSQL telemetry migration", () => {
  it("deduplicates client events, strips sensitive metadata and rejects client financial facts", async () => {
    const input = payload();
    await ingestClientEvents(input, context);
    await ingestClientEvents(input, context);
    await ingestClientEvents(
      { ...input, events: [{ eventId: "forged-success", type: "payment_succeeded" }] },
      context,
    );
    const events = await H.current!.client`SELECT * FROM analytics_events`;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      store_id: STORE_A,
      order_id: ORDER_A,
      source: "client",
      currency: "USD",
      amount_cents: 2000,
    });
    expect(events[0]!["metadata"]).toEqual({ readable: true });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("never rolls a server-confirmed session back on a delayed client event", async () => {
    await ingestClientEvents(payload(), context);
    await recordServerEvent({
      eventId: "server-success",
      type: "payment_succeeded",
      storeId: STORE_A,
      orderId: ORDER_A,
    });
    await ingestClientEvents(
      { ...payload(), events: [{ eventId: "delayed-view", type: "checkout_viewed" }] },
      context,
    );
    const [session] = await H.current!.client`SELECT status, succeeded_at FROM checkout_sessions`;
    expect(session!["status"]).toBe("SUCCEEDED");
    expect(session!["succeeded_at"]).toMatch(/^\d{4}-\d\d-\d\dT/);
  });

  it("reports and CSV remain isolated by store and currency", async () => {
    await ingestClientEvents(payload(), context);
    await ingestClientEvents(payload("receipt-token-B", "checkout-session-B"), context);
    await recordServerEvent({
      eventId: "paid-A",
      type: "payment_succeeded",
      storeId: STORE_A,
      orderId: ORDER_A,
      amountCents: 2000,
      currency: "USD",
    });
    await recordServerEvent({
      eventId: "paid-B",
      type: "payment_succeeded",
      storeId: STORE_B,
      orderId: ORDER_B,
      amountCents: 5000,
      currency: "EUR",
    });
    const report = await buildReport({ ...filters, currency: "USD" });
    expect(report.overview).toMatchObject({
      totalCheckouts: 1,
      successfulPayments: 1,
      averageTicketCents: 2000,
    });
    const csv = await exportCsv(filters);
    expect(csv).toContain(STORE_A);
    expect(csv).not.toContain(STORE_B);
  });

  it("preserves drawer conversion milestones and ignores bots in live counts", async () => {
    await recordPresence(
      { sessionId: "human-session", storeSlug: "books", event: "CART_OPENED" },
      UA,
    );
    await recordPresence(
      { sessionId: "human-session", storeSlug: "books", event: "CHECKOUT_VIEWED" },
      UA,
    );
    await recordPresence(
      { sessionId: "human-session", storeSlug: "books", event: "SESSION_ACTIVE" },
      UA,
    );
    await recordPresence(
      { sessionId: "bot-session", storeSlug: "books", event: "CART_OPENED" },
      "crawler-bot",
    );
    await recordPresence(
      { sessionId: "other-session", storeSlug: "other", event: "CART_OPENED" },
      UA,
    );
    const result = await realtimeSnapshot(STORE_A);
    expect(result).toMatchObject({
      online: 1,
      cart: 0,
      checkout: 0,
      drawerOpened: 1,
      drawerToCheckout: 1,
      drawerToCheckoutRate: 100,
      drawerAbandoned: 0,
    });
  });

  it("uses the actual shared rate window to prune old presence once", async () => {
    await recordPresence(
      { sessionId: "old-session", storeSlug: "books", event: "SESSION_ACTIVE" },
      UA,
    );
    await H.current!
      .client`UPDATE presence_sessions SET last_seen_at = now() - interval '25 hours'`;
    expect(await prunePresence()).toEqual({ pruned: true });
    expect(await prunePresence()).toEqual({ pruned: false });
    expect(await H.current!.client`SELECT * FROM presence_sessions`).toHaveLength(0);
  });

  it("purges only the selected store's analytics and preserves orders and attribution", async () => {
    await ingestClientEvents(payload(), context);
    await ingestClientEvents(payload("receipt-token-B", "checkout-session-B"), context);
    await recordPresence(
      { sessionId: "session-purge", storeSlug: "books", event: "SESSION_ACTIVE" },
      UA,
    );
    await H.current!
      .client`INSERT INTO order_attribution (order_id,utm_source) VALUES (${ORDER_A},'preserved-source')`;
    expect((await previewAnalyticsPurge(STORE_A)).total).toBe(3);
    await purgeAnalytics(STORE_A);
    expect(await H.current!.client`SELECT id FROM orders`).toHaveLength(2);
    expect(await H.current!.client`SELECT order_id FROM order_attribution`).toHaveLength(1);
    expect(await H.current!.client`SELECT store_id FROM analytics_events`).toEqual([
      expect.objectContaining({ store_id: STORE_B }),
    ]);
    expect(await H.current!.client`SELECT action FROM audit_logs`).toEqual([
      expect.objectContaining({ action: "analytics.purge" }),
    ]);
  });
});

describe("PostgreSQL integration configuration", () => {
  it("never sends a different store's order with the requested store's credentials", async () => {
    await saveMetaSettings({
      storeId: STORE_B,
      pixelId: "987654321",
      accessToken: "test-other-meta-token",
      enabled: true,
      testEventCode: null,
    });
    await saveUtmifySettings({
      storeId: STORE_B,
      webhookId: null,
      apiToken: "test-other-utmify-token",
      enabled: true,
      isTest: true,
    });
    await H.current!
      .client`UPDATE orders SET status = 'PAID', paid_at = now() WHERE id = ${ORDER_A}`;
    expect(await sendPurchaseForOrder({ storeId: STORE_B, orderId: ORDER_A })).toEqual({
      ok: true,
      skipped: "order_not_found",
    });
    expect(await sendSaleForOrder({ storeId: STORE_B, orderId: ORDER_A })).toEqual({
      ok: true,
      skipped: "order_not_found",
    });
    expect(await loadOrderContext(ORDER_A, STORE_B)).toBeNull();
    expect(await H.current!.client`SELECT id FROM meta_conversion_events`).toHaveLength(0);
    expect(await H.current!.client`SELECT id FROM utmify_events`).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects manual UTMify resend for unpaid, failed, canceled and refunded orders", async () => {
    await saveUtmifySettings({
      storeId: STORE_A,
      webhookId: null,
      apiToken: "test-utmify-token",
      enabled: true,
      isTest: true,
    });
    for (const status of [
      "PENDING_PAYMENT",
      "PAYMENT_FAILED",
      "CANCELLED",
      "REFUNDED",
      "PARTIALLY_REFUNDED",
    ]) {
      await H.current!.client`UPDATE orders SET status = ${status} WHERE id = ${ORDER_A}`;
      expect(await resendUtmifySaleForOrderNumber("ORD-A")).toMatchObject({
        ok: false,
        orderStatus: status,
      });
    }
    expect(fetch).not.toHaveBeenCalled();
    expect(await H.current!.client`SELECT id FROM utmify_events`).toHaveLength(0);
  });

  it("keeps the authorized manual resend for PAID orders and reuses its event row", async () => {
    await saveUtmifySettings({
      storeId: STORE_A,
      webhookId: null,
      apiToken: "test-utmify-token",
      enabled: true,
      isTest: true,
    });
    await H.current!
      .client`UPDATE orders SET status = 'PAID', paid_at = now() WHERE id = ${ORDER_A}`;
    expect((await resendUtmifySaleForOrderNumber("ORD-A")).ok).toBe(true);
    expect((await resendUtmifySaleForOrderNumber("ORD-A")).ok).toBe(true);
    expect(await H.current!.client`SELECT status, attempt_count FROM utmify_events`).toEqual([
      expect.objectContaining({ status: "SENT", attempt_count: 2 }),
    ]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("preserves encrypted tokens when settings are saved without replacement", async () => {
    await saveMetaSettings({
      storeId: STORE_A,
      pixelId: "123456789",
      accessToken: "test-meta-token",
      enabled: true,
      testEventCode: null,
    });
    await saveUtmifySettings({
      storeId: STORE_A,
      webhookId: "fixture-webhook",
      apiToken: "test-utmify-token",
      enabled: true,
      isTest: true,
    });
    const [before] = await H.current!
      .client`SELECT access_token_ciphertext FROM meta_tracking_settings WHERE store_id = ${STORE_A}`;
    await saveMetaSettings({
      storeId: STORE_A,
      pixelId: "123456789",
      enabled: true,
      testEventCode: "TEST",
    });
    await saveUtmifySettings({
      storeId: STORE_A,
      webhookId: "new-webhook",
      enabled: true,
      isTest: true,
    });
    const [after] = await H.current!
      .client`SELECT access_token_ciphertext FROM meta_tracking_settings WHERE store_id = ${STORE_A}`;
    expect(after!["access_token_ciphertext"]).toBe(before!["access_token_ciphertext"]);
    expect((await getMetaSettingsWithToken(STORE_A))?.accessToken).toBe("test-meta-token");
    expect((await getUtmifySettingsWithToken(STORE_A))?.apiToken).toBe("test-utmify-token");
    expect(await getPublicMetaConfig(STORE_A)).toEqual({ pixelId: "123456789", enabled: true });
    expect(JSON.stringify(await getPublicMetaConfig(STORE_A))).not.toMatch(/token|ciphertext/i);
  });

  it("keeps digital orders without an address and reconstructs real joined line items", async () => {
    await H.current!
      .client`INSERT INTO products (id,store_id,sku,slug,name,price_cents,currency,weight_grams) VALUES (${PRODUCT},${STORE_A},'TEST-EBOOK','fixture-ebook','Fixture ebook',2000,'USD',0)`;
    await H.current!
      .client`INSERT INTO order_items (order_id,product_id,product_name,sku,unit_price_cents,quantity,total_cents) VALUES (${ORDER_A},${PRODUCT},'Fixture ebook','TEST-EBOOK',2000,1,2000)`;
    const result = await loadOrderContext(ORDER_A);
    expect(result).toMatchObject({
      orderId: ORDER_A,
      storeId: STORE_A,
      email: "reader@example.com",
      phone: null,
      country: null,
      city: null,
      storeDomain: "books.example",
      items: [{ productId: PRODUCT, quantity: 1, totalCents: 2000 }],
    });
  });

  it("dispatches only PAID sales and reuses local idempotency records", async () => {
    await saveMetaSettings({
      storeId: STORE_A,
      pixelId: "123456789",
      accessToken: "test-meta-token",
      enabled: true,
      testEventCode: null,
    });
    await saveUtmifySettings({
      storeId: STORE_A,
      webhookId: null,
      apiToken: "test-utmify-token",
      enabled: true,
      isTest: true,
    });
    expect(await sendPurchaseForOrder({ storeId: STORE_A, orderId: ORDER_A })).toEqual({
      ok: true,
      skipped: "order_not_paid",
    });
    expect(await sendSaleForOrder({ storeId: STORE_A, orderId: ORDER_A })).toEqual({
      ok: true,
      skipped: "order_not_paid",
    });
    expect(fetch).not.toHaveBeenCalled();
    await H.current!
      .client`UPDATE orders SET status = 'PAID', paid_at = now() WHERE id = ${ORDER_A}`;
    expect((await sendPurchaseForOrder({ storeId: STORE_A, orderId: ORDER_A })).ok).toBe(true);
    expect((await sendSaleForOrder({ storeId: STORE_A, orderId: ORDER_A })).ok).toBe(true);
    expect(await sendPurchaseForOrder({ storeId: STORE_A, orderId: ORDER_A })).toEqual({
      ok: true,
      skipped: "already_sent",
    });
    expect(await sendSaleForOrder({ storeId: STORE_A, orderId: ORDER_A })).toEqual({
      ok: true,
      skipped: "already_sent",
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(
      await H.current!.client`SELECT status,attempt_count FROM meta_conversion_events`,
    ).toEqual([expect.objectContaining({ status: "SENT", attempt_count: 1 })]);
    expect(await H.current!.client`SELECT status,attempt_count FROM utmify_events`).toEqual([
      expect.objectContaining({ status: "SENT", attempt_count: 1 }),
    ]);
  });
});
