// @ts-nocheck -- transport adapter executes production statements against PGlite; runtime assertions cover the test fixtures.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";

type Row = Record<string, any>;
type Query = { text: string; values: unknown[] };
let pg: PGlite;
const db: Record<string, Row[]> = {};
const failOn = new Set<string>();
const rpcCalls: string[] = [];
let orderReadGate: (() => Promise<void>) | undefined;
const dispatch = vi.hoisted(() => ({ email: vi.fn(), meta: vi.fn(), sale: vi.fn() }));

// Execute the production parameterized statements against real PostgreSQL.
// Only connection transport, external Stripe/analytics calls, and injected
// failures are substituted; filters, updates and uniqueness run in PGlite.
function tag(parts: TemplateStringsArray, ...values: unknown[]): Query {
  return { text: parts.reduce((text, part, index) => text + (index ? `$${index}` : "") + part, ""), values };
}
tag.json = (value: unknown) => JSON.stringify(value);

async function execute(query: Query) {
  const statement = query.text.replace(/\s+/g, " ").trim();
  const mutation = /\b(update|insert into) public\.(\w+)/.exec(statement);
  const rpc = /select public\.(\w+)\(/.exec(statement)?.[1];
  const key = rpc ? `rpc:${rpc}` : mutation ? `${mutation[1] === "update" ? "update" : "insert"}:${mutation[2]}` : "";
  const completion = statement.includes("processing_status = 'PROCESSED'");
  if (failOn.has(key) || (completion && failOn.has("complete:webhook_events"))) {
    return { data: null, error: { code: "TEST_FAILURE", message: `boom ${key}` } };
  }
  try {
    const result = await pg.query<Row>(query.text, query.values);
    if (/select status, stock_committed from public\.orders/.test(statement)) await orderReadGate?.();
    if (rpc && result.rows.length) rpcCalls.push(rpc);
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
vi.mock("@/lib/meta/capi.server", () => ({ sendPurchaseForOrder: dispatch.meta }));
vi.mock("@/lib/utmify/api.server", () => ({ sendSaleForOrder: dispatch.sale }));
vi.mock("./delivery-email.server", () => ({ sendDeliveryEmailForOrder: dispatch.email }));

import { processStripeWebhook } from "./webhooks.server";

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(`
    create table stripe_integrations (id text primary key, environment text, webhook_secret_ciphertext text);
    create table orders (id text primary key, status text, stock_committed boolean default false, paid_at timestamptz,
      store_id text default 's', environment text default 'test', total_cents integer default 2000,
      currency text default 'USD', order_number text default 'ORD-FIXTURE', checkout_customer_details jsonb);
    create table payments (id text primary key, order_id text, store_id text, integration_id text, provider text,
      provider_payment_id text, status text, amount_cents integer, refunded_cents integer, currency text,
      payment_method text, last_error text, environment text default 'test', attempt integer default 1,
      idempotency_key text default 'payment:create:ord_1:1');
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
async function send(rawBody: string, integrationId = "int_1") {
  try { return await processStripeWebhook({ integrationId, rawBody, signature: "t=1,v1=x" }); }
  finally { await refresh(); }
}
const payment = () => db.payments![0]!;
const order = () => db.orders![0]!;
const webhook = (raw: string) => db.webhook_events!.find((row) => row.stripe_event_id === JSON.parse(raw).id);

beforeEach(async () => {
  dispatch.email.mockReset().mockResolvedValue({ sent: true });
  dispatch.meta.mockReset().mockResolvedValue({ ok: true });
  dispatch.sale.mockReset().mockResolvedValue({ ok: true });
  failOn.clear();
  rpcCalls.length = 0;
  orderReadGate = undefined;
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

describe("hosted ebook Checkout Session webhook", () => {
  const session = (overrides: Row = {}) => ({
    id: "cs_test_1", mode: "payment", status: "complete", livemode: false,
    payment_status: "paid", amount_total: 2000, currency: "usd", payment_intent: "pi_checkout_1",
    metadata: { order_id: "ord_1", store_id: "s", environment: "test", order_number: "ORD-FIXTURE",
      category: "ebook", product_type: "ebook", quantity: "1", sku: "HHB-EB-020" },
    ...overrides,
  });

  beforeEach(async () => {
    await pg.exec(`
      update orders set status = 'PAYMENT_PROCESSING';
      update payments set provider_payment_id = 'cs_test_1', status = 'REQUIRES_PAYMENT',
        idempotency_key = 'checkout:create:ord_1:1';
      insert into payment_events (payment_id, order_id, type, metadata)
        values ('pay_1', 'ord_1', 'CHECKOUT_SESSION_CREATED', '{"checkout_session_id":"cs_test_1","attempt":1}');
    `);
    await refresh();
  });

  it("completed paid binds the Session's real PI and uses the normal PAID/stock pipeline", async () => {
    const result = await send(event("checkout.session.completed", session()));
    expect(result.status).toBe(200);
    expect(payment()).toMatchObject({ provider_payment_id: "pi_checkout_1", status: "SUCCEEDED" });
    expect(order()).toMatchObject({ status: "PAID", stock_committed: true });
    expect(order().paid_at).not.toBeNull();
    expect(rpcCalls).toEqual(["commit_order_stock"]);
    const rows = (await pg.query("select type, metadata from payment_events order by type")).rows;
    expect(rows.map((row) => row.type)).toEqual(["CHECKOUT_SESSION_CREATED", "PAYMENT_SUCCEEDED"]);
    expect(rows[0].metadata).toEqual({ checkout_session_id: "cs_test_1", attempt: 1 });
  });

  it("persists only real contact fields from a bound signed Session before analytics and delivery", async () => {
    const expected = { name: "Hope Human", email: "reader@example.com", address: { country: "br", city: "Salvador" } };
    dispatch.meta.mockImplementation(async () => {
      const [saved] = (await pg.query("select status, checkout_customer_details from orders")).rows;
      expect(saved).toMatchObject({ status: "PAID", checkout_customer_details: expected });
    });
    await send(event("checkout.session.completed", session({ customer_details: {
      name: " Hope Human ", email: " Reader@EXAMPLE.COM ", address: { country: "BR", city: "Salvador", line1: "unneeded" },
      tax_ids: [{ value: "discarded" }],
    } })));
    expect(order().checkout_customer_details).toEqual(expected);
    expect(dispatch.meta).toHaveBeenCalledOnce();
    expect(dispatch.sale).toHaveBeenCalledOnce();
    expect(dispatch.email).toHaveBeenCalledWith("ord_1", "s");
  });

  it("does not store contact data from a mismatched Session", async () => {
    await send(event("checkout.session.completed", session({ amount_total: 1,
      customer_details: { name: "Wrong", email: "wrong@example.com", address: { country: "US" } } })));
    expect(order().checkout_customer_details).toBeNull();
    expect(dispatch.email).not.toHaveBeenCalled();
  });

  it("delivery failure leaves PAID intact and webhook replay retries without repeating stock", async () => {
    dispatch.email.mockRejectedValueOnce(new Error("E-book delivery provider HTTP 503."));
    const raw = event("checkout.session.completed", session());
    await expect(send(raw)).rejects.toThrow("HTTP 503");
    expect(order().status).toBe("PAID");
    expect(webhook(raw).processing_status).toBe("FAILED");
    expect(dispatch.meta).toHaveBeenCalledOnce();
    expect(dispatch.sale).toHaveBeenCalledOnce();
    await send(raw);
    expect(webhook(raw).processing_status).toBe("PROCESSED");
    expect(dispatch.email).toHaveBeenCalledTimes(2);
    expect(rpcCalls).toEqual(["commit_order_stock"]);
  });

  it("still attempts UTMify and delivery when Meta dispatch rejects", async () => {
    dispatch.meta.mockRejectedValueOnce(new Error("Tracker unavailable"));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const result = await send(event("checkout.session.completed", session()));
      expect(result.status).toBe(200);
      expect(order().status).toBe("PAID");
      expect(dispatch.meta).toHaveBeenCalledOnce();
      expect(dispatch.sale).toHaveBeenCalledOnce();
      expect(dispatch.email).toHaveBeenCalledOnce();
    } finally { log.mockRestore(); }
  });

  it("repeated completed deliveries, distinct events and later PI success never repeat fulfillment or reset paid_at", async () => {
    const raw = event("checkout.session.completed", session());
    await send(raw);
    const paidAt = order().paid_at;
    expect((await send(raw)).body).toMatchObject({ duplicate: true });
    await send(event("checkout.session.completed", session()));
    await send(event("payment_intent.succeeded", { id: "pi_checkout_1" }));
    expect(order().paid_at).toEqual(paidAt);
    expect(rpcCalls).toEqual(["commit_order_stock"]);
    expect((await pg.query("select * from payment_events where type = 'PAYMENT_SUCCEEDED'")).rows).toHaveLength(1);
  });

  it("PI success before Session binding is ignored and the paid Session still completes the order", async () => {
    await send(event("payment_intent.succeeded", { id: "pi_checkout_1" }));
    expect(order().status).toBe("PAYMENT_PROCESSING");
    expect(payment().provider_payment_id).toBe("cs_test_1");
    await send(event("checkout.session.completed", session()));
    expect(order().status).toBe("PAID");
    expect(rpcCalls).toEqual(["commit_order_stock"]);
  });

  it("concurrent Session and PI success commit stock only once after both read an uncommitted order", async () => {
    await send(event("checkout.session.completed", session({ payment_status: "unpaid" })));
    let reads = 0;
    let resume!: () => void;
    const bothRead = new Promise<void>((resolve) => { resume = resolve; });
    orderReadGate = async () => {
      if (++reads === 2) resume();
      await bothRead;
    };
    await Promise.all([
      send(event("checkout.session.completed", session())),
      send(event("payment_intent.succeeded", { id: "pi_checkout_1" })),
    ]);
    orderReadGate = undefined;
    expect(reads).toBe(2);
    expect(order()).toMatchObject({ status: "PAID", stock_committed: true });
    expect(rpcCalls).toEqual(["commit_order_stock"]);
    const paidAt = order().paid_at;
    await send(event("checkout.session.completed", session()));
    expect(order().paid_at).toEqual(paidAt);
  });

  it("unpaid completed binds PI without unlocking downloads; later PI success completes it", async () => {
    await send(event("checkout.session.completed", session({ payment_status: "unpaid" })));
    expect(payment()).toMatchObject({ provider_payment_id: "pi_checkout_1", status: "REQUIRES_PAYMENT" });
    expect(order().status).toBe("PAYMENT_PROCESSING");
    expect(rpcCalls).toEqual([]);
    await send(event("payment_intent.succeeded", { id: "pi_checkout_1" }));
    expect(order().status).toBe("PAID");
    expect(rpcCalls).toEqual(["commit_order_stock"]);
  });

  it("async payment succeeded uses the same binding and PAID pipeline", async () => {
    await send(event("checkout.session.completed", session({ payment_status: "unpaid" })));
    await send(event("checkout.session.async_payment_succeeded", session()));
    expect(order().status).toBe("PAID");
    expect(payment().status).toBe("SUCCEEDED");
    expect(rpcCalls).toEqual(["commit_order_stock"]);
  });

  it.each([
    ["unknown Session and PI", { id: "cs_unknown", payment_intent: "pi_unknown" }],
    ["wrong amount", { amount_total: 1999 }],
    ["wrong currency", { currency: "eur" }],
    ["wrong checkout mode", { mode: "subscription" }],
    ["wrong object environment", { livemode: true }],
    ["open Session", { status: "open" }],
    ["missing PI", { payment_intent: null }],
    ["non-payment PI", { payment_intent: "cs_not_a_pi" }],
    ["no-payment-required", { payment_status: "no_payment_required" }],
    ["wrong order", { metadata: { ...session().metadata, order_id: "ord_unknown" } }],
    ["wrong store", { metadata: { ...session().metadata, store_id: "another_store" } }],
    ["wrong metadata environment", { metadata: { ...session().metadata, environment: "live" } }],
    ["wrong order number", { metadata: { ...session().metadata, order_number: "ORD-OTHER" } }],
    ["no metadata", { metadata: null }],
  ])("ignores %s without mutating local financial state", async (_name, overrides) => {
    await send(event("checkout.session.completed", session(overrides)));
    expect(payment()).toMatchObject({ provider_payment_id: "cs_test_1", status: "REQUIRES_PAYMENT" });
    expect(order().status).toBe("PAYMENT_PROCESSING");
    expect(rpcCalls).toEqual([]);
  });

  it.each([
    ["order store", "update orders set store_id = 'other'"],
    ["order environment", "update orders set environment = 'live'"],
    ["order amount", "update orders set total_cents = 1000"],
    ["order currency", "update orders set currency = 'EUR'"],
    ["payment environment", "update payments set environment = 'live'"],
    ["Elements attempt", "update payments set idempotency_key = 'payment:create:ord_1:1'"],
    ["wrong attempt", "update payments set attempt = 2"],
    ["different bound PI", "update payments set provider_payment_id = 'pi_other'"],
  ])("ignores a mismatch in the stored %s", async (_name, statement) => {
    await pg.exec(statement);
    await refresh();
    const before = { ...payment() };
    await send(event("checkout.session.completed", session()));
    expect(payment()).toEqual(before);
    expect(order().status).toBe("PAYMENT_PROCESSING");
    expect(rpcCalls).toEqual([]);
  });

  it("ignores another integration's signed endpoint even when the metadata and amount match", async () => {
    await pg.exec("insert into stripe_integrations values ('int_2', 'test', 'x')");
    await send(event("checkout.session.completed", session()), "int_2");
    expect(payment().provider_payment_id).toBe("cs_test_1");
    expect(order().status).toBe("PAYMENT_PROCESSING");
    expect(rpcCalls).toEqual([]);
  });

  it.each(["REFUNDED", "PARTIALLY_REFUNDED", "CANCELLED"])("late Session success never undoes %s", async (status) => {
    await pg.query("update payments set status = $1", [status]);
    await pg.query("update orders set status = $1", [status]);
    await send(event("checkout.session.completed", session()));
    expect(payment()).toMatchObject({ status, provider_payment_id: "cs_test_1" });
    expect(order().status).toBe(status);
    expect(rpcCalls).toEqual([]);
  });

  it("a refunded order is protected even if its payment attempt is not yet marked refunded", async () => {
    await pg.exec("update orders set status = 'REFUNDED'");
    await send(event("checkout.session.completed", session()));
    expect(payment().provider_payment_id).toBe("cs_test_1");
    expect(order().status).toBe("REFUNDED");
    expect(rpcCalls).toEqual([]);
  });

  it.each([
    ["binding", "update:payments"],
    ["order", "update:orders"],
    ["stock", "rpc:commit_order_stock"],
    ["completion record", "complete:webhook_events"],
  ])("a transient %s error stays FAILED and replay completes with one stock commit", async (_name, failure) => {
    const raw = event("checkout.session.completed", session());
    failOn.add(failure);
    await expect(send(raw)).rejects.toThrow();
    expect(webhook(raw)?.processing_status).toBe("FAILED");
    failOn.clear();
    await send(raw);
    expect(order()).toMatchObject({ status: "PAID", stock_committed: true });
    expect(payment()).toMatchObject({ status: "SUCCEEDED", provider_payment_id: "pi_checkout_1" });
    expect(webhook(raw)?.processing_status).toBe("PROCESSED");
    expect(rpcCalls.filter((name) => name === "commit_order_stock")).toHaveLength(1);
  });
});
