// @ts-nocheck -- in-memory DB fake; runtime assertions cover behavior.
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  computeReleasePreview,
  createDonationSchema,
  nextDonationStatus,
  settingsGaps,
  DEFAULT_SETTINGS,
} from "./rules";

type Row = Record<string, any>;
const db: Record<string, Row[]> = {};
let seq = 0;

function q(table: string) {
  const f: Array<(r: Row) => boolean> = [];
  let op = "select";
  let payload: any;
  const rows = () => (db[table] ??= []);
  const match = () => rows().filter((r) => f.every((fn) => fn(r)));
  const exec = () => {
    if (op === "insert") {
      const list = Array.isArray(payload) ? payload : [payload];
      for (const r of list) {
        if (table === "donations" && rows().some((x) => x.store_id === r.store_id && x.idempotency_key === r.idempotency_key))
          return { data: null, error: { message: "duplicate key" } };
        if (table === "donation_releases" && rows().some((x) => x.donation_id === r.donation_id))
          return { data: null, error: { message: "duplicate key" } };
      }
      const made = list.map((r) => ({ id: `id-${++seq}`, status: table === "donation_releases" ? "PENDING" : r.status, refunded_cents: 0, disputed: false, created_at: new Date().toISOString(), ...r }));
      rows().push(...made);
      return { data: made, error: null };
    }
    if (op === "update") {
      const m = match();
      m.forEach((r) => {
        if (table === "donations" && r.beneficiary_snapshot && payload.beneficiary_snapshot) throw new Error("immutable");
        Object.assign(r, payload);
      });
      return { data: m, error: null };
    }
    return { data: match(), error: null };
  };
  const api: any = {
    select: () => api,
    order: () => api,
    limit: () => api,
    eq: (k, v) => (f.push((r) => r[k] === v), api),
    in: (k, v) => (f.push((r) => v.includes(r[k])), api),
    insert: (p) => ((op = "insert"), (payload = p), api),
    update: (p) => ((op = "update"), (payload = p), api),
    upsert: (p) => ((op = "insert"), (payload = p), api),
    maybeSingle: () => { const r = exec(); return Promise.resolve({ data: r.data?.[0] ?? null, error: r.error }); },
    single: () => { const r = exec(); return Promise.resolve({ data: r.data?.[0] ?? null, error: r.error }); },
    then: (res, rej) => Promise.resolve(exec()).then(res, rej),
  };
  return api;
}

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: (t) => q(t) } }));

const svc = await import("./service.server");

const STORE = { id: "store-1", slug: "hope-human-books", stripe_integration_id: "int-1" };
const READY = {
  ...DEFAULT_SETTINGS,
  store_id: "store-1",
  use_of_funds: "Program support",
  platform_country: "US",
  stripe_fundraising_approved: true,
  connect_approved: true,
  usd_settlement_eligible: true,
  allowed_recipient_countries: ["US"],
  fee_coverage_policy: "NGO_COVERS_ALL",
  dashboard_responsibility: "PLATFORM",
  negative_balance_liability: "PLATFORM",
  donations_enabled: true,
  releases_enabled: true,
  ngo_fee_funding_cents: 10000,
  confirmed_by: "Test Human",
  confirmed_at: "2026-01-01T00:00:00Z",
};
const BEN = { id: "ben-1", store_id: "store-1", display_name: "Recipient", country: "US", stripe_account_id: "acct_123", onboarding_status: "COMPLETE", transfers_capability: "active", service_agreement: "full", review_status: "APPROVED" };

function fakeStripe() {
  const calls: any[] = [];
  return {
    calls,
    checkout: { sessions: { create: async (p, o) => (calls.push({ p, o }), { id: `cs_${o.idempotencyKey}`, url: "https://checkout.stripe.com/c/pay/x", expires_at: 2e9 }) } },
  };
}

