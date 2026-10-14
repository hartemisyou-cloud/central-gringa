// @ts-nocheck -- in-memory DB fake; runtime assertions cover behavior.
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * In-memory fake of the Supabase admin client covering the calls used by the
 * webhook pipeline. `failOn` injects DB errors to exercise retry safety.
 */
type Row = Record<string, unknown>;
const db: Record<string, Row[]> = {};
const failOn = new Set<string>(); // e.g. "update:orders", "rpc:commit_order_stock"
const rpcCalls: string[] = [];

function query(table: string) {
  const filters: Array<[string, unknown]> = [];
  let op: "select" | "update" | "insert" = "select";
  let patch: Row = {};
  const match = () => (db[table] ?? []).filter((r) => filters.every(([k, v]) => r[k] === v));
  const run = () => {
    if (failOn.has(`${op}:${table}`)) return { data: null, error: { message: `boom ${op} ${table}` } };
    if (op === "update") {
      match().forEach((r) => Object.assign(r, patch));
      return { data: null, error: null };
    }
    return { data: match(), error: null };
  };
  const q = {
    select: () => q,
    eq: (k: string, v: unknown) => (filters.push([k, v]), q),
    update: (p: Row) => ((op = "update"), (patch = p), q),
    insert: (row: Row) => {
      op = "insert";
      if (failOn.has(`insert:${table}`)) return Promise.resolve({ error: { message: "boom" } });
      const rows = (db[table] ??= []);
      if (table === "webhook_events" && rows.some((r) => r.stripe_event_id === row.stripe_event_id)) {
        return Promise.resolve({ error: { message: "duplicate key" } });
      }
      rows.push({ provider: "STRIPE", processing_status: "RECEIVED", received_at: new Date().toISOString(), ...row });
      return Promise.resolve({ error: null });
    },
    maybeSingle: () => {
      const r = run();
      return Promise.resolve({ data: r.error ? null : ((r.data as Row[])[0] ?? null), error: r.error });
    },
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
  };
  return q;
}

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (t: string) => query(t),
    rpc: (name: string, args: { _order_id: string }) => {
      if (failOn.has(`rpc:${name}`)) return Promise.resolve({ error: { message: `boom ${name}` } });
      rpcCalls.push(name);
      if (name === "commit_order_stock") {
        const o = db.orders.find((r) => r.id === args._order_id);
        if (o) o.stock_committed = true;
      }
      return Promise.resolve({ error: null });
    },
  },
}));
vi.mock("./crypto.server", () => ({ decryptSecret: async () => "whsec_test" }));
vi.mock("./stripe.server", () => ({
  constructStripeEvent: async (raw: string) => JSON.parse(raw),
}));
vi.mock("@/lib/analytics/ingest.server", () => ({ recordServerEvent: async () => {} }));
vi.mock("@/lib/meta/capi.server", () => ({ sendPurchaseForOrder: async () => {} }));
vi.mock("@/lib/utmify/api.server", () => ({ sendSaleForOrder: async () => {} }));

import { processStripeWebhook } from "./webhooks.server";

let seq = 0;
function event(type: string, object: Row) {
  return JSON.stringify({ id: `evt_${++seq}`, type, livemode: false, data: { object } });
}
const send = (rawBody: string) =>
  processStripeWebhook({ integrationId: "int_1", rawBody, signature: "t=1,v1=x" });
const payment = () => db.payments[0];
const order = () => db.orders[0];
const webhook = (raw: string) => db.webhook_events.find((r) => r.stripe_event_id === JSON.parse(raw).id);

beforeEach(() => {
  failOn.clear();
  rpcCalls.length = 0;
  db.stripe_integrations = [{ id: "int_1", environment: "test", webhook_secret_ciphertext: "x" }];
  db.webhook_events = [];
  db.payment_events = [];
  db.refunds = [];
  db.orders = [{ id: "ord_1", status: "AWAITING_PAYMENT", stock_committed: false }];
  db.payments = [
    {
      id: "pay_1", order_id: "ord_1", store_id: "s", integration_id: "int_1", provider: "STRIPE",
      provider_payment_id: "pi_1", status: "PENDING", amount_cents: 2000, refunded_cents: 0, currency: "USD",
    },
  ];
});

