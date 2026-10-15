// @ts-nocheck -- test doubles; runtime assertions cover behavior.
// Real Postgres (PGlite) runs the actual migrations + RPCs; Stripe is a strict fake. No network.
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  computeReleasePreview,
  createDonationSchema,
  settingsGaps,
  beneficiaryGaps,
  formatMinorUnits,
  stable,
  DEFAULT_SETTINGS,
  FOUNDATION_LOGO_URL,
  providerModelGaps,
} from "./rules";
import { makeTestDb } from "./test-db";

const H: { client: any; pg: any; failNext: Set<string> } = { client: null, pg: null, failNext: new Set() };
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (t: string) => {
      const b = H.client.from(t);
      const origUpdate = b.update;
      b.update = (v: any) => {
        if (H.failNext.has(`update:${t}`)) {
          H.failNext.delete(`update:${t}`);
          const r = origUpdate(v);
          const fail = { data: null, error: { message: "simulated DB failure" } };
          r.single = async () => fail;
          r.maybeSingle = async () => fail;
          r.then = (res: any) => Promise.resolve(fail).then(res);
          return r;
        }
        return origUpdate(v);
      };
      return b;
    },
    rpc: (n: string, a: any) => {
      if (H.failNext.has(`rpc:${n}:${a._outcome ?? ""}`)) {
        H.failNext.delete(`rpc:${n}:${a._outcome ?? ""}`);
        return Promise.resolve({ data: null, error: { message: "simulated DB failure" } });
      }
      return H.client.rpc(n, a);
    },
  },
}));

const svc = await import("./service.server");

const STORE_ID = "00000000-0000-4000-8000-000000000001";
const STORE2_ID = "00000000-0000-4000-8000-000000000002";
const INT_ID = "00000000-0000-4000-8000-0000000000a1";
const INT2_ID = "00000000-0000-4000-8000-0000000000a2";
const BEN_ID = "00000000-0000-4000-8000-0000000000b1";
const CAMP_OK = "00000000-0000-4000-8000-0000000000c1";
const CAMP_PENDING = "00000000-0000-4000-8000-0000000000c2";
const STORE = { id: STORE_ID, slug: "hope-human-books", stripe_integration_id: INT_ID, status: "ACTIVE", environment: "test" };

const READY = {
  ...DEFAULT_SETTINGS,
  use_of_funds: "Program support",
  platform_country: "US",
  stripe_fundraising_approved: true,
  connect_approved: true,
  usd_settlement_eligible: true,
  allowed_recipient_countries: ["US"],
  fee_coverage_policy: "NGO_COVERS_ALL",
  dashboard_responsibility: "EXPRESS",
  negative_balance_liability: "PLATFORM",
  donations_enabled: true,
  releases_enabled: true,
  manual_payout_schedule_confirmed: true,
  max_hold_days: 90,
  legal_account_name_confirmed: true,
  ngo_fee_funding_cents: 10000,
  confirmed_by: "Test Human",
  confirmed_at: "2026-01-01T00:00:00Z",
};
const BEN = { id: BEN_ID, store_id: STORE_ID, display_name: "Recipient", country: "US", stripe_account_id: "acct_123", service_agreement: "full", review_status: "APPROVED" };

/** Strict Stripe fake: same idempotency key MUST carry identical params (like Stripe). */
function fakeStripe(over: any = {}) {
  const keys = new Map<string, { params: string; result: any }>();
  const calls = { sessions: [] as any[], transfers: [] as any[], accounts: 0, links: 0, includes: [] as any[] };
  const idem = (scope: string, key: string, params: any, make: () => any) => {
    const k = `${scope}:${key}`;
    const p = stable(params);
    const prev = keys.get(k);
    if (prev) {
      if (prev.params !== p) {
        const e: any = new Error("Keys for idempotent requests can only be used with the same parameters");
        e.type = "StripeIdempotencyError"; e.statusCode = 400;
        throw e;
      }
      return prev.result;
    }
    const result = make();
    keys.set(k, { params: p, result });
    return result;
  };
  const state = { balance: 1_000_000, transfersCreated: [] as any[], fee: 88, account: { transfers: "active", country: "US", applied: ["recipient"], fees: "application" as any, losses: "application" as any, dashboard: "express" as any, livemode: false as any, id: undefined as any } };
  const provider = {
    calls,
    state,
    checkout: {
      sessions: {
        create: async (p: any, o: any) => {
          calls.sessions.push({ p, o });
          if (over.sessionThrowOnce) { over.sessionThrowOnce = false; idem("cs", o.idempotencyKey, p, () => mkSession(p)); throw new Error("socket hang up"); }
          const s = idem("cs", o.idempotencyKey, p, () => mkSession(p));
          return over.sessionPatch ? { ...s, ...over.sessionPatch } : s;
        },
      },
    },
    v2: {
      core: {
        accounts: {
          retrieve: async (id: string, p?: any) => {
            calls.accounts++; calls.includes.push(p?.include);
            if (over.accountThrow) throw new Error("No such account");
            const a = state.account;
            return { id: a.id ?? id, applied_configurations: a.applied, identity: { country: a.country }, livemode: a.livemode, dashboard: a.dashboard,
              defaults: { responsibilities: { fees_collector: a.fees, losses_collector: a.losses } },
              configuration: { recipient: { capabilities: { stripe_balance: { stripe_transfers: { status: state.account.transfers } } } } } };
          },
        },
        accountLinks: { create: async (p: any) => (calls.links++, { url: `https://connect.stripe.com/setup/${p.account}` }) },
      },
    },
    paymentIntents: {
      retrieve: async () => ({ latest_charge: { id: "ch_1", amount: 2000, paid: true, refunded: false, amount_refunded: 0, disputed: false,
        balance_transaction: { currency: "usd", fee: state.fee, fee_details: [{ type: "stripe_fee", amount: state.fee }], status: "available" } } }),
    },
    balance: { retrieve: async () => ({ available: [{ currency: "usd", amount: state.balance }] }) },
    transfers: {
      create: async (p: any, o: any) => {
        calls.transfers.push({ p, o });
        if (over.transferError) { const e = over.transferError; over.transferError = null; throw e; }
        const t = idem("tr", o.idempotencyKey, p, () => {
          const tr = { id: `tr_${state.transfersCreated.length + 1}`, amount: p.amount, currency: p.currency, destination: p.destination, metadata: p.metadata, transfer_group: p.transfer_group };
          state.transfersCreated.push(tr);
          return tr;
        });
        if (over.transferTimeoutAfterCreate) { over.transferTimeoutAfterCreate = false; const e: any = new Error("timeout"); e.type = "StripeConnectionError"; throw e; }
        return t;
      },
      list: async (p: any) => ({ data: state.transfersCreated.filter((t) => t.transfer_group === p.transfer_group) }),
    },
  };
  return provider;
}
function mkSession(p: any) {
  return { id: `cs_test_${p.client_reference_id.slice(0, 8)}`, url: "https://checkout.stripe.com/c/pay/cs_test", livemode: false,
    amount_total: p.line_items[0].price_data.unit_amount, currency: "usd", client_reference_id: p.client_reference_id, metadata: p.metadata, expires_at: 2e9 };
}