function seed() {
  for (const k of Object.keys(db)) delete db[k];
  db.stores = [STORE];
  db.stripe_integrations = [{ id: "int-1", status: "ACTIVE", environment: "test", secret_key_ciphertext: "x" }];
  db.donation_settings = [{ ...READY }];
  db.donation_beneficiaries = [{ ...BEN }];
  db.donation_campaigns = [
    { id: "c1", store_id: "store-1", slug: "ok", title: "OK", review_status: "APPROVED", active: true, ends_at: null, beneficiary_id: "ben-1" },
    { id: "c2", store_id: "store-1", slug: "imported", title: "Imported", review_status: "UNREVIEWED", active: true, ends_at: null, beneficiary_id: "ben-1" },
  ];
}

const body = (o = {}) => ({ campaignSlug: "ok", amountCents: 2000, currency: "USD", idempotencyKey: "key-12345678", ...o });

beforeEach(seed);

describe("request validation", () => {
  it("rejects unsupported amount, currency and extra fields", () => {
    expect(createDonationSchema.safeParse(body({ amountCents: 1500 })).success).toBe(false);
    expect(createDonationSchema.safeParse(body({ currency: "EUR" })).success).toBe(false);
    expect(createDonationSchema.safeParse(body({ productId: "x" })).success).toBe(false);
    expect(createDonationSchema.safeParse(body()).success).toBe(true);
  });
});

describe("fail-closed configuration", () => {
  it("defaults are not ready and responsibilities are unselected", () => {
    const gaps = settingsGaps(null, true);
    expect(gaps).toContain("Dashboard responsibility not selected");
    expect(gaps).toContain("Use of funds not described");
    expect(DEFAULT_SETTINGS.dashboard_responsibility).toBeNull();
  });
  it("catalog reports ready=false with no settings and keeps empty useOfFunds", async () => {
    db.donation_settings = [];
    const c = await svc.getDonationCatalog(STORE);
    expect(c.ready).toBe(false);
    expect(c.recipient.useOfFunds).toBe("");
    expect(c.campaigns.every((x) => !x.ready)).toBe(true);
  });
  it("refuses donations when config pending, unknown slug or unreviewed campaign", async () => {
    const s = fakeStripe();
    const f = async () => s;
    await expect(svc.createDonation({ store: STORE, body: body({ campaignSlug: "nope" }), origin: "https://c", stripeFactory: f })).rejects.toThrow(/Unknown campaign/);
    await expect(svc.createDonation({ store: STORE, body: body({ campaignSlug: "imported" }), origin: "https://c", stripeFactory: f })).rejects.toThrow(/not accepting/);
    db.donation_settings[0].donations_enabled = false;
    await expect(svc.createDonation({ store: STORE, body: body(), origin: "https://c", stripeFactory: f })).rejects.toThrow(/configuration pending/);
    expect(s.calls).toHaveLength(0);
  });
});

