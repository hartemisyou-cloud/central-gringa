// @ts-nocheck -- transport adapter executes production statements against PGlite; runtime assertions cover the test fixtures.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";

type Row = Record<string, any>;
type Query = { text: string; values: unknown[] };
let pg: PGlite;
const db: Record<string, Row[]> = {};
const failOn = new Set<string>();
const rpcCalls: string[] = [];

// Execute the production parameterized statements against real PostgreSQL.
// Only connection transport, external Stripe/analytics calls, and injected
// failures are substituted; filters, updates and uniqueness run in PGlite.
function tag(parts: TemplateStringsArray, ...values: unknown[]): Query {
  return { text: parts.reduce((text, part, index) => text + (index ? `$${index}` : "") + part, ""), values };
}
tag.json = (value: unknown) => JSON.stringify(value);

async function execute(query: Query) {
  const statement = query.text.replace(/\s+/g, " ").trim();
  const mutation = /^(update|insert into) public\.(\w+)/.exec(statement);
  const rpc = /select public\.(\w+)\(/.exec(statement)?.[1];
  const key = rpc ? `rpc:${rpc}` : mutation ? `${mutation[1] === "update" ? "update" : "insert"}:${mutation[2]}` : "";
  const completion = statement.includes("processing_status = 'PROCESSED'");
  if (failOn.has(key) || (completion && failOn.has("complete:webhook_events"))) {
    return { data: null, error: { code: "TEST_FAILURE", message: `boom ${key}` } };
  }
  try {
    const result = await pg.query<Row>(query.text, query.values);
    if (rpc) rpcCalls.push(rpc);
    const rows = result.rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value instanceof Date ? value.toISOString() : value])));
    return { data: rows, error: null };
  } catch (error) {
    const failure = error as { code?: string; message: string };
    return { data: null, error: { code: failure.code ?? "DATABASE_ERROR", message: failure.message } };
  }
}

vi.mock("@/lib/db/client.server", () => ({
  sql: tag,
  one: async (query: Query, maybe = false) => {
    const result = await execute(query);
    if (result.error) return result;
    if (result.data!.length === 1) return { data: result.data![0], error: null };
    if (maybe && result.data!.length === 0) return { data: null, error: null };
    return { data: null, error: { code: "CARDINALITY_ERROR", message: "Expected a single database row." } };
  },
  exec: async (query: Query) => {
    const result = await execute(query);
    return { data: null, error: result.error };
  },
}));
vi.mock("./crypto.server", () => ({ decryptSecret: async () => "whsec_test" }));
vi.mock("./stripe.server", () => ({ constructStripeEvent: async (raw: string) => JSON.parse(raw) }));
vi.mock("@/lib/donations/service.server", () => ({ handleDonationEvent: async () => null }));
vi.mock("@/lib/analytics/ingest.server", () => ({ recordServerEvent: async () => {} }));
vi.mock("@/lib/meta/capi.server", () => ({ sendPurchaseForOrder: async () => {} }));
vi.mock("@/lib/utmify/api.server", () => ({ sendSaleForOrder: async () => {} }));

import { processStripeWebhook } from "./webhooks.server";

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(`
    create table stripe_integrations (id text primary key, environment text, webhook_secret_ciphertext text);
    create table orders (id text primary key, status text, stock_committed boolean default false, paid_at timestamptz);
    create table payments (id text primary key, order_id text, store_id text, integration_id text, provider text,
      provider_payment_id text, status text, amount_cents integer, refunded_cents integer, currency text,
      payment_method text, last_error text);
    create table webhook_events (provider text default 'STRIPE', stripe_event_id text, event_type text,
      livemode boolean, integration_id text, payload_summary jsonb, processing_status text default 'RECEIVED',
      received_at timestamptz default now(), processed boolean default false, processed_at timestamptz,
      error_message text, unique(provider, stripe_event_id));
    create table payment_events (payment_id text, order_id text, type text, message text, metadata jsonb);
    create table refunds (payment_id text, status text);
    create function commit_order_stock(_order_id text) returns void language sql as
      $$ update orders set stock_committed = true where id = _order_id $$;
    create function release_order_stock(_order_id text) returns void language sql as
      $$ update orders set stock_committed = false where id = _order_id $$;
  `);
});
afterAll(async () => { await pg.close(); });