let stripe: any;
async function seed() {
  const { pg, client } = await makeTestDb();
  H.pg = pg; H.client = client; H.failNext.clear();
  await pg.exec(`
    INSERT INTO stripe_integrations VALUES ('${INT_ID}','ACTIVE','test','enc','encw','acct_platform'),('${INT2_ID}','ACTIVE','test','enc','encw','acct_platform_2');
    INSERT INTO stores (id, slug, stripe_integration_id) VALUES ('${STORE_ID}','hope-human-books','${INT_ID}'),('${STORE2_ID}','other','${INT_ID}');
    INSERT INTO payments (provider_payment_id) VALUES ('pi_ebook');
  `);
  await client.from("donation_settings").insert({ store_id: STORE_ID, ...READY });
  await client.from("donation_beneficiaries").insert(BEN);
  await client.from("donation_campaigns").insert([
    { id: CAMP_OK, store_id: STORE_ID, slug: "ok", title: "OK", review_status: "APPROVED", active: true, beneficiary_id: BEN_ID },
    { id: CAMP_PENDING, store_id: STORE_ID, slug: "mateo", title: "Mateo", review_status: "PENDING", active: true, beneficiary_id: null },
  ]);
  stripe = fakeStripe();
  svc.__setDonationProviderFactory(async () => stripe);
}
const rows = async (sql: string) => (await H.pg.query(sql)).rows;
const donation = async (id: string) => (await rows(`SELECT * FROM donations WHERE id='${id}'`))[0];
const body = (o = {}) => ({ campaignSlug: "ok", amountCents: 2000, currency: "USD", idempotencyKey: "key-12345678", ...o });
const create = (o = {}) => svc.createDonation({ store: STORE, body: body(o), origin: "https://central" });

beforeEach(seed);

describe("validation and fail-closed configuration", () => {
  it("rejects unsupported amount, currency and extra fields", () => {
    expect(createDonationSchema.safeParse(body({ amountCents: 1500 })).success).toBe(false);
    expect(createDonationSchema.safeParse(body({ currency: "EUR" })).success).toBe(false);
    expect(createDonationSchema.safeParse(body({ productId: "x" })).success).toBe(false);
    expect(createDonationSchema.safeParse(body()).success).toBe(true);
  });
  it("defaults are not ready and responsibilities are unselected", () => {
    const g = settingsGaps(null, []);
    expect(g).toContain("Dashboard responsibility not selected");
    expect(g).toContain("Manual payout schedule not confirmed");
    expect(DEFAULT_SETTINGS.negative_balance_liability).toBeNull();
  });
  it("rejects incompatible dashboard/liability tuples", () => {
    expect(settingsGaps({ ...READY, negative_balance_liability: "STRIPE" }, [])).toContain("Stripe-owned negative balance liability is incompatible with separate charges and transfers");
    expect(settingsGaps({ ...READY, dashboard_responsibility: "FULL" }, []).some((g) => g.startsWith("Dashboard choice is incompatible"))).toBe(true);
    expect(settingsGaps(READY, [])).toEqual([]);
  });
  it("cross-border: recipient service agreement never allowed; countries bounded by Stripe regions/grants", () => {
    const s = { ...READY, allowed_recipient_countries: ["US", "GB", "BR"] };
    expect(beneficiaryGaps({ ...BEN, country: "GB", service_agreement: "recipient" }, s)).toContain("Cross-border recipients must be under the full service agreement");
    expect(beneficiaryGaps({ ...BEN, country: "GB", service_agreement: "full" }, s)).toEqual([]);
    expect(beneficiaryGaps({ ...BEN, country: "BR" }, s)).toContain("Cross-border payouts to this country are not supported or granted by Stripe");
    expect(beneficiaryGaps({ ...BEN, country: "BR" }, { ...s, stripe_granted_countries: ["BR"] })).toEqual([]);
    expect(beneficiaryGaps({ ...BEN, store_id: STORE2_ID }, READY, STORE_ID)).toContain("Beneficiary belongs to another store");
  });
  it("catalog lists pending campaigns as not ready and stays globally not ready without integration webhook secret", async () => {
    await H.pg.exec(`UPDATE stripe_integrations SET webhook_secret_ciphertext = NULL WHERE id='${INT_ID}'`);
    const c = await svc.getDonationCatalog(STORE);
    expect(c.ready).toBe(false);
    expect(c.campaigns.find((x) => x.slug === "mateo")).toEqual({ slug: "mateo", title: "Mateo", active: true, ready: false });
    await expect(create()).rejects.toThrow(/configuration pending/);
    expect(stripe.calls.sessions).toHaveLength(0);
  });
  it("refuses unknown slug and pending campaigns", async () => {
    await expect(create({ campaignSlug: "nope" })).rejects.toThrow(/Unknown campaign/);
    await expect(create({ campaignSlug: "mateo" })).rejects.toThrow(/not accepting/);
  });
  it("live recipient check fails closed (inactive transfers, unknown account, country mismatch)", async () => {
    stripe.state.account.transfers = "pending";
    await expect(create()).rejects.toThrow(/not accepting/);
    stripe.state.account.country = "GB";
    await expect(create()).rejects.toThrow(/not accepting/);
    stripe = fakeStripe({ accountThrow: true });
    await expect(create()).rejects.toThrow(/not accepting/);
    expect(stripe.calls.sessions).toHaveLength(0);
    expect(await rows("SELECT * FROM donations")).toHaveLength(0);
  });
});