describe("create + idempotency", () => {
  it("creates a donate session with truthful metadata and no Connect params", async () => {
    const s = fakeStripe();
    const r = await svc.createDonation({ store: STORE, body: body(), origin: "https://central", stripeFactory: async () => s });
    expect(r.purpose).toBe("donation");
    expect(r.paymentUrl).toBe(`https://central/donations/pay/${r.publicToken}`);
    const p = s.calls[0].p;
    expect(p.submit_type).toBe("donate");
    expect(p.mode).toBe("payment");
    expect(p.ui_mode).toBeUndefined();
    expect(p.payment_method_types).toBeUndefined();
    expect(p.line_items[0].price_data.product_data.name).toBe("$20 Donation");
    expect(p.payment_intent_data.transfer_data).toBeUndefined();
    expect(p.payment_intent_data.on_behalf_of).toBeUndefined();
    expect(p.payment_intent_data.application_fee_amount).toBeUndefined();
    expect(p.payment_intent_data.metadata.purpose).toBe("donation");
    expect(p.adaptive_pricing.enabled).toBe(false);
    // Hold = delayed transfer after automatic capture; manual capture is never used.
    expect(p.payment_intent_data.capture_method).toBeUndefined();
    expect(p.integration_identifier).toMatch(/^hhf_donations_[A-Z]{8}$/);
    expect(p.success_url).toBe(`https://central/donations/receipt/${r.publicToken}`);
  });
  it("repeat returns same donation; different payload with same key is rejected", async () => {
    const s = fakeStripe();
    const a = await svc.createDonation({ store: STORE, body: body(), origin: "https://c", stripeFactory: async () => s });
    const b = await svc.createDonation({ store: STORE, body: body(), origin: "https://c", stripeFactory: async () => s });
    expect(b.donationId).toBe(a.donationId);
    await expect(svc.createDonation({ store: STORE, body: body({ amountCents: 5000 }), origin: "https://c", stripeFactory: async () => s })).rejects.toThrow(/different payload/);
    expect(db.donations).toHaveLength(1);
  });
  it("concurrent requests with the same key create one donation", async () => {
    const s = fakeStripe();
    const rs = await Promise.all([1, 2, 3].map(() => svc.createDonation({ store: STORE, body: body(), origin: "https://c", stripeFactory: async () => s })));
    expect(new Set(rs.map((r) => r.donationId)).size).toBe(1);
    expect(db.donations).toHaveLength(1);
  });
});

async function made() {
  const r = await svc.createDonation({ store: STORE, body: body(), origin: "https://c", stripeFactory: async () => fakeStripe() });
  return db.donations.find((d) => d.id === r.donationId);
}
const ctx = { integrationId: "int-1", livemode: false };
function sessionEvent(d, type, over = {}) {
  return {
    type,
    livemode: false,
    data: { object: { id: d.checkout_session_id, client_reference_id: d.id, livemode: false, amount_total: d.amount_cents, currency: "usd", payment_status: "paid", payment_intent: "pi_1",
      metadata: { purpose: "donation", donation_id: d.id, store_id: d.store_id, integration_id: "int-1", base_amount_cents: String(d.amount_cents) }, ...over } },
  };
}

describe("webhook", () => {
  it("completed+paid marks PAID; completed+unpaid then async success", async () => {
    const d = await made();
    await svc.handleDonationEvent(sessionEvent(d, "checkout.session.completed", { payment_status: "unpaid" }), ctx);
    expect(d.status).toBe("PROCESSING");
    await svc.handleDonationEvent(sessionEvent(d, "checkout.session.async_payment_succeeded"), ctx);
    expect(d.status).toBe("PAID");
  });
  it("ignores spoofed amount, env, integration and session", async () => {
    const d = await made();
    for (const [over, c] of [
      [{ amount_total: 1 }, ctx],
      [{ livemode: true }, ctx],
      [{}, { integrationId: "int-2", livemode: false }],
      [{ id: "cs_other" }, ctx],
      [{ client_reference_id: "x" }, ctx],
    ]) {
      await svc.handleDonationEvent(sessionEvent(d, "checkout.session.completed", over), c);
    }
    expect(d.status).toBe("PENDING");
  });
  it("late events cannot re-enable refunded/released donations; post-release refund needs reversal", async () => {
    const d = await made();
    await svc.handleDonationEvent(sessionEvent(d, "checkout.session.completed"), ctx);
    await svc.handleDonationEvent({ type: "charge.refunded", livemode: false, data: { object: { id: "ch_1", payment_intent: "pi_1", amount_refunded: 2000 } } }, ctx);
    expect(d.status).toBe("REFUNDED");
    await svc.handleDonationEvent(sessionEvent(d, "checkout.session.completed"), ctx);
    expect(d.status).toBe("REFUNDED");
    expect(nextDonationStatus("RELEASED", "REFUND_FULL")).toBe("REVERSAL_REQUIRED");
    expect(nextDonationStatus("RELEASED", "DISPUTE")).toBe("REVERSAL_REQUIRED");
    expect(nextDonationStatus("RELEASED", "SESSION_PAID")).toBeNull();
    expect(nextDonationStatus("PAID", "EXPIRED")).toBeNull();
  });
  it("ebook payment_intent events fall through to the legacy pipeline", async () => {
    const r = await svc.handleDonationEvent({ type: "payment_intent.succeeded", livemode: false, data: { object: { id: "pi_ebook", metadata: {} } } }, ctx);
    expect(r).toBeNull();
    const r2 = await svc.handleDonationEvent({ type: "checkout.session.completed", livemode: false, data: { object: { id: "cs_x", metadata: {} } } }, ctx);
    expect(r2).toBeNull();
  });
});