describe("webhook terminal-state guards", () => {
  it("late payment_failed after success changes nothing", async () => {
    await send(event("payment_intent.succeeded", { id: "pi_1" }));
    expect(order().status).toBe("PAID");
    const raw = event("payment_intent.payment_failed", { id: "pi_1", last_payment_error: { message: "x" } });
    await send(raw);
    expect(payment().status).toBe("SUCCEEDED");
    expect(payment().last_error).toBeUndefined();
    expect(order().status).toBe("PAID");
    expect(rpcCalls).not.toContain("release_order_stock");
  });

  it("late failure / cancel / success never undo a refund", async () => {
    await send(event("payment_intent.succeeded", { id: "pi_1" }));
    await send(event("charge.refunded", { payment_intent: "pi_1", amount_refunded: 2000 }));
    expect(order().status).toBe("REFUNDED");
    await send(event("payment_intent.payment_failed", { id: "pi_1" }));
    await send(event("payment_intent.canceled", { id: "pi_1" }));
    await send(event("payment_intent.succeeded", { id: "pi_1" }));
    expect(payment().status).toBe("REFUNDED");
    expect(order().status).toBe("REFUNDED");
  });

  it("a delayed partial refund never shrinks a full refund", async () => {
    await send(event("payment_intent.succeeded", { id: "pi_1" }));
    await send(event("charge.refunded", { payment_intent: "pi_1", amount_refunded: 2000 }));
    await send(event("charge.refunded", { payment_intent: "pi_1", amount_refunded: 500 }));
    expect(payment().refunded_cents).toBe(2000);
    expect(order().status).toBe("REFUNDED");
  });

  it("late failure after cancel keeps the order CANCELLED", async () => {
    await send(event("payment_intent.canceled", { id: "pi_1" }));
    await send(event("payment_intent.payment_failed", { id: "pi_1" }));
    expect(payment().status).toBe("CANCELLED");
    expect(order().status).toBe("CANCELLED");
  });
});

describe("webhook DB failures are retried, never marked PROCESSED", () => {
  it("order update error → FAILED + throws; Stripe retry completes delivery", async () => {
    const raw = event("payment_intent.succeeded", { id: "pi_1" });
    failOn.add("update:orders");
    await expect(send(raw)).rejects.toThrow(/Order update failed/);
    expect(webhook(raw)?.processing_status).toBe("FAILED");
    expect(order().status).toBe("AWAITING_PAYMENT");

    failOn.clear();
    const res = await send(raw); // same event id = Stripe retry
    expect(res.status).toBe(200);
    expect(webhook(raw)?.processing_status).toBe("PROCESSED");
    expect(order().status).toBe("PAID");
    expect(order().stock_committed).toBe(true);
  });

  it("stock RPC error keeps the event FAILED and is retried", async () => {
    const raw = event("payment_intent.succeeded", { id: "pi_1" });
    failOn.add("rpc:commit_order_stock");
    await expect(send(raw)).rejects.toThrow(/commit_order_stock/);
    expect(webhook(raw)?.processing_status).toBe("FAILED");
    failOn.clear();
    await send(raw);
    expect(webhook(raw)?.processing_status).toBe("PROCESSED");
    expect(rpcCalls.filter((c) => c === "commit_order_stock")).toHaveLength(1);
  });

  it("payment update error on failure event leaves no partial order change", async () => {
    const raw = event("payment_intent.payment_failed", { id: "pi_1" });
    failOn.add("update:payments");
    await expect(send(raw)).rejects.toThrow();
    expect(order().status).toBe("AWAITING_PAYMENT");
    expect(webhook(raw)?.processing_status).toBe("FAILED");
  });
});

describe("webhook duplicates", () => {
  it("PROCESSED duplicate → 200 no-op", async () => {
    const raw = event("payment_intent.succeeded", { id: "pi_1" });
    await send(raw);
    const res = await send(raw);
    expect(res.body).toMatchObject({ duplicate: true });
    expect(rpcCalls.filter((c) => c === "commit_order_stock")).toHaveLength(1);
  });

  it("fresh in-flight RECEIVED duplicate → non-2xx so Stripe retries", async () => {
    const raw = event("payment_intent.succeeded", { id: "pi_1" });
    db.webhook_events.push({ provider: "STRIPE", stripe_event_id: JSON.parse(raw).id, processing_status: "RECEIVED", received_at: new Date().toISOString() });
    const res = await send(raw);
    expect(res.status).toBe(409);
    expect(order().status).toBe("AWAITING_PAYMENT");
  });

  it("stuck RECEIVED (>2 min, crashed delivery) is reprocessed", async () => {
    const raw = event("payment_intent.succeeded", { id: "pi_1" });
    db.webhook_events.push({ provider: "STRIPE", stripe_event_id: JSON.parse(raw).id, processing_status: "RECEIVED", received_at: new Date(Date.now() - 5 * 60_000).toISOString() });
    const res = await send(raw);
    expect(res.status).toBe(200);
    expect(order().status).toBe("PAID");
    expect(webhook(raw)?.processing_status).toBe("PROCESSED");
  });
});