describe("checkout session request", () => {
  it("sends branded donate session with deterministic identifier and no Connect params", async () => {
    const r = await create();
    expect(r.paymentUrl).toBe(`https://central/donations/pay/${r.publicToken}`);
    const p = stripe.calls.sessions[0].p;
    expect(p.submit_type).toBe("donate");
    expect(p.ui_mode).toBeUndefined();
    expect(p.payment_method_types).toBeUndefined();
    expect(p.line_items[0].price_data.product_data).toMatchObject({ name: "$20 Donation", images: [FOUNDATION_LOGO_URL] });
    expect(p.branding_settings).toEqual({ display_name: "Hope Human Foundation", logo: { type: "url", url: FOUNDATION_LOGO_URL }, button_color: "#08733D", background_color: "#FFFFFF", border_style: "rounded" });
    expect(p.branding_settings.icon).toBeUndefined();
    expect(p.payment_intent_data.transfer_data).toBeUndefined();
    expect(p.payment_intent_data.on_behalf_of).toBeUndefined();
    expect(p.payment_intent_data.application_fee_amount).toBeUndefined();
    expect(p.payment_intent_data.capture_method).toBeUndefined();
    expect(p.integration_identifier).toMatch(/^hhf_donations_[A-Z]{8}$/);
    const d = await donation(r.donationId);
    expect(d.session_request.integration_identifier).toBe(p.integration_identifier);
    expect(d.platform_account_id).toBe("acct_platform");
  });
  it("repeat returns same donation; different payload with same key is rejected", async () => {
    const a = await create();
    const b = await create();
    expect(b.donationId).toBe(a.donationId);
    await expect(create({ amountCents: 5000 })).rejects.toThrow(/different payload/);
    expect(await rows("SELECT * FROM donations")).toHaveLength(1);
  });
  it("concurrent same-key requests create one donation and identical Stripe params", async () => {
    const rs = await Promise.all([1, 2, 3].map(() => create()));
    expect(new Set(rs.map((r) => r.donationId)).size).toBe(1);
    expect(await rows("SELECT * FROM donations")).toHaveLength(1);
    const ps = new Set(stripe.calls.sessions.map((c) => stable(c.p)));
    expect(ps.size).toBe(1);
  });
  it("retry after lost Stripe response or failed session save replays byte-identical params", async () => {
    stripe = fakeStripe({ sessionThrowOnce: true });
    await expect(create()).rejects.toThrow(/socket hang up/);
    H.failNext.add("update:donations");
    await expect(create()).rejects.toThrow(/session save failed/);
    const r = await create();
    expect(r.donationId).toBeTruthy();
    expect(stripe.calls.sessions).toHaveLength(3);
    expect(new Set(stripe.calls.sessions.map((c) => stable(c.p) + c.o.idempotencyKey)).size).toBe(1);
    expect((await donation(r.donationId)).checkout_session_id).toMatch(/^cs_test_/);
  });
  it("rejects a Session response that does not match before persisting", async () => {
    stripe = fakeStripe({ sessionPatch: { amount_total: 1 } });
    await expect(create()).rejects.toThrow(/session response rejected/);
    const [d] = await rows("SELECT * FROM donations");
    expect(d.checkout_session_id).toBeNull();
  });
  it("session request snapshot is immutable in the database", async () => {
    const r = await create();
    await expect(H.pg.query(`UPDATE donations SET session_request='{}'::jsonb WHERE id='${r.donationId}'`)).rejects.toThrow(/immutable/);
  });
});

const ctx = { integrationId: INT_ID, livemode: false };
let evn = 0;
function sessionEvent(d, type, over = {}) {
  return { id: `evt_${++evn}`, type, livemode: false, data: { object: { id: d.checkout_session_id, client_reference_id: d.id, livemode: false, amount_total: d.amount_cents, currency: "usd", payment_status: "paid", payment_intent: "pi_1",
    metadata: { purpose: "donation", donation_id: d.id, store_id: d.store_id, integration_id: INT_ID, base_amount_cents: String(d.amount_cents) }, ...over } } };
}
const refundEvent = (amount, id = `evt_${++evn}`) => ({ id, type: "charge.refunded", livemode: false, data: { object: { id: "ch_1", payment_intent: "pi_1", amount_refunded: amount } } });
const disputeEvent = () => ({ id: `evt_${++evn}`, type: "charge.dispute.created", livemode: false, data: { object: { id: "dp_1", charge: "ch_1", payment_intent: "pi_1" } } });
const piFailed = (d) => ({ id: `evt_${++evn}`, type: "payment_intent.payment_failed", livemode: false, data: { object: { id: "pi_1", amount: d.amount_cents, currency: "usd", livemode: false, last_payment_error: { code: "card_declined" },
  metadata: { purpose: "donation", donation_id: d.id, store_id: d.store_id, integration_id: INT_ID } } } });
async function made() {
  const r = await create();
  return donation(r.donationId);
}