const charge = (o = {}) => ({ id: "ch_1", amount: 2000, paid: true, refunded: false, amount_refunded: 0, disputed: false, balanceTransactionCurrency: "usd", feeCents: 88, feeDetails: [{ type: "stripe_fee", amount: 88 }], fundsAvailable: true, ...o });
const don = (o = {}) => ({ id: "d1", status: "PAID", amount_cents: 2000, currency: "USD", refunded_cents: 0, disputed: false, charge_id: "ch_1", beneficiary_snapshot: { account_id: "acct_123", display_name: "Recipient", country: "US" }, ...o });
const base = (o = {}) => ({ donation: don(), beneficiary: BEN, settings: READY, charge: charge(), availableUsdCents: 1_000_000, otherHeldObligationsCents: 0, feeCoverageUsedCents: 0, existingRelease: false, ...o });

describe("release preview", () => {
  it("transfers full gross and NGO covers the fee", () => {
    const p = computeReleasePreview(base());
    expect(p.allowed).toBe(true);
    expect(p.transferAmountCents).toBe(2000);
    expect(p.ngoCoverageRequiredCents).toBe(88);
  });
  it("blocks on funding deficit without consuming other held donations", () => {
    const p = computeReleasePreview(base({ availableUsdCents: 5000, otherHeldObligationsCents: 4000 }));
    expect(p.allowed).toBe(false);
    expect(p.fundingDeficitCents).toBeGreaterThan(0);
    const p2 = computeReleasePreview(base({ settings: { ...READY, ngo_fee_funding_cents: 50 } }));
    expect(p2.fundingDeficitCents).toBe(38);
  });
  it("blocks refunds, disputes, double transfer, non-USD settlement, unavailable funds, cross-border", () => {
    expect(computeReleasePreview(base({ donation: don({ refunded_cents: 1 }) })).allowed).toBe(false);
    expect(computeReleasePreview(base({ charge: charge({ disputed: true }) })).allowed).toBe(false);
    expect(computeReleasePreview(base({ existingRelease: true })).allowed).toBe(false);
    expect(computeReleasePreview(base({ charge: charge({ balanceTransactionCurrency: "eur" }) })).allowed).toBe(false);
    expect(computeReleasePreview(base({ charge: charge({ fundsAvailable: false }) })).allowed).toBe(false);
    expect(computeReleasePreview(base({ beneficiary: { ...BEN, country: "GB" }, settings: { ...READY, allowed_recipient_countries: ["US", "GB"] } })).allowed).toBe(false);
    expect(computeReleasePreview(base({ settings: { ...READY, releases_enabled: false } })).allowed).toBe(false);
    expect(computeReleasePreview(base({ beneficiary: { ...BEN, stripe_account_id: "acct_other" } })).allowed).toBe(false);
  });
});

