import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { createHash, createHmac } from "node:crypto";
import { createTestClient } from "@/lib/db/test-client";

const H = vi.hoisted(() => ({
  current: null as Awaited<ReturnType<typeof createTestClient>> | null,
  delivery: vi.fn(async () => ({ sent: true })),
}));
vi.mock("@/lib/payments/delivery-email.server", () => ({ sendDeliveryEmailForOrder: H.delivery }));
vi.mock("@/lib/donations/service.server", () => ({ handleDonationEvent: async () => null }));
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
import { processStripeWebhook } from "@/lib/payments/webhooks.server";
import { encryptSecret } from "@/lib/payments/crypto.server";

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
  H.delivery.mockClear();
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
      ok: false,
      error: "Order not found in the selected store.",
      permanent: true,
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
      environment: "test",
      email: "reader@example.com",
      phone: null,
      country: null,
      city: null,
      storeDomain: "books.example",
      items: [{ productId: PRODUCT, quantity: 1, totalCents: 2000 }],
    });
  });

  it("sends automatic TEST purchases only with the configured Meta test code", async () => {
    await saveMetaSettings({
      storeId: STORE_A,
      pixelId: "123456789",
      accessToken: "test-meta-token",
      enabled: true,
      testEventCode: "TEST-FIXTURE",
    });
    await H.current!
      .client`UPDATE orders SET status = 'PAID', paid_at = now() WHERE id = ${ORDER_A}`;

    expect((await sendPurchaseForOrder({ storeId: STORE_A, orderId: ORDER_A })).ok).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]!.body));
    expect(body.test_event_code).toBe("TEST-FIXTURE");
    expect(body.data[0]).toMatchObject({
      event_name: "Purchase",
      custom_data: { currency: "USD", value: 20 },
    });
    expect(await H.current!.client`SELECT status, attempt_count FROM meta_conversion_events`).toEqual([
      expect.objectContaining({ status: "SENT", attempt_count: 1 }),
    ]);
  });

  it.each([null, "", "   "])(
    "skips automatic TEST purchases without a usable test code (%j)",
    async (testEventCode) => {
      await saveMetaSettings({
        storeId: STORE_A,
        pixelId: "123456789",
        accessToken: "test-meta-token",
        enabled: true,
        testEventCode,
      });
      await H.current!
        .client`UPDATE orders SET status = 'PAID', paid_at = now() WHERE id = ${ORDER_A}`;

      expect(await sendPurchaseForOrder({ storeId: STORE_A, orderId: ORDER_A })).toEqual({
        ok: true,
        skipped: "test_event_code_missing",
      });
      expect(fetch).not.toHaveBeenCalled();
      expect(await H.current!.client`SELECT id FROM meta_conversion_events`).toHaveLength(0);
      expect(await H.current!.client`SELECT status FROM orders WHERE id = ${ORDER_A}`).toEqual([
        expect.objectContaining({ status: "PAID" }),
      ]);
    },
  );

  it("omits the configured Meta test code for automatic LIVE purchases", async () => {
    await saveMetaSettings({
      storeId: STORE_A,
      pixelId: "123456789",
      accessToken: "test-meta-token",
      enabled: true,
      testEventCode: "TEST-FIXTURE",
    });
    await H.current!
      .client`UPDATE orders SET environment = 'live', status = 'PAID', paid_at = now() WHERE id = ${ORDER_A}`;

    expect((await sendPurchaseForOrder({ storeId: STORE_A, orderId: ORDER_A })).ok).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]!.body));
    expect(body).not.toHaveProperty("test_event_code");
    expect(body.data[0]).toMatchObject({ event_name: "Purchase" });
  });

  it("dispatches only PAID sales and reuses local idempotency records", async () => {
    await saveMetaSettings({
      storeId: STORE_A,
      pixelId: "123456789",
      accessToken: "test-meta-token",
      enabled: true,
      testEventCode: "TEST-FIXTURE",
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

  it.each([null, "Salvador"])("paid HHF sends genuine Checkout contact and order IP to both APIs (city=%j)", async (city) => {
    const q = H.current!.client;
    const details = { name: " Hope Human ", email: "  Hope.Human@Example.COM  ", address: { country: "BR", city } };
    await q`UPDATE orders SET status='PAID', paid_at='2026-10-20T21:00:00Z', origin_hhf=true,
      customer_id=NULL, client_ip='203.0.113.77', checkout_customer_details=${q.json(details)} WHERE id=${ORDER_A}`;
    await q`INSERT INTO products (id,store_id,sku,slug,name,price_cents,currency,weight_grams)
      VALUES (${PRODUCT},${STORE_A},'HHB-EB-020','the-adventures-of-tom-sawyer','The Adventures of Tom Sawyer',2000,'USD',0)`;
    await q`INSERT INTO order_items (order_id,product_id,product_name,sku,unit_price_cents,quantity,total_cents)
      VALUES (${ORDER_A},${PRODUCT},'The Adventures of Tom Sawyer','HHB-EB-020',2000,1,2000)`;
    // A later attribution IP must not replace the purchase-entry IP.
    await q`INSERT INTO order_attribution (order_id,client_ip,utm_source,utm_medium,utm_campaign,fbclid)
      VALUES (${ORDER_A},'198.51.100.88','test','manual','livecheck-fix1','IwARlivecheck')`;
    await saveMetaSettings({ storeId: STORE_A, pixelId: "1456212949742348", accessToken: "private-meta-token-ab12", enabled: true, testEventCode: "TEST83586" });
    await saveUtmifySettings({ storeId: STORE_A, webhookId: "existing-webhook", apiToken: "test-utmify-token", enabled: true, isTest: true });
    const debug = vi.spyOn(console, "debug").mockImplementation(() => undefined);
    try {
      expect(await sendPurchaseForOrder({ storeId: STORE_A, orderId: ORDER_A })).toMatchObject({ ok: true, httpStatus: 200 });
      expect(await sendSaleForOrder({ storeId: STORE_A, orderId: ORDER_A })).toMatchObject({ ok: true, httpStatus: 200 });
      expect(fetch).toHaveBeenCalledTimes(2);
      const [metaRequest, saleRequest] = vi.mocked(fetch).mock.calls;
      expect(metaRequest![0]).toBe("https://graph.facebook.com/v21.0/1456212949742348/events");
      const meta = JSON.parse(String(metaRequest![1]!.body));
      expect(meta.test_event_code).toBe("TEST83586");
      expect(meta.data[0]).toMatchObject({
        event_id: `purchase_${ORDER_A}`,
        custom_data: { value: 20, currency: "USD" },
        user_data: {
          em: [createHash("sha256").update("hope.human@example.com").digest("hex")],
          client_ip_address: "203.0.113.77",
          country: [createHash("sha256").update("br").digest("hex")],
        },
      });
      expect(meta.data[0].user_data.em[0]).toMatch(/^[0-9a-f]{64}$/);
      expect(meta.data[0].user_data.country[0]).toMatch(/^[0-9a-f]{64}$/);
      if (city) expect(meta.data[0].user_data.ct).toEqual([createHash("sha256").update("salvador").digest("hex")]);
      else expect(meta.data[0].user_data).not.toHaveProperty("ct");
      expect(saleRequest![0]).toBe("https://api.utmify.com.br/api-credentials/orders");
      const sale = JSON.parse(String(saleRequest![1]!.body));
      expect(sale).toMatchObject({
        status: "paid", isTest: true,
        customer: { name: "Hope Human", email: "hope.human@example.com", ip: "203.0.113.77", country: "br" },
        trackingParameters: { utm_source: "test", utm_medium: "manual", utm_campaign: "livecheck-fix1", fbclid: "IwARlivecheck" },
        commission: { totalPriceInCents: 2000, currency: "USD" },
      });
      expect([sale.customer.name, sale.customer.email, sale.customer.ip, sale.customer.country].every(value => value !== null)).toBe(true);
      expect((await getUtmifySettingsWithToken(STORE_A))?.webhookId).toBe("existing-webhook");
      expect(await q`SELECT status,http_status,attempt_count FROM meta_conversion_events`).toEqual([expect.objectContaining({ status: "SENT", http_status: 200, attempt_count: 1 })]);
      expect(await q`SELECT status,http_status,attempt_count FROM utmify_events`).toEqual([expect.objectContaining({ status: "SENT", http_status: 200, attempt_count: 1 })]);
      const debugText = JSON.stringify(debug.mock.calls);
      expect(debugText).not.toContain("token_suffix=ab12");
      expect(debugText).not.toContain("private-meta-token");
    } finally {
      debug.mockRestore();
    }
  });

  it("missing HHF customer fields remain absent for Meta and null for a still-attempted UTMify push", async () => {
    const q = H.current!.client;
    await q`UPDATE orders SET status='PAID', paid_at=now(), origin_hhf=true, client_ip=NULL,
      checkout_customer_details=${q.json({ name: null, email: null, address: { country: null, city: null } })}
      WHERE id=${ORDER_A}`;
    // Neither a stale customer row nor attribution may fill absent Checkout fields.
    await q`INSERT INTO order_attribution (order_id,client_ip) VALUES (${ORDER_A},'198.51.100.88')`;
    await saveMetaSettings({ storeId: STORE_A, pixelId: "1456212949742348", accessToken: "test-meta-token", enabled: true, testEventCode: "TEST83586" });
    await saveUtmifySettings({ storeId: STORE_A, webhookId: null, apiToken: "test-utmify-token", enabled: true, isTest: true });
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      expect((await sendPurchaseForOrder({ storeId: STORE_A, orderId: ORDER_A })).ok).toBe(true);
      expect((await sendSaleForOrder({ storeId: STORE_A, orderId: ORDER_A })).ok).toBe(true);
      expect(fetch).toHaveBeenCalledTimes(2);
      const meta = JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]!.body));
      for (const field of ["em", "client_ip_address", "country", "ct"]) expect(meta.data[0].user_data).not.toHaveProperty(field);
      const sale = JSON.parse(String(vi.mocked(fetch).mock.calls[1]![1]!.body));
      expect(sale.customer).toMatchObject({ name: null, email: null, ip: null, country: null });
      expect(JSON.stringify(warning.mock.calls)).toContain("missing_customer_fields=name,email,ip,country");
      expect(await q`SELECT status,attempt_count FROM utmify_events`).toEqual([expect.objectContaining({ status: "SENT", attempt_count: 1 })]);
    } finally {
      warning.mockRestore();
    }
  });

  it("records both attempts as FAILED when HTTP 200 headers are followed by a broken response body", async () => {
    const q = H.current!.client;
    await q`UPDATE orders SET status='PAID', paid_at=now(), origin_hhf=true WHERE id=${ORDER_A}`;
    await saveMetaSettings({ storeId: STORE_A, pixelId: "1456212949742348", accessToken: "test-meta-token", enabled: true, testEventCode: "TEST83586" });
    await saveUtmifySettings({ storeId: STORE_A, webhookId: null, apiToken: "test-utmify-token", enabled: true, isTest: true });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream({
      start(controller) { controller.error(new Error("response-body-interrupted")); },
    }), { status: 200 })));

    const results = await Promise.all([
      sendPurchaseForOrder({ storeId: STORE_A, orderId: ORDER_A }),
      sendSaleForOrder({ storeId: STORE_A, orderId: ORDER_A }),
    ]);
    expect(results).toEqual([
      expect.objectContaining({ ok: false, error: "response-body-interrupted" }),
      expect.objectContaining({ ok: false, error: "response-body-interrupted" }),
    ]);
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const [, request] of vi.mocked(fetch).mock.calls) expect(request?.signal).toBeInstanceOf(AbortSignal);
    for (const rows of [
      await q`SELECT status,attempt_count,last_error FROM meta_conversion_events WHERE order_id=${ORDER_A}`,
      await q`SELECT status,attempt_count,last_error FROM utmify_events WHERE order_id=${ORDER_A}`,
    ]) {
      expect(rows).toEqual([expect.objectContaining({ status: "FAILED", attempt_count: 1, last_error: "response-body-interrupted" })]);
    }
    expect(await q`SELECT status FROM orders WHERE id=${ORDER_A}`).toEqual([expect.objectContaining({ status: "PAID" })]);
  });

  it("signed HHF Checkout webhook persists customer details before both real analytics dispatches", async () => {
    const q = H.current!.client;
    const integrationId = "50000000-0000-4000-8000-000000000001";
    const paymentId = "60000000-0000-4000-8000-000000000001";
    const secret = "whsec_hhf_local_fixture_never_production";
    await q`INSERT INTO stripe_integrations (id,name,environment,publishable_key,webhook_secret_ciphertext,status)
      VALUES (${integrationId},'Fixture','test','pk_test_fixture',${await encryptSecret(secret)},'ACTIVE')`;
    await q`UPDATE orders SET customer_id=NULL, origin_hhf=true, client_ip='203.0.113.45',
      status='PAYMENT_PROCESSING', checkout_customer_details=NULL WHERE id=${ORDER_A}`;
    await q`INSERT INTO products (id,store_id,sku,slug,name,price_cents,currency,weight_grams)
      VALUES (${PRODUCT},${STORE_A},'HHB-EB-020','the-adventures-of-tom-sawyer','The Adventures of Tom Sawyer',2000,'USD',0)`;
    await q`INSERT INTO order_items (order_id,product_id,product_name,sku,unit_price_cents,quantity,total_cents)
      VALUES (${ORDER_A},${PRODUCT},'The Adventures of Tom Sawyer','HHB-EB-020',2000,1,2000)`;
    await q`INSERT INTO payments (id,store_id,order_id,integration_id,provider_payment_id,amount_cents,currency,environment,attempt,idempotency_key)
      VALUES (${paymentId},${STORE_A},${ORDER_A},${integrationId},'cs_test_hhf_fixture',2000,'USD','test',1,${`checkout:create:${ORDER_A}:1`})`;
    await saveMetaSettings({ storeId: STORE_A, pixelId: "1456212949742348", accessToken: "test-meta-token", enabled: true, testEventCode: "TEST83586" });
    await saveUtmifySettings({ storeId: STORE_A, webhookId: "unchanged-webhook", apiToken: "test-utmify-token", enabled: true, isTest: true });
    const expectedDetails = { name: "Hope Human", email: "hope.human@example.com", address: { country: "us", city: null } };
    vi.stubGlobal("fetch", vi.fn(async () => {
      const [atDispatch] = await q`SELECT status,stock_committed,checkout_customer_details FROM orders WHERE id=${ORDER_A}`;
      expect(atDispatch).toMatchObject({ status: "PAID", stock_committed: true, checkout_customer_details: expectedDetails });
      return new Response('{"events_received":1}', { status: 200 });
    }));
    const timestamp = Math.floor(Date.now() / 1000);
    const rawBody = JSON.stringify({
      id: "evt_hhf_paid_fixture", type: "checkout.session.completed", livemode: false, created: timestamp,
      data: { object: {
        id: "cs_test_hhf_fixture", payment_intent: "pi_hhf_fixture", mode: "payment", status: "complete",
        payment_status: "paid", livemode: false, amount_total: 2000, currency: "usd",
        metadata: { store_id: STORE_A, order_id: ORDER_A, order_number: "ORD-A", environment: "test" },
        customer_details: { name: "Hope Human", email: "HOPE.HUMAN@EXAMPLE.COM", address: { country: "US", city: null } },
      } },
    });
    const signature = `t=${timestamp},v1=${createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex")}`;
    expect(await processStripeWebhook({ integrationId, rawBody, signature })).toMatchObject({ status: 200 });
    expect(await q`SELECT status,customer_id,checkout_customer_details FROM orders WHERE id=${ORDER_A}`).toEqual([
      expect.objectContaining({ status: "PAID", customer_id: null, checkout_customer_details: expectedDetails }),
    ]);
    expect(await q`SELECT status,provider_payment_id FROM payments WHERE id=${paymentId}`).toEqual([
      expect.objectContaining({ status: "SUCCEEDED", provider_payment_id: "pi_hhf_fixture" }),
    ]);
    expect(fetch).toHaveBeenCalledTimes(2);
    const metaRequest = vi.mocked(fetch).mock.calls.find(([url]) => String(url).startsWith("https://graph.facebook.com/"));
    const saleRequest = vi.mocked(fetch).mock.calls.find(([url]) => String(url) === "https://api.utmify.com.br/api-credentials/orders");
    const meta = JSON.parse(String(metaRequest![1]!.body));
    expect(meta.data[0].user_data).toMatchObject({
      em: [createHash("sha256").update("hope.human@example.com").digest("hex")],
      client_ip_address: "203.0.113.45", country: [createHash("sha256").update("us").digest("hex")],
    });
    expect(meta.data[0].user_data).not.toHaveProperty("ct");
    expect(meta.data[0]).toMatchObject({ event_id: `purchase_${ORDER_A}`, custom_data: { currency: "USD", value: 20 } });
    expect(meta.test_event_code).toBe("TEST83586");
    const sale = JSON.parse(String(saleRequest![1]!.body));
    expect(sale.customer).toMatchObject({ name: "Hope Human", email: "hope.human@example.com", ip: "203.0.113.45", country: "us" });
    expect(H.delivery).toHaveBeenCalledExactlyOnceWith(ORDER_A, STORE_A);
    expect(await q`SELECT processing_status,processed FROM webhook_events WHERE stripe_event_id='evt_hhf_paid_fixture'`).toEqual([
      expect.objectContaining({ processing_status: "PROCESSED", processed: true }),
    ]);
    expect(await processStripeWebhook({ integrationId, rawBody, signature })).toMatchObject({ status: 200, body: { duplicate: true } });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(H.delivery).toHaveBeenCalledTimes(1);
  });
});