describe("webhook (atomic RPC)", () => {
  it("completed+unpaid then async success; duplicate event id is a no-op", async () => {
    const d = await made();
    await svc.handleDonationEvent(sessionEvent(d, "checkout.session.completed", { payment_status: "unpaid" }), ctx);
    expect((await donation(d.id)).status).toBe("PROCESSING");
    const ev = sessionEvent(d, "checkout.session.async_payment_succeeded");
    await svc.handleDonationEvent(ev, ctx);
    expect(await svc.handleDonationEvent(ev, ctx)).toMatch(/already applied/);
    const x = await donation(d.id);
    expect([x.status, x.payment_confirmed]).toEqual(["PAID", true]);
    expect((await rows(`SELECT * FROM donation_ledger WHERE donation_id='${d.id}' AND entry_type='SESSION_PAID'`))).toHaveLength(1);
  });
  it("spoofed amount/env/integration/session never mutate (no ledger writes)", async () => {
    const d = await made();
    for (const [over, c] of [[{ amount_total: 1 }, ctx], [{ livemode: true }, ctx], [{}, { integrationId: INT2_ID, livemode: false }], [{ client_reference_id: "x" }, ctx]]) {
      await svc.handleDonationEvent(sessionEvent(d, "checkout.session.completed", over), c);
    }
    expect((await donation(d.id)).status).toBe("PENDING");
    expect(await rows(`SELECT * FROM donation_ledger WHERE donation_id='${d.id}' AND entry_type <> 'CREATED'`)).toHaveLength(0);
  });
  it("cumulative partial refunds increase; late lower totals never reduce; full -> REFUNDED", async () => {
    const d = await made();
    await svc.handleDonationEvent(sessionEvent(d, "checkout.session.completed"), ctx);
    await svc.handleDonationEvent(refundEvent(500), ctx);
    await svc.handleDonationEvent(refundEvent(1200), ctx);
    let x = await donation(d.id);
    expect([x.status, x.refunded_cents]).toEqual(["PARTIALLY_REFUNDED", 1200]);
    await svc.handleDonationEvent(refundEvent(500), ctx);
    expect((await donation(d.id)).refunded_cents).toBe(1200);
    await svc.handleDonationEvent(refundEvent(2000), ctx);
    x = await donation(d.id);
    expect([x.status, x.refunded_cents]).toEqual(["REFUNDED", 2000]);
    await svc.handleDonationEvent(sessionEvent(d, "checkout.session.completed"), ctx);
    expect((await donation(d.id)).status).toBe("REFUNDED");
    const sum = await rows(`SELECT sum(amount_cents)::int s FROM donation_ledger WHERE donation_id='${d.id}' AND entry_type='REFUND'`);
    expect(sum[0].s).toBe(2000);
  });
  it("concurrent paid + refund converge to REFUNDED either order", async () => {
    const d = await made();
    await svc.handleDonationEvent(piFailed(d), ctx); // links the PI first
    await Promise.all([svc.handleDonationEvent(refundEvent(2000), ctx), svc.handleDonationEvent(sessionEvent(d, "checkout.session.completed"), ctx)]);
    const x = await donation(d.id);
    expect([x.status, x.refunded_cents, x.payment_confirmed]).toEqual(["REFUNDED", 2000, true]);
  });
  it("adverse-before-success: dispute recorded before paid stays sticky after paid", async () => {
    const d = await made();
    await svc.handleDonationEvent(piFailed(d), ctx);
    await svc.handleDonationEvent(disputeEvent(), ctx);
    await svc.handleDonationEvent(sessionEvent(d, "checkout.session.completed"), ctx);
    const x = await donation(d.id);
    expect([x.status, x.disputed]).toEqual(["DISPUTED", true]);
    await expect(H.pg.query(`UPDATE donations SET disputed=false WHERE id='${d.id}'`)).rejects.toThrow(/sticky/);
  });
  it("card decline then retry paid confirms payment; async FAILED then paid also confirms", async () => {
    const d = await made();
    await svc.handleDonationEvent(piFailed(d), ctx);
    expect((await donation(d.id)).status).toBe("PENDING");
    await svc.handleDonationEvent(sessionEvent(d, "checkout.session.completed"), ctx);
    expect((await donation(d.id)).status).toBe("PAID");
    const e = await svc.createDonation({ store: STORE, body: body({ idempotencyKey: "key-second-1" }), origin: "https://central" });
    const d2 = await donation(e.donationId);
    await svc.handleDonationEvent(sessionEvent(d2, "checkout.session.async_payment_failed", { payment_intent: "pi_2" }), ctx);
    expect((await donation(d2.id)).status).toBe("FAILED");
    await svc.handleDonationEvent(sessionEvent(d2, "checkout.session.async_payment_succeeded", { payment_intent: "pi_2" }), ctx);
    expect((await donation(d2.id)).status).toBe("PAID");
  });
  it("linkage race: session event before session link saved is retryable, never acknowledged", async () => {
    H.failNext.add("update:donations");
    await expect(create()).rejects.toThrow();
    const [d] = await rows("SELECT * FROM donations");
    const ev = sessionEvent({ ...d, checkout_session_id: "cs_test_x" }, "checkout.session.completed");
    await expect(svc.handleDonationEvent(ev, ctx)).rejects.toBeInstanceOf(svc.RetryableDonationError);
    await expect(svc.handleDonationEvent(refundEvent(2000), ctx)).rejects.toBeInstanceOf(svc.RetryableDonationError);
    expect((await donation(d.id)).status).toBe("PENDING");
  });
  it("ebook events fall through; unknown sessions ignored", async () => {
    expect(await svc.handleDonationEvent({ type: "payment_intent.succeeded", livemode: false, data: { object: { id: "pi_ebook", metadata: {} } } }, ctx)).toBeNull();
    expect(await svc.handleDonationEvent({ type: "charge.refunded", livemode: false, data: { object: { id: "ch_e", payment_intent: "pi_ebook" } } }, ctx)).toBeNull();
    expect(await svc.handleDonationEvent({ type: "checkout.session.completed", livemode: false, data: { object: { id: "cs_x", metadata: {} } } }, ctx)).toBeNull();
  });
  it("financial RPCs are executable only by service_role", async () => {
    for (const fn of ["donation_apply_event(uuid,text,text,text,jsonb)", "donation_release_mark(uuid,text,text,text)"]) {
      const [r] = await rows(`SELECT has_function_privilege('anon','public.${fn}','EXECUTE') a, has_function_privilege('authenticated','public.${fn}','EXECUTE') b, has_function_privilege('service_role','public.${fn}','EXECUTE') s`);
      expect([r.a, r.b, r.s]).toEqual([false, false, true]);
    }
  });
});

const chargeFix = (o = {}) => ({ id: "ch_1", amount: 2000, paid: true, refunded: false, amount_refunded: 0, disputed: false, balanceTransactionCurrency: "usd", feeCents: 88, feeDetails: [], fundsAvailable: true, ...o });
const don = (o = {}) => ({ id: "d1", livemode: false, status: "PAID", amount_cents: 2000, currency: "USD", refunded_cents: 0, disputed: false, charge_id: "ch_1", beneficiary_snapshot: { account_id: "acct_123", display_name: "Recipient", country: "US" }, ...o });
const ver = { accountId: "acct_123", country: "US", transfersStatus: "active", recipientConfigured: true, feesCollector: "application", lossesCollector: "application", dashboard: "express", livemode: false };
const base = (o = {}) => ({ donation: don(), beneficiary: BEN, settings: READY, verification: ver, integrationGaps: [], charge: chargeFix(), availableUsdCents: 1_000_000, otherHeldObligationsCents: 0, feeCoverageUsedCents: 0, releaseState: "NONE", ...o });