describe("execute release (mocked Stripe)", () => {
  it("transfers full gross once with source_transaction; second attempt is blocked", async () => {
    const d = await made();
    await svc.handleDonationEvent(sessionEvent(d, "checkout.session.completed"), ctx);
    const transfers: any[] = [];
    const stripe = {
      paymentIntents: { retrieve: async () => ({ latest_charge: { id: "ch_1", amount: 2000, paid: true, refunded: false, amount_refunded: 0, disputed: false, balance_transaction: { currency: "usd", fee: 88, fee_details: [], status: "available" } } }) },
      balance: { retrieve: async () => ({ available: [{ currency: "usd", amount: 100000 }] }) },
      transfers: { create: async (p, o) => (transfers.push({ p, o }), { id: "tr_1" }) },
    };
    const preview = await svc.buildReleasePreview(d.id, stripe);
    expect(preview.allowed).toBe(true);
    const hash = await svc.previewHash(preview);
    await expect(svc.executeRelease({ donationId: d.id, previewHash: "0".repeat(64), confirmedBy: "Human", maxAmountCents: 2000, stripeOverride: stripe })).rejects.toThrow(/Preview changed/);
    await svc.executeRelease({ donationId: d.id, previewHash: hash, confirmedBy: "Human", maxAmountCents: 2000, stripeOverride: stripe });
    expect(transfers[0].p).toMatchObject({ amount: 2000, currency: "usd", destination: "acct_123", source_transaction: "ch_1" });
    expect(d.status).toBe("RELEASED");
    await expect(svc.executeRelease({ donationId: d.id, previewHash: hash, confirmedBy: "Human", maxAmountCents: 2000, stripeOverride: stripe })).rejects.toThrow();
    expect(transfers).toHaveLength(1);
  });
});

describe("status contract", () => {
  it("returns the normalized donation-only shape", async () => {
    const d = await made();
    const st = await svc.getDonationStatus(STORE, d.public_token, "https://c");
    expect(Object.keys(st).sort()).toEqual(["amountCents","campaignSlug","currency","donationId","donationNumber","payoutStatus","publicToken","purpose","receiptUrl","status"]);
    expect(st.receiptUrl).toBe(`https://c/donations/receipt/${d.public_token}`);
    expect(st.payoutStatus).toBe("NOT_APPLICABLE");
    await svc.handleDonationEvent(sessionEvent(d, "checkout.session.completed"), ctx);
    expect((await svc.getDonationStatus(STORE, d.public_token, "https://c")).payoutStatus).toBe("HELD");
  });
});

describe("full-gross guard", () => {
  it("blocks when available USD cannot cover gross without touching other held donations", () => {
    const p = computeReleasePreview(base({ availableUsdCents: 2500, otherHeldObligationsCents: 2000 }));
    expect(p.allowed).toBe(false);
  });
});

describe("receipt never trusts URL", () => {
  it("receipt status comes from DB only", async () => {
    const d = await made();
    const v = await svc.receiptView(d, "https://c");
    expect(v.status).toBe("PENDING");
    expect(v).not.toHaveProperty("downloads");
  });
});

import { computeReleasePreview as crp, DEFAULT_SETTINGS as DS } from "./rules";
describe("funds constraints", () => {
  it("blocks release without manual payout schedule and hold limit", () => {
    const p = crp({ settings: DS, donation: { id: "d", status: "PAID", amount_cents: 2000, currency: "USD", refunded_cents: 0, disputed: false, charge_id: null, beneficiary_snapshot: null } as any, beneficiary: null, charge: null, availableUsdCents: 0, otherHeldObligationsCents: 0, feeCoverageUsedCents: 0, existingRelease: false });
    expect(p.blockers.some((b) => b.startsWith("Manual payout schedule"))).toBe(true);
    expect(p.blockers).toContain("Country hold limit not configured");
    expect(p.allowed).toBe(false);
  });
  it("blocks when hold limit exceeded", () => {
    const p = crp({ settings: { ...DS, manual_payout_schedule_confirmed: true, max_hold_days: 30 }, donation: { id: "d", status: "PAID", amount_cents: 2000, currency: "USD", refunded_cents: 0, disputed: false, charge_id: null, beneficiary_snapshot: null, paid_at: "2026-01-01T00:00:00Z" } as any, beneficiary: null, charge: null, availableUsdCents: 0, otherHeldObligationsCents: 0, feeCoverageUsedCents: 0, existingRelease: false, now: Date.parse("2026-06-01T00:00:00Z") });
    expect(p.blockers).toContain("Hold limit exceeded: reconciliation needed before any release");
  });
});
