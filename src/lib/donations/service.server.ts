import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { PaymentError } from "@/lib/payments/errors";
import { randomToken, sha256Hex } from "@/lib/payments/crypto.server";
import type { StoreRow } from "@/lib/payments/store-auth.server";
import {
  DEFAULT_SETTINGS,
  DONATION_AMOUNTS_CENTS,
  campaignGaps,
  computeReleasePreview,
  fingerprintPayload,
  formatDonationName,
  nextDonationStatus,
  previewHashInput,
  sessionMatchesDonation,
  settingsGaps,
  type BeneficiaryLike,
  type CreateDonationInput,
  type DonationSettings,
  type DonationSignal,
  type DonationStatus,
  type ReleasePreview,
} from "./rules";

/* eslint-disable @typescript-eslint/no-explicit-any */
const db = supabaseAdmin as any;

function must<T extends { error: { message: string } | null }>(r: T, what: string): T {
  if (r.error) throw new Error(`${what} failed: ${r.error.message}`);
  return r;
}

export async function loadSettings(storeId: string): Promise<DonationSettings | null> {
  const { data } = await db.from("donation_settings").select("*").eq("store_id", storeId).maybeSingle();
  return (data as DonationSettings | null) ?? null;
}

async function loadIntegration(store: StoreRow) {
  if (!store.stripe_integration_id) return null;
  const { data } = await db
    .from("stripe_integrations")
    .select("id, status, environment, secret_key_ciphertext")
    .eq("id", store.stripe_integration_id)
    .maybeSingle();
  return data as { id: string; status: string; environment: string; secret_key_ciphertext: string | null } | null;
}

async function loadBeneficiary(id: string | null): Promise<BeneficiaryLike | null> {
  if (!id) return null;
  const { data } = await db.from("donation_beneficiaries").select("*").eq("id", id).maybeSingle();
  return data ?? null;
}

// ---------------- Catalog ----------------

export async function getDonationCatalog(store: StoreRow) {
  const [settings, integration, { data: campaigns }] = await Promise.all([
    loadSettings(store.id),
    loadIntegration(store),
    db.from("donation_campaigns").select("*").eq("store_id", store.id).order("slug"),
  ]);
  const s = settings ?? DEFAULT_SETTINGS;
  const globalReady = settingsGaps(settings, integration?.status === "ACTIVE").length === 0;
  const beneficiaryIds = [...new Set((campaigns ?? []).map((c: any) => c.beneficiary_id).filter(Boolean))];
  const { data: bens } = beneficiaryIds.length
    ? await db.from("donation_beneficiaries").select("*").in("id", beneficiaryIds)
    : { data: [] };
  const byId = new Map((bens ?? []).map((b: any) => [b.id, b]));
  return {
    purpose: "donation" as const,
    ready: globalReady,
    currency: "USD" as const,
    amountsCents: [...DONATION_AMOUNTS_CENTS],
    recipient: { name: s.recipient_name, country: s.recipient_country, useOfFunds: s.use_of_funds },
    campaigns: (campaigns ?? []).map((c: any) => ({
      slug: c.slug,
      title: c.title,
      active: Boolean(c.active),
      ready:
        globalReady &&
        campaignGaps(c, (byId.get(c.beneficiary_id) as BeneficiaryLike) ?? null, settings).length === 0,
    })),
  };
}

// ---------------- Create ----------------

export interface CheckoutClient {
  checkout: { sessions: { create(params: any, opts: { idempotencyKey: string }): Promise<any> } };
}

function publicView(d: any, origin: string) {
  return {
    donationId: d.id,
    donationNumber: d.donation_number,
    publicToken: d.public_token,
    purpose: "donation" as const,
    status: d.status as DonationStatus,
    amountCents: d.amount_cents,
    currency: "USD" as const,
    paymentUrl: `${origin}/donations/pay/${d.public_token}`,
    receiptUrl: `${origin}/donations/receipt/${d.public_token}`,
  };
}

function letters(n: number): string {
  const a = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(bytes, (b) => a[b % 26]).join("");
}