describe("release preview math", () => {
  it("full gross, NGO covers fee, other held principal never consumed", () => {
    expect(computeReleasePreview(base()).allowed).toBe(true);
    const p = computeReleasePreview(base({ availableUsdCents: 5000, otherHeldObligationsCents: 4000 }));
    expect([p.allowed, p.fundingDeficitCents > 0]).toEqual([false, true]);
    expect(computeReleasePreview(base({ settings: { ...READY, ngo_fee_funding_cents: 50 } })).fundingDeficitCents).toBe(38);
  });
  it("blocks typed-only readiness, in-flight ops, missing approvals and hold limit", () => {
    expect(computeReleasePreview(base({ verification: { ...ver, transfersStatus: "restricted" } })).allowed).toBe(false);
    expect(computeReleasePreview(base({ verification: null })).allowed).toBe(false);
    expect(computeReleasePreview(base({ releaseState: "IN_FLIGHT" })).allowed).toBe(false);
    expect(computeReleasePreview(base({ releaseState: "FAILED" })).allowed).toBe(true);
    expect(computeReleasePreview(base({ settings: { ...READY, connect_approved: false } })).allowed).toBe(false);
    expect(computeReleasePreview(base({ settings: { ...READY, manual_payout_schedule_confirmed: false } })).allowed).toBe(false);
    expect(computeReleasePreview(base({ donation: don({ paid_at: "2026-01-01T00:00:00Z" }), now: Date.parse("2026-06-01T00:00:00Z") })).blockers).toContain("Hold limit exceeded: reconciliation needed before any release");
    expect(computeReleasePreview(base({ integrationGaps: ["Platform Stripe account differs from the donation"] })).allowed).toBe(false);
  });
});

async function paidDonation(key = "key-12345678") {
  const r = await svc.createDonation({ store: STORE, body: body({ idempotencyKey: key }), origin: "https://central" });
  const d = await donation(r.donationId);
  const pi = `pi_${key}`;
  await svc.handleDonationEvent(sessionEvent(d, "checkout.session.completed", { payment_intent: pi }), ctx);
  await H.pg.exec(`UPDATE donations SET charge_id='ch_1' WHERE id='${d.id}'`);
  return d;
}
async function release(id) {
  const p = await svc.buildReleasePreview(id);
  return svc.executeRelease({ donationId: id, previewHash: await svc.previewHash(p), confirmedBy: "Human", maxAmountCents: p.transferAmountCents });
}