async function refresh() {
  for (const table of ["orders", "payments", "webhook_events"]) {
    db[table] = (await pg.query<Row>(`select * from ${table}`)).rows;
  }
}
async function seedReceived(eventId: string, receivedAt: string) {
  await pg.query("insert into webhook_events (stripe_event_id, processing_status, received_at) values ($1, 'RECEIVED', $2)", [eventId, receivedAt]);
}

let seq = 0;
function event(type: string, object: Row) {
  return JSON.stringify({ id: `evt_${++seq}`, type, livemode: false, data: { object } });
}
async function send(rawBody: string) {
  try { return await processStripeWebhook({ integrationId: "int_1", rawBody, signature: "t=1,v1=x" }); }
  finally { await refresh(); }
}
const payment = () => db.payments![0]!;
const order = () => db.orders![0]!;
const webhook = (raw: string) => db.webhook_events!.find((row) => row.stripe_event_id === JSON.parse(raw).id);

beforeEach(async () => {
  failOn.clear();
  rpcCalls.length = 0;
  await pg.exec(`
    truncate stripe_integrations, orders, payments, webhook_events, payment_events, refunds;
    insert into stripe_integrations values ('int_1', 'test', 'x');
    insert into orders (id, status) values ('ord_1', 'AWAITING_PAYMENT');
    insert into payments (id, order_id, store_id, integration_id, provider, provider_payment_id, status,
      amount_cents, refunded_cents, currency) values ('pay_1', 'ord_1', 's', 'int_1', 'STRIPE', 'pi_1', 'PENDING', 2000, 0, 'USD');
  `);
  await refresh();
});

describe("webhook terminal-state guards", () => {
  it("late payment_failed after success changes nothing", async () => {
    await send(event("payment_intent.succeeded", { id: "pi_1" }));
    expect(order().status).toBe("PAID");
    const raw = event("payment_intent.payment_failed", { id: "pi_1", last_payment_error: { message: "x" } });
    await send(raw);
    expect(payment().status).toBe("SUCCEEDED");
    expect(payment().last_error).toBeNull();
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
    await seedReceived(JSON.parse(raw).id, new Date().toISOString());
    const res = await send(raw);
    expect(res.status).toBe(409);
    expect(order().status).toBe("AWAITING_PAYMENT");
  });

  it("stuck RECEIVED (>2 min, crashed delivery) is reprocessed", async () => {
    const raw = event("payment_intent.succeeded", { id: "pi_1" });
    await seedReceived(JSON.parse(raw).id, new Date(Date.now() - 5 * 60_000).toISOString());
    const res = await send(raw);
    expect(res.status).toBe(200);
    expect(order().status).toBe("PAID");
    expect(webhook(raw)?.processing_status).toBe("PROCESSED");
  });
});


describe("webhook persistence failures", () => {
  it("recording failure is never acknowledged as a duplicate or applied", async () => {
    const raw = event("payment_intent.succeeded", { id: "pi_1" });
    failOn.add("insert:webhook_events");
    await expect(send(raw)).rejects.toThrow(/Webhook recording failed/);
    expect(webhook(raw)).toBeUndefined();
    expect(order().status).toBe("AWAITING_PAYMENT");
    failOn.clear();
    await send(raw);
    expect(order().status).toBe("PAID");
  });

  it("completion-write failure returns an error and retry finishes without a second stock commit", async () => {
    const raw = event("payment_intent.succeeded", { id: "pi_1" });
    failOn.add("complete:webhook_events");
    await expect(send(raw)).rejects.toThrow(/Webhook completion update/);
    expect(webhook(raw)?.processing_status).toBe("FAILED");
    expect(order().status).toBe("PAID");
    failOn.clear();
    await send(raw);
    expect(webhook(raw)?.processing_status).toBe("PROCESSED");
    expect(rpcCalls.filter((name) => name === "commit_order_stock")).toHaveLength(1);
  });
});