export async function createDonation(input: {
  store: StoreRow;
  body: CreateDonationInput;
  origin: string;
  stripeFactory?: (integration: { secret_key_ciphertext: string | null }) => Promise<CheckoutClient>;
}) {
  const { store, body, origin } = input;
  const fingerprint = await sha256Hex(fingerprintPayload(body));

  // Idempotency first: a repeat must return the same donation even if config changed since.
  const existing = await findByKey(store.id, body.idempotencyKey);
  if (existing) return resumeExisting(existing, fingerprint, input);

  const [settings, integration, { data: campaign }] = await Promise.all([
    loadSettings(store.id),
    loadIntegration(store),
    db.from("donation_campaigns").select("*").eq("store_id", store.id).eq("slug", body.campaignSlug).maybeSingle(),
  ]);
  if (!campaign) throw new PaymentError("NOT_FOUND", "Unknown campaign.");
  const gaps = settingsGaps(settings, integration?.status === "ACTIVE");
  if (gaps.length) throw new PaymentError("CONFIG_ERROR", "Donation configuration pending.", { gaps });
  const beneficiary = await loadBeneficiary(campaign.beneficiary_id);
  const cGaps = campaignGaps(campaign, beneficiary, settings);
  if (cGaps.length) throw new PaymentError("INVALID_STATE", "Campaign is not accepting donations.", { gaps: cGaps });

  const row = {
    store_id: store.id,
    campaign_id: campaign.id,
    donation_number: `HHF-${Date.now().toString(36).toUpperCase()}-${letters(4)}`,
    public_token: randomToken(40),
    status: "PENDING",
    amount_cents: body.amountCents,
    currency: "USD",
    donor_first_name: body.donor?.firstName ?? null,
    donor_last_name: body.donor?.lastName ?? null,
    donor_email: body.donor?.email ?? null,
    attribution: body.attribution ?? {},
    idempotency_key: body.idempotencyKey,
    request_fingerprint: fingerprint,
    integration_id: integration!.id,
    livemode: integration!.environment === "live",
    beneficiary_id: beneficiary!.id,
    // Immutable snapshot (DB trigger refuses later changes).
    beneficiary_snapshot: {
      beneficiary_id: beneficiary!.id,
      display_name: beneficiary!.display_name,
      country: beneficiary!.country,
      account_id: beneficiary!.stripe_account_id,
      captured_at: new Date().toISOString(),
    },
  };
  const ins = await db.from("donations").insert(row).select("*").single();
  if (ins.error) {
    // Concurrent request with the same key won the race.
    const raced = await findByKey(store.id, body.idempotencyKey);
    if (raced) return resumeExisting(raced, fingerprint, input);
    throw new Error(`Donation insert failed: ${ins.error.message}`);
  }
  await ledger(ins.data.id, "CREATED", body.amountCents, null, {});
  return ensureSession(ins.data, { campaign, settings: settings!, integration: integration!, ...input });
}

async function findByKey(storeId: string, key: string) {
  const { data } = await db.from("donations").select("*").eq("store_id", storeId).eq("idempotency_key", key).maybeSingle();
  return data;
}

async function resumeExisting(d: any, fingerprint: string, input: Parameters<typeof createDonation>[0]) {
  if (d.request_fingerprint !== fingerprint) {
    throw new PaymentError("INVALID_STATE", "Idempotency key reused with a different payload.");
  }
  if (d.checkout_url || d.status !== "PENDING") return publicView(d, input.origin);
  // Previous attempt stored the row but not the session: retry with the same Stripe idempotency key.
  const [settings, integration, { data: campaign }] = await Promise.all([
    loadSettings(input.store.id),
    loadIntegration(input.store),
    db.from("donation_campaigns").select("*").eq("id", d.campaign_id).maybeSingle(),
  ]);
  if (!integration || integration.id !== d.integration_id || settingsGaps(settings, integration.status === "ACTIVE").length) {
    throw new PaymentError("CONFIG_ERROR", "Donation configuration pending.");
  }
  return ensureSession(d, { campaign, settings: settings!, integration, ...input });
}