describe("release operation (durable, mocked Stripe)", () => {
  it("transfers full gross once with source_transaction and stable key; second attempt blocked", async () => {
    const d = await paidDonation();
    const r = await release(d.id);
    expect(r.transferId).toBe("tr_1");
    const t = stripe.calls.transfers[0];
    expect(t.p).toMatchObject({ amount: 2000, currency: "usd", destination: "acct_123", source_transaction: "ch_1" });
    expect(t.o.idempotencyKey).toBe(`donation-release:${d.id}:1`);
    expect((await donation(d.id)).status).toBe("RELEASED");
    await expect(release(d.id)).rejects.toThrow(/blocked/);
    expect(stripe.state.transfersCreated).toHaveLength(1);
  });
  it("timeout after Stripe created the transfer -> UNKNOWN (not FAILED); resume records it without a second transfer", async () => {
    const d = await paidDonation();
    stripe = fakeStripe({ transferTimeoutAfterCreate: true });
    await expect(release(d.id)).rejects.toThrow(/outcome unknown/);
    expect((await rows(`SELECT status FROM donation_releases WHERE donation_id='${d.id}'`))[0].status).toBe("UNKNOWN");
    expect((await svc.getDonationStatus(STORE, d.public_token, "https://c")).payoutStatus).toBe("RELEASE_IN_PROGRESS");
    const r = await svc.resumeRelease(d.id);
    expect(r.transferId).toBe("tr_1");
    expect(stripe.state.transfersCreated).toHaveLength(1);
    expect((await donation(d.id)).status).toBe("RELEASED");
  });
  it("Stripe success + local save failure -> resume records the same transfer", async () => {
    const d = await paidDonation();
    H.failNext.add("rpc:donation_release_mark:SUCCEEDED");
    await expect(release(d.id)).rejects.toThrow(/not saved locally/);
    expect((await donation(d.id)).status).toBe("PAID");
    const r = await svc.resumeRelease(d.id);
    expect(r.transferId).toBe("tr_1");
    expect(stripe.state.transfersCreated).toHaveLength(1);
  });
  it("definitive Stripe rejection -> FAILED; new attempt uses a new key", async () => {
    const d = await paidDonation();
    stripe = fakeStripe({ transferError: Object.assign(new Error("Insufficient funds"), { type: "StripeInvalidRequestError", statusCode: 400 }) });
    await expect(release(d.id)).rejects.toThrow(/rejected the transfer/);
    expect((await rows(`SELECT status FROM donation_releases WHERE donation_id='${d.id}'`))[0].status).toBe("FAILED");
    await release(d.id);
    expect(stripe.calls.transfers.at(-1).o.idempotencyKey).toBe(`donation-release:${d.id}:2`);
  });
  it("refund during an in-flight transfer ends as REVERSAL_REQUIRED even though the transfer succeeded", async () => {
    const d = await paidDonation();
    stripe = fakeStripe({ transferTimeoutAfterCreate: true });
    await expect(release(d.id)).rejects.toThrow(/outcome unknown/);
    await svc.handleDonationEvent({ ...refundEvent(2000), data: { object: { id: "ch_1", payment_intent: `pi_key-12345678`, amount_refunded: 2000 } } }, ctx);
    await svc.resumeRelease(d.id);
    expect((await donation(d.id)).status).toBe("REVERSAL_REQUIRED");
    const led = await rows(`SELECT entry_type FROM donation_ledger WHERE donation_id='${d.id}' AND entry_type='RECOVERY_REQUIRED'`);
    expect(led).toHaveLength(1);
  });
  it("fee budget is reserved atomically across concurrent releases in the same platform account", async () => {
    await H.pg.exec(`UPDATE donation_settings SET ngo_fee_funding_cents = 100`);
    const a = await paidDonation("key-aaaaaaaa");
    const b = await paidDonation("key-bbbbbbbb");
    const pa = await svc.buildReleasePreview(a.id);
    const pb = await svc.buildReleasePreview(b.id);
    const go = async (id, p) => svc.executeRelease({ donationId: id, previewHash: await svc.previewHash(p), confirmedBy: "Human", maxAmountCents: 2000 });
    const results = await Promise.allSettled([go(a.id, pa), go(b.id, pb)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(stripe.state.transfersCreated).toHaveLength(1);
  });
  it("held principal of other stores on the same platform account is protected", async () => {
    const a = await paidDonation("key-aaaaaaaa");
    await H.pg.exec(`INSERT INTO donations (store_id, campaign_id, donation_number, public_token, status, amount_cents, idempotency_key, request_fingerprint, integration_id, livemode, platform_account_id, payment_confirmed)
      VALUES ('${STORE2_ID}', '${CAMP_OK}', 'X-1', 'tok_other_store_000000000000', 'PAID', 50000, 'k-other-1', 'f', '${INT_ID}', false, 'acct_platform', true)`);
    stripe.state.balance = 51000;
    await expect(release(a.id)).rejects.toThrow(/blocked/);
    expect(stripe.state.transfersCreated).toHaveLength(0);
  });
  it("binds to the donation's original integration, not the store's current one", async () => {
    const a = await paidDonation();
    await H.pg.exec(`UPDATE stores SET stripe_integration_id='${INT2_ID}'; UPDATE stripe_integrations SET stripe_account_id='acct_changed' WHERE id='${INT_ID}'`);
    const p = await svc.buildReleasePreview(a.id);
    expect(p.allowed).toBe(false);
    expect(p.blockers.join(" ")).toMatch(/Platform Stripe account differs/);
  });
});

describe("receipt formatting", () => {
  it("formats presentment using currency minor units", () => {
    expect(formatMinorUnits(3000, "JPY")).toBe("¥3,000");
    expect(formatMinorUnits(1850, "EUR")).toBe("€18.50");
    expect(formatMinorUnits(12345, "KWD")).toMatch(/KWD.12\.345/);
  });
  it("receipt uses the immutable snapshot even if settings change later", async () => {
    const d = await paidDonation();
    await H.pg.exec(`UPDATE donation_settings SET use_of_funds='Changed later', recipient_name='Other'`);
    const v = await svc.receiptView(await donation(d.id), "https://c");
    expect(v.recipient).toEqual({ name: "Hope Human Foundation", country: "US", useOfFunds: "Program support" });
  });
  it("status contract keys are exactly the shared shape", async () => {
    const d = await paidDonation();
    const s = await svc.getDonationStatus(STORE, d.public_token, "https://c");
    expect(Object.keys(s).sort()).toEqual(["amountCents", "campaignSlug", "currency", "donationId", "donationNumber", "payoutStatus", "publicToken", "purpose", "receiptUrl", "status"]);
    expect(s.payoutStatus).toBe("HELD");
  });
});

// ---------- Review batch: windows, current guards, shared scope, acceptance kill switch ----------
const backdate = async (sql: string) => {
  await H.pg.exec(`ALTER TABLE donation_releases DISABLE TRIGGER USER; ALTER TABLE donations DISABLE TRIGGER USER; ${sql}; ALTER TABLE donation_releases ENABLE TRIGGER USER; ALTER TABLE donations ENABLE TRIGGER USER;`);
};
const relRow = async (id) => (await rows(`SELECT * FROM donation_releases WHERE donation_id='${id}'`))[0];
async function reserveOnly(id) {
  // Crash after reservation, before the first create.
  H.failNext.add("rpc:donation_release_submit_guard:");
  await expect(release(id)).rejects.toThrow(/Release guard failed/);
  expect((await relRow(id)).status).toBe("RESERVED");
}

describe("P1-1 immutable idempotency window + sticky manual reconciliation", () => {
  it("first and second Resume after >24h never call transfers.create; flag cannot be reset", async () => {
    const d = await paidDonation();
    stripe = fakeStripe({ transferError: Object.assign(new Error("socket timeout"), { type: "StripeConnectionError" }) });
    await expect(release(d.id)).rejects.toThrow(/outcome unknown/);
    const creates = stripe.calls.transfers.length;
    await backdate(`UPDATE donation_releases SET submitted_at = now() - interval '25 hours' WHERE donation_id='${d.id}'`);
    await expect(svc.resumeRelease(d.id)).rejects.toThrow(/manual reconciliation/);
    await expect(svc.resumeRelease(d.id)).rejects.toThrow(/manual reconciliation/);
    expect(stripe.calls.transfers.length).toBe(creates);
    const r = await relRow(d.id);
    expect([r.manual_reconciliation_required, r.status]).toEqual([true, "UNKNOWN"]);
    await expect(H.pg.query(`UPDATE donation_releases SET manual_reconciliation_required=false WHERE id='${r.id}'`)).rejects.toThrow(/sticky/);
    await expect(H.pg.query(`UPDATE donation_releases SET submitted_at=now() WHERE id='${r.id}'`)).rejects.toThrow(/immutable/);
    // A new preview cannot start a fresh attempt either.
    await expect(release(d.id)).rejects.toThrow();
    expect(stripe.calls.transfers.length).toBe(creates);
  });
  it("an existing matching transfer is still recorded after the window", async () => {
    const d = await paidDonation();
    stripe = fakeStripe({ transferTimeoutAfterCreate: true });
    await expect(release(d.id)).rejects.toThrow(/outcome unknown/);
    await backdate(`UPDATE donation_releases SET submitted_at = now() - interval '30 hours' WHERE donation_id='${d.id}'`);
    const r = await svc.resumeRelease(d.id);
    expect(r.transferId).toBe("tr_1");
    expect(stripe.state.transfersCreated).toHaveLength(1);
  });
});

describe("P1-2 Resume and final submit honor CURRENT guards", () => {
  it("refund after reserve, before first create -> zero transfers, op held", async () => {
    const d = await paidDonation();
    await reserveOnly(d.id);
    await svc.handleDonationEvent({ ...refundEvent(2000), data: { object: { id: "ch_1", payment_intent: "pi_key-12345678", amount_refunded: 2000 } } }, ctx);
    await expect(svc.resumeRelease(d.id)).rejects.toThrow(/held for reconciliation/);
    expect(stripe.calls.transfers).toHaveLength(0);
    expect((await relRow(d.id)).status).toBe("RESERVED");
  });
  it("releases_enabled=false after reserve -> zero transfers; existing transfer still reconciled with switch off", async () => {
    const d = await paidDonation();
    await reserveOnly(d.id);
    await H.pg.exec(`UPDATE donation_settings SET releases_enabled = false`);
    await expect(svc.resumeRelease(d.id)).rejects.toThrow(/held for reconciliation/);
    expect(stripe.calls.transfers).toHaveLength(0);

    const d2 = await paidDonation("key-second-22");
    await H.pg.exec(`UPDATE donation_settings SET releases_enabled = true`);
    stripe.state.transfersCreated.length = 0;
    const s2 = fakeStripe({ transferTimeoutAfterCreate: true });
    stripe = s2;
    await expect(release(d2.id)).rejects.toThrow(/outcome unknown/);
    await H.pg.exec(`UPDATE donation_settings SET releases_enabled = false`);
    const r = await svc.resumeRelease(d2.id);
    expect(r.transferId).toBe("tr_1");
    expect(s2.state.transfersCreated).toHaveLength(1);
  });
  it("fresh recipient capability revocation -> zero transfers", async () => {
    const d = await paidDonation();
    await reserveOnly(d.id);
    stripe.state.account.transfers = "inactive";
    await expect(svc.resumeRelease(d.id)).rejects.toThrow(/held for reconciliation/);
    expect(stripe.calls.transfers).toHaveLength(0);
  });
  it("campaign suspension after reserve -> zero transfers", async () => {
    const d = await paidDonation();
    await reserveOnly(d.id);
    await H.pg.exec(`UPDATE donation_campaigns SET active = false WHERE id='${CAMP_OK}'`);
    await expect(svc.resumeRelease(d.id)).rejects.toThrow(/held for reconciliation/);
    expect(stripe.calls.transfers).toHaveLength(0);
  });
  it("SQL submit guard refuses adverse state even if called directly", async () => {
    const d = await paidDonation();
    await reserveOnly(d.id);
    await H.pg.exec(`UPDATE donations SET disputed = true WHERE id='${d.id}'`);
    const r = await H.client.rpc("donation_release_submit_guard", { _release_id: (await relRow(d.id)).id, _window_seconds: 82800 });
    expect(r.data.allowed).toBe(false);
  });
});

describe("P1-3 shared Stripe account scope across integration rows", () => {
  async function directPaid(n, integ) {
    const id = `00000000-0000-4000-8000-00000000d00${n}`;
    await H.pg.exec(`INSERT INTO donations (id, store_id, campaign_id, donation_number, public_token, status, amount_cents, idempotency_key, request_fingerprint,
      integration_id, livemode, platform_account_id, payment_confirmed, charge_id, beneficiary_id, beneficiary_snapshot)
      VALUES ('${id}', '${STORE_ID}', '${CAMP_OK}', 'D-${n}', 'tok_direct_${n}_00000000000000000', 'PAID', 2000, 'k-d-${n}', 'f',
      '${integ}', false, 'acct_platform', true, 'ch_${n}', '${BEN_ID}', '{"account_id":"acct_123"}'::jsonb)`);
    return id;
  }
  beforeEach(async () => {
    await H.pg.exec(`UPDATE stripe_integrations SET stripe_account_id = 'acct_platform' WHERE id='${INT2_ID}'`);
  });
  const reserve = (id, available, budget = 10000) => H.client.rpc("donation_release_reserve", { _donation_id: id, _preview_hash: "h", _confirmed_by: "Human",
    _amount: 2000, _fee: 88, _dest: "acct_123", _source: `ch_${id.slice(-1)}`, _available_usd: available, _fee_budget: budget });
  it("held principal under a different integration row on the same account is protected", async () => {
    const a = await directPaid(1, INT_ID);
    await directPaid(2, INT2_ID);
    expect((await reserve(a, 3000)).error?.message).toMatch(/insufficient available USD/);
    expect((await reserve(a, 4000)).error).toBeNull();
  });
  it("concurrent reservations from different integration rows share one fee budget and one balance", async () => {
    const a = await directPaid(1, INT_ID);
    const b = await directPaid(2, INT2_ID);
    const [ra, rb] = await Promise.all([reserve(a, 4000, 100), reserve(b, 4000, 100)]);
    expect([ra.error, rb.error].filter(Boolean)).toHaveLength(1);
    expect((await rows(`SELECT * FROM donation_releases`))).toHaveLength(1);
  });
});

describe("P1-4 acceptance kill switch on retry and /pay", () => {
  async function failedFirstAttempt() {
    stripe = fakeStripe({ sessionThrowOnce: true });
    await expect(create()).rejects.toThrow(/socket hang up/);
    expect(stripe.calls.sessions).toHaveLength(1);
  }
  it("retry after donations_enabled=false creates no new Session", async () => {
    await failedFirstAttempt();
    await H.pg.exec(`UPDATE donation_settings SET donations_enabled = false`);
    await expect(create()).rejects.toThrow(/configuration pending/);
    expect(stripe.calls.sessions).toHaveLength(1);
  });
  it("retry after campaign suspension creates no new Session", async () => {
    await failedFirstAttempt();
    await H.pg.exec(`UPDATE donation_campaigns SET active = false WHERE id='${CAMP_OK}'`);
    await expect(create()).rejects.toThrow(/configuration pending/);
    expect(stripe.calls.sessions).toHaveLength(1);
  });
  it("retry after recipient revocation creates no new Session", async () => {
    await failedFirstAttempt();
    stripe.state.account.transfers = "restricted";
    await expect(create()).rejects.toThrow(/configuration pending/);
    expect(stripe.calls.sessions).toHaveLength(1);
  });
  it("ambiguity beyond key retention -> sticky manual review, never another create", async () => {
    await failedFirstAttempt();
    await backdate(`UPDATE donations SET checkout_first_attempt_at = now() - interval '25 hours'`);
    await expect(create()).rejects.toThrow(/manual review/);
    await expect(create()).rejects.toThrow(/manual review/);
    expect(stripe.calls.sessions).toHaveLength(1);
    const [d] = await rows("SELECT * FROM donations");
    expect(d.checkout_manual_review).toBe(true);
    await expect(H.pg.query(`UPDATE donations SET checkout_manual_review=false WHERE id='${d.id}'`)).rejects.toThrow(/sticky/);
  });
  it("an already-saved Session is still returned idempotently (no new create)", async () => {
    const a = await create();
    await H.pg.exec(`UPDATE donation_settings SET donations_enabled = false`);
    const b = await create();
    expect(b.donationId).toBe(a.donationId);
    expect(stripe.calls.sessions).toHaveLength(1);
  });
  it("/pay redirect gate rejects when acceptance is off, campaign suspended or recipient unready", async () => {
    const r = await create();
    const d = await donation(r.donationId);
    expect(await svc.paymentRedirectGaps(d)).toEqual([]);
    await H.pg.exec(`UPDATE donation_settings SET donations_enabled = false`);
    expect((await svc.paymentRedirectGaps(d)).length).toBeGreaterThan(0);
    await H.pg.exec(`UPDATE donation_settings SET donations_enabled = true; UPDATE donation_campaigns SET active = false WHERE id='${CAMP_OK}'`);
    expect((await svc.paymentRedirectGaps(d)).length).toBeGreaterThan(0);
    await H.pg.exec(`UPDATE donation_campaigns SET active = true`);
    stripe.state.account.transfers = "inactive";
    expect((await svc.paymentRedirectGaps(d)).length).toBeGreaterThan(0);
    const v = await svc.receiptView(d, "https://c");
    expect(v.status).toBe("PENDING");
  });
  it("new RPCs are service_role only", async () => {
    for (const fn of ["donation_release_submit_guard(uuid,integer)", "donation_release_flag_manual(uuid,text)", "donation_release_reserve(uuid,text,text,integer,integer,text,text,bigint,integer)"]) {
      const [r] = await rows(`SELECT has_function_privilege('anon','public.${fn}','EXECUTE') a, has_function_privilege('authenticated','public.${fn}','EXECUTE') b, has_function_privilege('service_role','public.${fn}','EXECUTE') s`);
      expect([r.a, r.b, r.s]).toEqual([false, false, true]);
    }
  });
});

describe("actual provider responsibilities / dashboard / mode guard", () => {
  const bad: [string, (a: any) => void][] = [
    ["missing fee collector", (a) => { a.fees = undefined; }],
    ["stripe fee collector", (a) => { a.fees = "stripe"; }],
    ["legacy application_express", (a) => { a.fees = "application_express"; }],
    ["legacy application_custom", (a) => { a.fees = "application_custom"; }],
    ["stripe loss collector", (a) => { a.losses = "stripe"; }],
    ["missing loss collector", (a) => { a.losses = undefined; }],
    ["full dashboard", (a) => { a.dashboard = "full"; }],
    ["none dashboard while EXPRESS approved", (a) => { a.dashboard = "none"; }],
    ["missing dashboard", (a) => { a.dashboard = undefined; }],
    ["livemode mismatch", (a) => { a.livemode = true; }],
    ["unknown mode", (a) => { a.livemode = undefined; }],
    ["different account returned", (a) => { a.id = "acct_other"; }],
  ];
  for (const [name, mut] of bad) {
    it(`blocks new Session, transfer and onboarding link: ${name}`, async () => {
      const d = await paidDonation();
      mut(stripe.state.account);
      await expect(create({ idempotencyKey: "key-incompat-1" })).rejects.toThrow(/not accepting/);
      await expect(release(d.id)).rejects.toThrow();
      await expect(svc.createOnboardingLink(STORE_ID, BEN_ID, "https://central", () => [])).rejects.toThrow(/Onboarding not available/);
      expect(stripe.calls.transfers).toHaveLength(0);
      expect(stripe.calls.links).toBe(0);
      expect(stripe.calls.sessions).toHaveLength(1); // only the paidDonation fixture
    });
  }
  it("reads defaults with the Accounts v2 include list", async () => {
    await create();
    expect(stripe.calls.includes[0]).toEqual(["configuration.recipient", "identity", "defaults"]);
  });
  it("compatible model: EXPRESS + express and NONE + none both pass", async () => {
    await expect(create()).resolves.toBeTruthy();
    await H.pg.exec(`UPDATE donation_settings SET dashboard_responsibility = 'NONE'`);
    stripe.state.account.dashboard = "none";
    await expect(create({ idempotencyKey: "key-none-0001" })).resolves.toBeTruthy();
  });
  it("retry after a fee-collector change creates no new Session", async () => {
    stripe = fakeStripe({ sessionThrowOnce: true });
    await expect(create()).rejects.toThrow(/socket hang up/);
    stripe.state.account.fees = "stripe";
    await expect(create()).rejects.toThrow();
    expect(stripe.calls.sessions).toHaveLength(1);
  });
  it("resume after reserve with changed loss collector -> zero transfers", async () => {
    const d = await paidDonation();
    await reserveOnly(d.id);
    stripe.state.account.losses = "stripe";
    await expect(svc.resumeRelease(d.id)).rejects.toThrow(/held for reconciliation/);
    expect(stripe.calls.transfers).toHaveLength(0);
  });
  it("onboarding: pending transfers capability does not block a compatible existing account", async () => {
    stripe.state.account.transfers = "pending";
    const r = await svc.createOnboardingLink(STORE_ID, BEN_ID, "https://central", () => []);
    expect(r.url).toMatch(/^https:/);
    expect(stripe.calls.links).toBe(1);
  });
  it("onboarding: country mismatch still blocks", async () => {
    stripe.state.account.country = "GB";
    await expect(svc.createOnboardingLink(STORE_ID, BEN_ID, "https://central", () => [])).rejects.toThrow(/Onboarding not available/);
    expect(stripe.calls.links).toBe(0);
  });
  it("pure: no local approval means pending even when provider values look right", () => {
    expect(providerModelGaps(ver as any, { settings: { ...READY, dashboard_responsibility: null }, livemode: false })).toContain("Dashboard model not approved locally");
    expect(providerModelGaps(ver as any, { settings: READY, livemode: undefined })).toContain("Recipient account mode differs from the expected integration mode");
  });
});