async function ensureSession(
  d: any,
  ctx: Parameters<typeof createDonation>[0] & {
    campaign: any;
    settings: DonationSettings;
    integration: { id: string; secret_key_ciphertext: string | null };
  },
) {
  const factory =
    ctx.stripeFactory ??
    (async (i: { secret_key_ciphertext: string | null }) =>
      (await import("./stripe-sdk.server")).donationStripeFromIntegration(i) as unknown as Promise<CheckoutClient>);
  const stripe = await factory(ctx.integration);
  const metadata = {
    purpose: "donation",
    donation_id: d.id,
    donation_number: d.donation_number,
    store_id: d.store_id,
    integration_id: ctx.integration.id,
    campaign_slug: ctx.campaign.slug,
    campaign_title: String(ctx.campaign.title).slice(0, 450),
    recipient: ctx.settings.recipient_name,
    base_amount_cents: String(d.amount_cents),
    base_currency: "USD",
  };
  const receipt = `${ctx.origin}/donations/receipt/${d.public_token}`;
  const adaptive = ctx.settings.adaptive_pricing_eligible && ctx.settings.adaptive_pricing_enabled;
  const params: Record<string, unknown> = {
    mode: "payment",
    submit_type: "donate",
    client_reference_id: d.id,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: d.amount_cents,
          product_data: {
            name: formatDonationName(d.amount_cents),
            description: `Donation to ${ctx.settings.recipient_name} — ${ctx.campaign.title}`.slice(0, 500),
          },
        },
      },
    ],
    success_url: receipt,
    cancel_url: receipt,
    metadata,
    payment_intent_data: {
      description: `Donation ${d.donation_number} to ${ctx.settings.recipient_name}`,
      metadata,
    },
    adaptive_pricing: { enabled: adaptive },
    integration_identifier: `hhf_donations_${letters(8)}`,
    ...(d.donor_email ? { customer_email: d.donor_email } : {}),
  };
  const session = await stripe.checkout.sessions.create(params, { idempotencyKey: `donation-checkout:${d.id}` });
  const upd = must(
    await db
      .from("donations")
      .update({
        checkout_session_id: session.id,
        checkout_url: session.url,
        checkout_expires_at: session.expires_at ? new Date(session.expires_at * 1000).toISOString() : null,
      })
      .eq("id", d.id)
      .select("*")
      .single(),
    "Donation session save",
  );
  return publicView(upd.data, ctx.origin);
}

async function ledger(donationId: string, type: string, amount: number, objectId: string | null, metadata: object) {
  await db.from("donation_ledger").insert({
    donation_id: donationId,
    entry_type: type,
    amount_cents: amount,
    currency: "USD",
    stripe_object_id: objectId,
    metadata,
  });
}

// ---------------- Status / pay ----------------

export async function getDonationStatus(store: StoreRow, token: string, origin: string) {
  const { data: d } = await db.from("donations").select("*").eq("store_id", store.id).eq("public_token", token).maybeSingle();
  if (!d) throw new PaymentError("NOT_FOUND", "Donation not found.");
  const [{ data: campaign }, { data: rel }] = await Promise.all([
    db.from("donation_campaigns").select("slug").eq("id", d.campaign_id).maybeSingle(),
    db.from("donation_releases").select("status").eq("donation_id", d.id).maybeSingle(),
  ]);
  // Normalized contract: donation fields only — never ebook items or downloads.
  return {
    purpose: "donation" as const,
    donationId: d.id,
    donationNumber: d.donation_number,
    publicToken: d.public_token,
    status: d.status as DonationStatus,
    amountCents: d.amount_cents,
    currency: "USD" as const,
    receiptUrl: `${origin}/donations/receipt/${d.public_token}`,
    campaignSlug: campaign?.slug ?? null,
    payoutStatus: payoutStatus(d.status, rel?.status ?? null),
  };
}

/** HELD = paid and waiting for a human-approved transfer (payment was captured automatically). */
export function payoutStatus(status: string, releaseStatus: string | null) {
  if (status === "REVERSAL_REQUIRED") return "REVERSAL_REQUIRED" as const;
  if (releaseStatus === "SUCCEEDED" || status === "RELEASED") return "RELEASED" as const;
  if (releaseStatus === "PENDING") return "RELEASE_IN_PROGRESS" as const;
  if (releaseStatus === "FAILED") return "RELEASE_FAILED" as const;
  if (status === "PAID") return "HELD" as const;
  return "NOT_APPLICABLE" as const;
}

export async function receiptView(d: any, origin: string) {
  const [{ data: campaign }, settings] = await Promise.all([
    db.from("donation_campaigns").select("slug, title").eq("id", d.campaign_id).maybeSingle(),
    loadSettings(d.store_id),
  ]);
  const s = settings ?? DEFAULT_SETTINGS;
  return {
    ...publicView(d, origin),
    baseAmountCents: d.amount_cents,
    refundedCents: d.refunded_cents,
    paidAt: d.paid_at,
    createdAt: d.created_at,
    campaign: campaign ? { slug: campaign.slug, title: campaign.title } : null,
    recipient: { name: s.recipient_name, country: s.recipient_country, useOfFunds: s.use_of_funds },
    presentment:
      d.presentment_amount && d.presentment_currency
        ? { amount: d.presentment_amount, currency: String(d.presentment_currency).toUpperCase() }
        : null,
  };
}

export async function donationByToken(token: string) {
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(token)) return null;
  const { data } = await db.from("donations").select("*").eq("public_token", token).maybeSingle();
  return data;
}

// ---------------- Webhook dispatch ----------------

const DONATION_EVENT_TYPES = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
]);

async function applySignal(d: any, signal: DonationSignal, patch: Record<string, unknown>, objectId: string | null) {
  const next = nextDonationStatus(d.status, signal);
  if (!next) {
    await ledger(d.id, `IGNORED_${signal}`, 0, objectId, { from: d.status });
    return `Donation ${signal} ignored in ${d.status}.`;
  }
  // Optimistic guard on the current status: concurrent events cannot double-apply.
  must(
    await db.from("donations").update({ status: next, ...patch }).eq("id", d.id).eq("status", d.status),
    "Donation update",
  );
  await ledger(d.id, signal, d.amount_cents, objectId, { from: d.status, to: next });
  return `Donation ${d.status} -> ${next}.`;
}

/**
 * Returns a message when the event belongs to the donation subsystem,
 * or null so the legacy ebook pipeline handles it unchanged.
 */
export async function handleDonationEvent(
  event: { type: string; livemode: boolean; data: { object: Record<string, unknown> } },
  ctx: { integrationId: string; livemode: boolean } | undefined,
): Promise<string | null> {
  const o = event.data.object;
  const md = (o["metadata"] ?? {}) as Record<string, string>;

  if (DONATION_EVENT_TYPES.has(event.type)) {
    if (md["purpose"] !== "donation") return null; // not ours (ebooks never use Checkout Sessions)
    if (!ctx) return "Donation event without integration context (ignored).";
    const { data: d } = await db.from("donations").select("*").eq("checkout_session_id", String(o["id"])).maybeSingle();
    if (!d) return "Donation session not found locally (ignored).";
    const mismatch = sessionMatchesDonation(o, d, ctx);
    if (mismatch) {
      await ledger(d.id, "WEBHOOK_MISMATCH", 0, String(o["id"]), { field: mismatch, type: event.type });
      return `Donation event mismatch on ${mismatch} (ignored).`;
    }
    const pd = o["presentment_details"] as { presentment_amount?: number; presentment_currency?: string } | undefined;
    const base = {
      payment_intent_id: typeof o["payment_intent"] === "string" ? o["payment_intent"] : d.payment_intent_id,
      presentment_amount: pd?.presentment_amount ?? d.presentment_amount,
      presentment_currency: pd?.presentment_currency ?? d.presentment_currency,
    };
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
        if (o["payment_status"] === "paid") {
          return applySignal(d, "SESSION_PAID", { ...base, paid_at: new Date().toISOString() }, String(o["id"]));
        }
        return event.type === "checkout.session.completed"
          ? applySignal(d, "SESSION_UNPAID", base, String(o["id"]))
          : "Async success without paid status (ignored).";
      case "checkout.session.async_payment_failed":
        return applySignal(d, "ASYNC_FAILED", base, String(o["id"]));
      case "checkout.session.expired":
        return applySignal(d, "EXPIRED", {}, String(o["id"]));
    }
  }

  const piId =
    event.type.startsWith("payment_intent.") ? String(o["id"]) : typeof o["payment_intent"] === "string" ? (o["payment_intent"] as string) : null;
  if (!piId) return null;
  const { data: d } = await db.from("donations").select("*").eq("payment_intent_id", piId).maybeSingle();
  if (!d) return md["purpose"] === "donation" ? "Donation payment not linked yet (ignored)." : null;
  if (ctx && (d.integration_id !== ctx.integrationId || d.livemode !== ctx.livemode)) {
    return "Donation event from a different integration (ignored).";
  }
  switch (event.type) {
    case "payment_intent.succeeded":
      return "Donation confirmation comes from checkout.session events.";
    case "payment_intent.payment_failed":
      return applySignal(d, "PI_FAILED", {}, piId);
    case "payment_intent.canceled":
      return applySignal(d, "PI_CANCELED", {}, piId);
    case "charge.refunded": {
      const refunded = Math.max(Number(o["amount_refunded"] ?? 0), d.refunded_cents ?? 0);
      const full = refunded >= d.amount_cents;
      return applySignal(d, full ? "REFUND_FULL" : "REFUND_PARTIAL", { refunded_cents: refunded, charge_id: String(o["id"]) }, String(o["id"]));
    }
    case "charge.dispute.created":
      return applySignal(d, "DISPUTE", { disputed: true }, String(o["id"]));
    default:
      return "Unhandled donation event.";
  }
}

// ---------------- Release (admin, human-confirmed) ----------------

export interface ReleaseStripe {
  paymentIntents: { retrieve(id: string, p: any): Promise<any> };
  balance: { retrieve(): Promise<any> };
  transfers: { create(p: any, o: { idempotencyKey: string }): Promise<any> };
}

async function releaseStripe(storeId: string): Promise<ReleaseStripe> {
  const { data: store } = await db.from("stores").select("*").eq("id", storeId).maybeSingle();
  const integration = store ? await loadIntegration(store) : null;
  if (!integration || integration.status !== "ACTIVE") throw new PaymentError("CONFIG_ERROR", "Stripe integration not active.");
  const { donationStripeFromIntegration } = await import("./stripe-sdk.server");
  return (await donationStripeFromIntegration(integration)) as unknown as ReleaseStripe;
}

export async function buildReleasePreview(donationId: string, stripeOverride?: ReleaseStripe): Promise<ReleasePreview> {
  const { data: d } = await db.from("donations").select("*").eq("id", donationId).maybeSingle();
  if (!d) throw new PaymentError("NOT_FOUND", "Donation not found.");
  const settings = await loadSettings(d.store_id);
  const beneficiary = await loadBeneficiary(d.beneficiary_id);
  const { data: rel } = await db.from("donation_releases").select("id").eq("donation_id", d.id).maybeSingle();

  let charge: ReleaseInputsCharge = null;
  let availableUsd = 0;
  if (d.payment_intent_id && d.status === "PAID") {
    const stripe = stripeOverride ?? (await releaseStripe(d.store_id));
    const pi = await stripe.paymentIntents.retrieve(d.payment_intent_id, { expand: ["latest_charge.balance_transaction"] });
    const ch = pi.latest_charge;
    const bt = ch?.balance_transaction;
    if (ch && bt) {
      charge = {
        id: ch.id,
        amount: ch.amount,
        paid: ch.paid,
        refunded: ch.refunded,
        amount_refunded: ch.amount_refunded,
        disputed: ch.disputed,
        balanceTransactionCurrency: bt.currency,
        feeCents: bt.fee,
        feeDetails: (bt.fee_details ?? []).map((f: any) => ({ type: f.type, amount: f.amount, description: f.description })),
        fundsAvailable: bt.status === "available",
      };
      if (!d.charge_id) await db.from("donations").update({ charge_id: ch.id }).eq("id", d.id);
      d.charge_id ??= ch.id;
    }
    const bal = await stripe.balance.retrieve();
    availableUsd = (bal.available ?? []).filter((b: any) => b.currency === "usd").reduce((s: number, b: any) => s + b.amount, 0);
  }
  const { data: held } = await db.from("donations").select("id, amount_cents").eq("store_id", d.store_id).eq("status", "PAID");
  const other = (held ?? []).filter((h: any) => h.id !== d.id).reduce((s: number, h: any) => s + h.amount_cents, 0);
  const { data: used } = await db.from("donation_releases").select("fee_coverage_cents, status");
  const usedCoverage = (used ?? [])
    .filter((u: any) => u.status !== "FAILED")
    .reduce((s: number, u: any) => s + (u.fee_coverage_cents ?? 0), 0);

  return computeReleasePreview({
    donation: d,
    beneficiary,
    settings,
    charge,
    availableUsdCents: availableUsd,
    otherHeldObligationsCents: other,
    feeCoverageUsedCents: usedCoverage,
    existingRelease: Boolean(rel),
  });
}
type ReleaseInputsCharge = Parameters<typeof computeReleasePreview>[0]["charge"];

export async function previewHash(p: ReleasePreview) {
  return sha256Hex(previewHashInput(p));
}

export async function executeRelease(input: {
  donationId: string;
  previewHash: string;
  confirmedBy: string;
  maxAmountCents: number;
  stripeOverride?: ReleaseStripe;
}) {
  const stripe = input.stripeOverride ?? (await (async () => {
    const { data: d } = await db.from("donations").select("store_id").eq("id", input.donationId).maybeSingle();
    if (!d) throw new PaymentError("NOT_FOUND", "Donation not found.");
    return releaseStripe(d.store_id);
  })());
  const preview = await buildReleasePreview(input.donationId, stripe);
  if (!preview.allowed) throw new PaymentError("INVALID_STATE", "Release blocked.", { blockers: preview.blockers });
  if ((await previewHash(preview)) !== input.previewHash) {
    throw new PaymentError("INVALID_STATE", "Preview changed. Review it again before confirming.");
  }
  if (preview.transferAmountCents > input.maxAmountCents) {
    throw new PaymentError("INVALID_STATE", "Transfer exceeds the confirmed maximum.");
  }
  const key = `donation-release:${preview.donationId}`;
  // UNIQUE(donation_id) is the lock: a second release can never be reserved.
  const lock = await db.from("donation_releases").insert({
    donation_id: preview.donationId,
    idempotency_key: key,
    amount_cents: preview.transferAmountCents,
    fee_coverage_cents: preview.ngoCoverageRequiredCents,
    destination_account_id: preview.recipientAccountId,
    source_charge_id: preview.sourceChargeId,
    preview_hash: input.previewHash,
    confirmed_by: input.confirmedBy,
  });
  if (lock.error) throw new PaymentError("INVALID_STATE", "A release already exists for this donation.");
  try {
    const transfer = await stripe.transfers.create(
      {
        amount: preview.transferAmountCents, // FULL gross — never net of fees
        currency: "usd",
        destination: preview.recipientAccountId,
        source_transaction: preview.sourceChargeId,
        transfer_group: `donation_${preview.donationId}`,
        description: "Donation release (full original amount)",
        metadata: { purpose: "donation_release", donation_id: preview.donationId },
      },
      { idempotencyKey: key },
    );
    await db.from("donation_releases").update({ status: "SUCCEEDED", transfer_id: transfer.id }).eq("donation_id", preview.donationId);
    const { data: d } = await db.from("donations").select("*").eq("id", preview.donationId).maybeSingle();
    await applySignal(d, "RELEASED", { released_at: new Date().toISOString() }, transfer.id);
    await ledger(preview.donationId, "FEE_COVERED_BY_NGO", preview.ngoCoverageRequiredCents, transfer.id, {});
    return { transferId: transfer.id, amountCents: preview.transferAmountCents };
  } catch (error) {
    await db
      .from("donation_releases")
      .update({ status: "FAILED", error: (error as Error).message.slice(0, 300) })
      .eq("donation_id", preview.donationId);
    throw error;
  }
}
