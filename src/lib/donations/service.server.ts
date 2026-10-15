import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { PaymentError } from "@/lib/payments/errors";
import { randomToken, sha256Hex } from "@/lib/payments/crypto.server";
import type { StoreRow } from "@/lib/payments/store-auth.server";
import {
  DEFAULT_SETTINGS,
  DONATION_AMOUNTS_CENTS,
  buildSessionRequest,
  campaignGaps,
  computeReleasePreview,
  fingerprintPayload,
  integrationGaps,
  lettersFromHex,
  previewHashInput,
  sessionMatchesDonation,
  sessionResponseGaps,
  settingsGaps,
  verificationGaps,
  type BeneficiaryLike,
  type CreateDonationInput,
  type DonationSettings,
  type DonationSignal,
  type DonationStatus,
  type IntegrationLike,
  type RecipientVerification,
  type ReleasePreview,
  type ReleaseState,
} from "./rules";

/* eslint-disable @typescript-eslint/no-explicit-any */
const db = supabaseAdmin as any;

function must<T extends { error: { message: string } | null }>(r: T, what: string): T {
  if (r.error) throw new Error(`${what} failed: ${r.error.message}`);
  return r;
}

/** Thrown when a webhook cannot be safely resolved yet; the event stays FAILED and is retried. */
export class RetryableDonationError extends Error {}

// ---------------- Provider (separate dahlia SDK instance; injectable for tests) ----------------

export interface DonationProvider {
  checkout: { sessions: { create(params: any, opts: { idempotencyKey: string }): Promise<any> } };
  v2: {
    core: {
      accounts: { retrieve(id: string, p?: any): Promise<any> };
      accountLinks: { create(p: any): Promise<any> };
    };
  };
  paymentIntents: { retrieve(id: string, p: any): Promise<any> };
  balance: { retrieve(): Promise<any> };
  transfers: { create(p: any, o: { idempotencyKey: string }): Promise<any>; list(p: any): Promise<any> };
}

type ProviderFactory = (integration: IntegrationLike) => Promise<DonationProvider>;
let providerFactory: ProviderFactory = async (i) =>
  (await import("./stripe-sdk.server")).donationStripeFromIntegration(i) as unknown as Promise<DonationProvider>;
/** Test hook: replace the Stripe provider with a fake. */
export function __setDonationProviderFactory(f: ProviderFactory) {
  providerFactory = f;
}

// ---------------- Loaders ----------------

export async function loadSettings(storeId: string): Promise<DonationSettings | null> {
  const r = must(await db.from("donation_settings").select("*").eq("store_id", storeId).maybeSingle(), "Settings read");
  return (r.data as DonationSettings | null) ?? null;
}

const INTEGRATION_COLS = "id, status, environment, secret_key_ciphertext, webhook_secret_ciphertext, stripe_account_id";
async function loadIntegrationById(id: string | null): Promise<IntegrationLike | null> {
  if (!id) return null;
  const r = must(await db.from("stripe_integrations").select(INTEGRATION_COLS).eq("id", id).maybeSingle(), "Integration read");
  return r.data ?? null;
}

async function loadBeneficiary(storeId: string, id: string | null): Promise<BeneficiaryLike | null> {
  if (!id) return null;
  const r = must(
    await db.from("donation_beneficiaries").select("*").eq("id", id).eq("store_id", storeId).maybeSingle(),
    "Beneficiary read",
  );
  return r.data ?? null;
}

/** Live read of the connected account through Accounts v2 (ownership = readable with this platform key). */
export async function verifyRecipient(provider: DonationProvider, accountId: string): Promise<RecipientVerification> {
  try {
    const a = await provider.v2.core.accounts.retrieve(accountId, { include: ["configuration.recipient", "identity", "defaults"] });
    const r = a?.defaults?.responsibilities;
    return {
      accountId: a?.id ?? "",
      country: a?.identity?.country ? String(a.identity.country).toUpperCase() : null,
      transfersStatus: a?.configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers?.status ?? null,
      recipientConfigured: Array.isArray(a?.applied_configurations) && a.applied_configurations.includes("recipient"),
      feesCollector: typeof r?.fees_collector === "string" ? r.fees_collector : null,
      lossesCollector: typeof r?.losses_collector === "string" ? r.losses_collector : null,
      dashboard: typeof a?.dashboard === "string" ? a.dashboard : null,
      livemode: typeof a?.livemode === "boolean" ? a.livemode : null,
    };
  } catch (e) {
    return { accountId, country: null, transfersStatus: null, recipientConfigured: false, feesCollector: null, lossesCollector: null, dashboard: null, livemode: null, error: (e as Error).message.slice(0, 160) };
  }
}

// ---------------- Catalog ----------------

export async function getDonationCatalog(store: StoreRow) {
  const [settings, integration, campaignsR] = await Promise.all([
    loadSettings(store.id),
    loadIntegrationById(store.stripe_integration_id ?? null),
    db.from("donation_campaigns").select("*").eq("store_id", store.id).order("slug"),
  ]);
  const campaigns = must(campaignsR, "Campaign read").data ?? [];
  const s = settings ?? DEFAULT_SETTINGS;
  const globalReady = settingsGaps(settings, integrationGaps(integration)).length === 0;
  const ids = [...new Set(campaigns.map((c: any) => c.beneficiary_id).filter(Boolean))];
  const bens = ids.length
    ? must(await db.from("donation_beneficiaries").select("*").eq("store_id", store.id).in("id", ids), "Beneficiary read").data ?? []
    : [];
  const byId = new Map(bens.map((b: any) => [b.id, b]));
  return {
    purpose: "donation" as const,
    ready: globalReady,
    currency: "USD" as const,
    amountsCents: [...DONATION_AMOUNTS_CENTS],
    recipient: { name: s.recipient_name, country: s.recipient_country, useOfFunds: s.use_of_funds },
    campaigns: campaigns.map((c: any) => ({
      slug: c.slug,
      title: c.title,
      active: Boolean(c.active),
      // Live provider verification happens at creation time; catalog never claims more than local gates.
      ready: globalReady && campaignGaps(c, (byId.get(c.beneficiary_id) as BeneficiaryLike) ?? null, settings).length === 0,
    })),
  };
}

// ---------------- Create ----------------

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

export async function createDonation(input: { store: StoreRow; body: CreateDonationInput; origin: string }) {
  const { store, body, origin } = input;
  const fingerprint = await sha256Hex(fingerprintPayload(body));

  // Idempotency first: a repeat must return the same donation even if config changed since.
  const existing = await findByKey(store.id, body.idempotencyKey);
  if (existing) return resumeExisting(existing, fingerprint, origin);

  const [settings, integration, campaignR] = await Promise.all([
    loadSettings(store.id),
    loadIntegrationById(store.stripe_integration_id ?? null),
    db.from("donation_campaigns").select("*").eq("store_id", store.id).eq("slug", body.campaignSlug).maybeSingle(),
  ]);
  const campaign = must(campaignR, "Campaign read").data;
  if (!campaign) throw new PaymentError("NOT_FOUND", "Unknown campaign.");
  const gaps = settingsGaps(settings, integrationGaps(integration));
  if (gaps.length) throw new PaymentError("CONFIG_ERROR", "Donation configuration pending.", { gaps });
  const beneficiary = await loadBeneficiary(store.id, campaign.beneficiary_id);
  const cGaps = campaignGaps(campaign, beneficiary, settings);
  if (cGaps.length) throw new PaymentError("INVALID_STATE", "Campaign is not accepting donations.", { gaps: cGaps });

  // Actual Stripe readiness of the recipient, before accepting any payment.
  const provider = await providerFactory(integration!);
  const verification = await verifyRecipient(provider, beneficiary!.stripe_account_id!);
  const vGaps = verificationGaps(beneficiary, verification, { settings, livemode: integration!.environment === "live" });
  if (vGaps.length) throw new PaymentError("INVALID_STATE", "Campaign is not accepting donations.", { gaps: vGaps });

  const id = crypto.randomUUID();
  const publicToken = randomToken(40);
  const donationNumber = `HHF-${Date.now().toString(36).toUpperCase()}-${lettersFromHex(await sha256Hex(`num:${id}`), 4)}`;
  const integrationIdentifier = `hhf_donations_${lettersFromHex(await sha256Hex(`iid:${id}`))}`;
  const s = settings!;
  const sessionRequest = buildSessionRequest({
    donationId: id,
    donationNumber,
    storeId: store.id,
    integrationId: integration!.id,
    publicToken,
    amountCents: body.amountCents,
    donorEmail: body.donor?.email ?? null,
    origin,
    campaign: { slug: campaign.slug, title: String(campaign.title) },
    recipientName: s.recipient_name,
    adaptivePricing: s.adaptive_pricing_eligible && s.adaptive_pricing_enabled,
    integrationIdentifier,
  });
  const row = {
    id,
    store_id: store.id,
    campaign_id: campaign.id,
    donation_number: donationNumber,
    public_token: publicToken,
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
    platform_account_id: integration!.stripe_account_id,
    beneficiary_id: beneficiary!.id,
    beneficiary_snapshot: {
      beneficiary_id: beneficiary!.id,
      display_name: beneficiary!.display_name,
      country: beneficiary!.country,
      account_id: beneficiary!.stripe_account_id,
      captured_at: new Date().toISOString(),
    },
    receipt_snapshot: {
      recipient: { name: s.recipient_name, country: s.recipient_country, useOfFunds: s.use_of_funds },
      campaign: { slug: campaign.slug, title: campaign.title },
      beneficiaryName: beneficiary!.display_name,
    },
    integration_identifier: integrationIdentifier,
    session_request: sessionRequest,
  };
  const ins = await db.from("donations").insert(row).select("*").single();
  if (ins.error) {
    // Concurrent request with the same key won the race.
    const raced = await findByKey(store.id, body.idempotencyKey);
    if (raced) return resumeExisting(raced, fingerprint, origin);
    throw new Error(`Donation insert failed: ${ins.error.message}`);
  }
  must(await db.from("donation_ledger").insert({ donation_id: id, entry_type: "CREATED", amount_cents: body.amountCents, metadata: {} }), "Ledger write");
  return ensureSession(ins.data, origin, provider);
}

async function findByKey(storeId: string, key: string) {
  const r = must(await db.from("donations").select("*").eq("store_id", storeId).eq("idempotency_key", key).maybeSingle(), "Donation read");
  return r.data;
}

/** Stripe may prune idempotency keys after 24h; we stop retrying well before that. */
export const IDEMPOTENCY_WINDOW_SECONDS = 23 * 3600;

/** Original integration bound to this donation's account and mode, or the reasons it is unusable. */
function originalBindingGaps(d: any, integration: IntegrationLike | null): string[] {
  const g = integrationGaps(integration);
  if (integration && (integration.environment === "live") !== d.livemode) g.push("Integration environment differs from the donation");
  if (integration && integration.stripe_account_id !== d.platform_account_id) g.push("Platform Stripe account differs from the donation");
  return g;
}

/**
 * CURRENT acceptance gates for an existing donation: human config, original integration,
 * campaign + immutable beneficiary mapping, and (when a provider is given) live recipient readiness.
 */
export async function currentAcceptanceGaps(d: any, provider?: DonationProvider | null): Promise<string[]> {
  const [settings, integration, campR] = await Promise.all([
    loadSettings(d.store_id),
    loadIntegrationById(d.integration_id),
    db.from("donation_campaigns").select("*").eq("id", d.campaign_id).eq("store_id", d.store_id).maybeSingle(),
  ]);
  const campaign = must(campR, "Campaign read").data;
  const gaps = settingsGaps(settings, originalBindingGaps(d, integration));
  if (!campaign) return [...gaps, "Campaign not found"];
  const beneficiary = await loadBeneficiary(d.store_id, d.beneficiary_id);
  if (campaign.beneficiary_id !== d.beneficiary_id) gaps.push("Campaign recipient mapping changed since this donation was created");
  if (beneficiary && beneficiary.stripe_account_id !== d.beneficiary_snapshot?.account_id) gaps.push("Recipient account differs from the donation snapshot");
  gaps.push(...campaignGaps(campaign, beneficiary, settings));
  if (provider !== undefined) {
    if (!provider || !beneficiary?.stripe_account_id) gaps.push("Recipient account not verified with Stripe");
    else gaps.push(...verificationGaps(beneficiary, await verifyRecipient(provider, beneficiary.stripe_account_id), { settings, livemode: d.livemode }));
  }
  return [...new Set(gaps)];
}

async function flagCheckoutManualReview(id: string) {
  must(await db.from("donations").update({ checkout_manual_review: true }).eq("id", id), "Checkout review flag");
}

async function resumeExisting(d: any, fingerprint: string, origin: string) {
  if (d.request_fingerprint !== fingerprint) {
    throw new PaymentError("INVALID_STATE", "Idempotency key reused with a different payload.");
  }
  if (d.checkout_url || d.status !== "PENDING") return publicView(d, origin);
  if (!d.session_request) throw new PaymentError("CONFIG_ERROR", "Donation has no stored session request.");
  if (d.checkout_manual_review) throw new PaymentError("INVALID_STATE", "This donation checkout needs manual review.");
  if (d.checkout_first_attempt_at && Date.now() - Date.parse(d.checkout_first_attempt_at) > IDEMPOTENCY_WINDOW_SECONDS * 1000) {
    // A Session may exist at Stripe that we never saved; a new create could duplicate it.
    await flagCheckoutManualReview(d.id);
    throw new PaymentError("INVALID_STATE", "This donation checkout needs manual review.");
  }
  // Retry the exact stored request under the same key, bound to the ORIGINAL integration,
  // and only if every CURRENT acceptance gate still passes.
  const integration = await loadIntegrationById(d.integration_id);
  if (originalBindingGaps(d, integration).length) throw new PaymentError("CONFIG_ERROR", "Donation configuration pending.");
  const provider = await providerFactory(integration!);
  const gaps = await currentAcceptanceGaps(d, provider);
  if (gaps.length) throw new PaymentError("CONFIG_ERROR", "Donation configuration pending.", { gaps });
  return ensureSession(d, origin, provider);
}

/** Pay-page gate: NEW local redirects only while acceptance is open. Does not expire Sessions already open at Stripe. */
export async function paymentRedirectGaps(d: any): Promise<string[]> {
  const integration = await loadIntegrationById(d.integration_id);
  if (originalBindingGaps(d, integration).length) return ["Donation configuration pending"];
  let provider: DonationProvider | null = null;
  try {
    provider = await providerFactory(integration!);
  } catch {
    provider = null;
  }
  return currentAcceptanceGaps(d, provider);
}

async function ensureSession(d: any, origin: string, provider: DonationProvider) {
  // Immutable start of this Session key's retry window, recorded BEFORE the remote call.
  if (!d.checkout_first_attempt_at) {
    must(
      await db.from("donations").update({ checkout_first_attempt_at: new Date().toISOString() }).eq("id", d.id).is("checkout_first_attempt_at", null),
      "Checkout attempt save",
    );
  }
  const session = await provider.checkout.sessions.create(d.session_request, { idempotencyKey: `donation-checkout:${d.id}` });
  const bad = sessionResponseGaps(session, d);
  if (bad.length) throw new Error(`Stripe session response rejected: ${bad.join(", ")}`);
  const upd = await db
    .from("donations")
    .update({
      checkout_session_id: session.id,
      checkout_url: session.url,
      checkout_expires_at: session.expires_at ? new Date(session.expires_at * 1000).toISOString() : null,
    })
    .eq("id", d.id)
    .select("*")
    .single();
  if (upd.error) {
    // A concurrent call may already have stored the same session (idempotent replay).
    const cur = must(await db.from("donations").select("*").eq("id", d.id).maybeSingle(), "Donation read").data;
    if (cur?.checkout_session_id === session.id) return publicView(cur, origin);
    throw new Error(`Donation session save failed: ${upd.error.message}`);
  }
  return publicView(upd.data, origin);
}

// ---------------- Status / pay ----------------

export async function getDonationStatus(store: StoreRow, token: string, origin: string) {
  const r = must(await db.from("donations").select("*").eq("store_id", store.id).eq("public_token", token).maybeSingle(), "Donation read");
  const d = r.data;
  if (!d) throw new PaymentError("NOT_FOUND", "Donation not found.");
  const [campaignR, relR] = await Promise.all([
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
    campaignSlug: d.receipt_snapshot?.campaign?.slug ?? campaignR.data?.slug ?? null,
    payoutStatus: payoutStatus(d.status, relR.data?.status ?? null),
  };
}

/** HELD = paid and waiting for a human-approved transfer (payment was captured automatically). */
export function payoutStatus(status: string, releaseStatus: string | null) {
  if (status === "REVERSAL_REQUIRED") return "REVERSAL_REQUIRED" as const;
  if (releaseStatus === "SUCCEEDED" || status === "RELEASED") return "RELEASED" as const;
  if (releaseStatus === "RESERVED" || releaseStatus === "SUBMITTED" || releaseStatus === "UNKNOWN") return "RELEASE_IN_PROGRESS" as const;
  if (releaseStatus === "FAILED" && status === "PAID") return "RELEASE_FAILED" as const;
  if (status === "PAID") return "HELD" as const;
  return "NOT_APPLICABLE" as const;
}

export async function receiptView(d: any, origin: string) {
  const snap = d.receipt_snapshot;
  let campaign = snap?.campaign ?? null;
  let recipient = snap?.recipient ?? null;
  if (!snap) {
    // Legacy rows without a snapshot fall back to current config.
    const [c, s] = await Promise.all([
      db.from("donation_campaigns").select("slug, title").eq("id", d.campaign_id).maybeSingle(),
      loadSettings(d.store_id),
    ]);
    const st = s ?? DEFAULT_SETTINGS;
    campaign = c.data ? { slug: c.data.slug, title: c.data.title } : null;
    recipient = { name: st.recipient_name, country: st.recipient_country, useOfFunds: st.use_of_funds };
  }
  // Local gates only (no provider call): tells a PENDING donor truthfully whether new payment is open.
  const acceptingPayments = d.status === "PENDING" ? (await currentAcceptanceGaps(d).catch(() => ["error"])).length === 0 : null;
  return {
    ...publicView(d, origin),
    acceptingPayments,
    baseAmountCents: d.amount_cents,
    refundedCents: d.refunded_cents,
    disputed: Boolean(d.disputed),
    paidAt: d.paid_at,
    createdAt: d.created_at,
    campaign,
    recipient,
    presentment:
      d.presentment_amount && d.presentment_currency
        ? { amount: d.presentment_amount, currency: String(d.presentment_currency).toUpperCase() }
        : null,
  };
}

export async function donationByToken(token: string) {
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(token)) return null;
  const r = must(await db.from("donations").select("*").eq("public_token", token).maybeSingle(), "Donation read");
  return r.data;
}

// ---------------- Webhook dispatch ----------------

const SESSION_EVENTS = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function apply(d: any, signal: DonationSignal, eventId: string | null, objectId: string | null, facts: Record<string, unknown>) {
  const r = must(
    await db.rpc("donation_apply_event", { _donation_id: d.id, _signal: signal, _event_id: eventId, _object_id: objectId, _facts: facts }),
    "Donation event apply",
  );
  const out = r.data ?? {};
  if (out.duplicate) return `Donation ${signal} already applied.`;
  if (out.mismatch) return `Donation ${signal} payment link mismatch (ignored).`;
  return `Donation ${signal}: ${out.from} -> ${out.status}.`;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v ? v : v && typeof v === "object" && typeof (v as any).id === "string" ? (v as any).id : null;
}

/**
 * Returns a message when the event belongs to the donation subsystem,
 * or null so the legacy ebook pipeline handles it unchanged.
 * Throws RetryableDonationError when a donation event cannot be safely resolved yet.
 */
export async function handleDonationEvent(
  event: { id?: string; type: string; livemode: boolean; data: { object: Record<string, unknown> } },
  ctx: { integrationId: string; livemode: boolean } | undefined,
): Promise<string | null> {
  const o = event.data.object;
  const md = (o["metadata"] ?? {}) as Record<string, string>;
  const eventId = event.id ?? null;

  if (SESSION_EVENTS.has(event.type)) {
    if (md["purpose"] !== "donation") return null; // ebooks never use Checkout Sessions
    if (!ctx) return "Donation event without integration context (ignored).";
    const found = must(await db.from("donations").select("*").eq("checkout_session_id", String(o["id"])).maybeSingle(), "Donation read").data;
    if (!found) {
      const candId = md["donation_id"];
      if (candId && UUID.test(candId)) {
        const cand = must(await db.from("donations").select("*").eq("id", candId).maybeSingle(), "Donation read").data;
        if (cand && !cand.checkout_session_id && cand.integration_id === ctx.integrationId && cand.livemode === ctx.livemode) {
          throw new RetryableDonationError("Donation session link not saved yet; retry later.");
        }
      }
      return "Donation session not found locally (ignored).";
    }
    const mismatch = sessionMatchesDonation(o, found, ctx);
    if (mismatch) return `Donation event mismatch on ${mismatch} (ignored).`;
    const pd = o["presentment_details"] as { presentment_amount?: number; presentment_currency?: string } | undefined;
    const facts = {
      payment_intent_id: str(o["payment_intent"]),
      presentment_amount: pd?.presentment_amount ?? null,
      presentment_currency: pd?.presentment_currency ?? null,
    };
    const sid = String(o["id"]);
    switch (event.type) {
      case "checkout.session.completed":
        return apply(found, o["payment_status"] === "paid" ? "SESSION_PAID" : "SESSION_UNPAID", eventId, sid, facts);
      case "checkout.session.async_payment_succeeded":
        if (o["payment_status"] !== "paid") return "Async success without paid status (ignored).";
        return apply(found, "SESSION_PAID", eventId, sid, facts);
      case "checkout.session.async_payment_failed":
        return apply(found, "ASYNC_FAILED", eventId, sid, facts);
      default:
        return apply(found, "EXPIRED", eventId, sid, {});
    }
  }

  const isPi = event.type.startsWith("payment_intent.");
  const isCharge = event.type === "charge.refunded" || event.type.startsWith("charge.dispute.");
  if (!isPi && !isCharge) return null;
  const piId = isPi ? String(o["id"]) : str(o["payment_intent"]);
  const chargeId = event.type === "charge.refunded" ? String(o["id"]) : event.type.startsWith("charge.dispute.") ? str(o["charge"]) : null;
  if (!piId) return null;

  let d = must(await db.from("donations").select("*").eq("payment_intent_id", piId).maybeSingle(), "Donation read").data;
  if (!d && isPi && md["purpose"] === "donation" && md["donation_id"] && UUID.test(md["donation_id"]) && ctx) {
    // PI created by our Checkout Session: link only when everything we set matches.
    const cand = must(await db.from("donations").select("*").eq("id", md["donation_id"]).maybeSingle(), "Donation read").data;
    if (
      cand && !cand.payment_intent_id && cand.store_id === md["store_id"] && cand.integration_id === ctx.integrationId &&
      md["integration_id"] === ctx.integrationId && cand.livemode === ctx.livemode && Boolean(o["livemode"]) === cand.livemode &&
      o["amount"] === cand.amount_cents && String(o["currency"]).toLowerCase() === "usd"
    ) d = cand;
  }
  if (!d) {
    const ebook = must(await db.from("payments").select("id").eq("provider_payment_id", piId).maybeSingle(), "Payment read").data;
    if (ebook) return null;
    if (md["purpose"] === "donation") throw new RetryableDonationError("Donation payment link not saved yet; retry later.");
    if (isCharge && ctx) {
      // Refund/dispute may belong to a donation whose payment link is still being saved: keep it for retry.
      const open = await db.from("donations").select("id", { count: "exact", head: true })
        .eq("integration_id", ctx.integrationId).eq("livemode", ctx.livemode).is("payment_intent_id", null).in("status", ["PENDING", "PROCESSING"]);
      if ((open.count ?? 0) > 0) throw new RetryableDonationError("Unlinked refund/dispute while donations are pending; retry later.");
    }
    return null;
  }
  if (!ctx || d.integration_id !== ctx.integrationId || d.livemode !== ctx.livemode || Boolean(event.livemode) !== d.livemode) {
    return "Donation event from a different integration (ignored).";
  }
  const base = { payment_intent_id: piId, charge_id: chargeId };
  switch (event.type) {
    case "payment_intent.succeeded":
      return "Donation confirmation comes from checkout.session events.";
    case "payment_intent.payment_failed":
      return apply(d, "PI_FAILED", eventId, piId, { ...base, error: (o["last_payment_error"] as any)?.code ?? "payment_failed" });
    case "payment_intent.canceled":
      return apply(d, "PI_CANCELED", eventId, piId, base);
    case "charge.refunded":
      return apply(d, "REFUND", eventId, chargeId, { ...base, amount_refunded: Number(o["amount_refunded"] ?? 0) });
    default:
      if (event.type.startsWith("charge.dispute.")) return apply(d, "DISPUTE", eventId, String(o["id"]), base);
      return "Unhandled donation event.";
  }
}

// ---------------- Release (admin, human-confirmed) ----------------

/** Provider bound to the donation's ORIGINAL integration, environment and platform account. */
async function boundProvider(d: any): Promise<{ provider: DonationProvider; gaps: string[] }> {
  const integration = await loadIntegrationById(d.integration_id);
  const gaps = originalBindingGaps(d, integration);
  if (!integration || gaps.length) throw new PaymentError("CONFIG_ERROR", "Original donation integration is not usable.", { gaps });
  return { provider: await providerFactory(integration), gaps };
}

/** Shared scope = Stripe platform account + mode + USD, across stores AND integration rows. */
async function scopeTotals(d: any, excludeReleaseId?: string) {
  const held = must(
    await db.from("donations").select("*").eq("platform_account_id", d.platform_account_id).eq("livemode", d.livemode).eq("currency", "USD"),
    "Held read",
  ).data ?? [];
  const rels = must(
    await db.from("donation_releases").select("*").eq("platform_account_id", d.platform_account_id).eq("livemode", d.livemode).eq("currency", "USD"),
    "Release read",
  ).data ?? [];
  const inflight = new Set(rels.filter((r: any) => ["RESERVED", "SUBMITTED", "UNKNOWN"].includes(r.status)).map((r: any) => r.donation_id));
  const other = held
    .filter((h: any) => h.id !== d.id && (["PAID", "PARTIALLY_REFUNDED", "DISPUTED"].includes(h.status) || inflight.has(h.id)))
    .reduce((s: number, h: any) => s + h.amount_cents - h.refunded_cents, 0);
  const feeUsed = rels
    .filter((r: any) => r.id !== excludeReleaseId && ["RESERVED", "SUBMITTED", "UNKNOWN", "SUCCEEDED"].includes(r.status))
    .reduce((s: number, r: any) => s + (r.fee_coverage_cents ?? 0), 0);
  return { other, feeUsed };
}

function releaseStateOf(status: string | null | undefined): ReleaseState {
  if (!status) return "NONE";
  if (status === "SUCCEEDED") return "SUCCEEDED";
  if (status === "FAILED") return "FAILED";
  return "IN_FLIGHT";
}

/**
 * With `resumeOf`, evaluates CURRENT guards for re-submitting that approved operation
 * (its own reservation is not counted against itself).
 */
export async function buildReleasePreview(donationId: string, resumeOf?: any): Promise<ReleasePreview & { availableUsdCents: number }> {
  const d = must(await db.from("donations").select("*").eq("id", donationId).maybeSingle(), "Donation read").data;
  if (!d) throw new PaymentError("NOT_FOUND", "Donation not found.");
  const settings = await loadSettings(d.store_id);
  const beneficiary = await loadBeneficiary(d.store_id, d.beneficiary_id);
  const rel = must(await db.from("donation_releases").select("status").eq("donation_id", d.id).maybeSingle(), "Release read").data;

  let charge: Parameters<typeof computeReleasePreview>[0]["charge"] = null;
  let availableUsd = 0;
  let verification: RecipientVerification | null = null;
  let iGaps: string[] = [];
  try {
    const { provider } = await boundProvider(d);
    if (beneficiary?.stripe_account_id) verification = await verifyRecipient(provider, beneficiary.stripe_account_id);
    if (d.payment_intent_id && d.status === "PAID") {
      const pi = await provider.paymentIntents.retrieve(d.payment_intent_id, { expand: ["latest_charge.balance_transaction"] });
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
        if (!d.charge_id) {
          must(await db.from("donations").update({ charge_id: ch.id }).eq("id", d.id).is("charge_id", null), "Charge link save");
          d.charge_id = ch.id;
        }
      }
      const bal = await provider.balance.retrieve();
      availableUsd = (bal.available ?? []).filter((b: any) => b.currency === "usd").reduce((s: number, b: any) => s + b.amount, 0);
    }
  } catch (e) {
    iGaps = (e as { details?: { gaps?: string[] } }).details?.gaps ?? [(e as Error).message];
  }
  const { other, feeUsed } = await scopeTotals(d, resumeOf?.id);
  const camp = must(await db.from("donation_campaigns").select("*").eq("id", d.campaign_id).eq("store_id", d.store_id).maybeSingle(), "Campaign read").data;
  const campaignBlockers: string[] = [];
  if (!camp) campaignBlockers.push("Campaign not found");
  else {
    if (camp.review_status !== "APPROVED") campaignBlockers.push("Campaign not reviewed");
    if (camp.beneficiary_id !== d.beneficiary_id) campaignBlockers.push("Campaign recipient mapping changed since this donation was created");
    if (!camp.active && camp.release_mode !== "CAMPAIGN_END") campaignBlockers.push("Campaign suspended");
  }
  const computed = computeReleasePreview({
    donation: d,
    beneficiary,
    settings,
    verification,
    integrationGaps: iGaps,
    charge,
    availableUsdCents: availableUsd,
    otherHeldObligationsCents: other,
    feeCoverageUsedCents: feeUsed,
    releaseState: resumeOf ? "NONE" : releaseStateOf(rel?.status),
  });
  const blockers = [...new Set([...computed.blockers, ...campaignBlockers])];
  const preview = { ...computed, blockers, allowed: blockers.length === 0 };
  return { ...preview, availableUsdCents: availableUsd };
}

export async function previewHash(p: ReleasePreview) {
  return sha256Hex(previewHashInput(p));
}

/** Classifies a transfer error: only clear 4xx validation failures are definitive. */
function isDefinitiveFailure(e: any): boolean {
  const code = Number(e?.statusCode ?? 0);
  if (e?.code === "idempotency_key_in_use" || e?.type === "StripeIdempotencyError") return false;
  return code >= 400 && code < 500 && code !== 409 && code !== 429 && (e?.type === "StripeInvalidRequestError" || e?.type === "StripePermissionError");
}

async function mark(releaseId: string, outcome: string, transferId: string | null, error: string | null) {
  return must(
    await db.rpc("donation_release_mark", { _release_id: releaseId, _outcome: outcome, _transfer_id: transferId, _error: error }),
    `Release ${outcome} save`,
  ).data;
}

async function submitTransfer(rel: any, donationId: string, provider: DonationProvider) {
  // Final locked guard (donation state, adverse facts, switch, binding, window) right before create.
  const guard = must(
    await db.rpc("donation_release_submit_guard", { _release_id: rel.id, _window_seconds: IDEMPOTENCY_WINDOW_SECONDS }),
    "Release guard",
  ).data;
  if (!guard?.allowed) {
    throw new PaymentError("INVALID_STATE", `Release held for reconciliation: ${guard?.reason ?? "guard refused"}. No transfer was created.`);
  }
  let transfer: any;
  try {
    transfer = await provider.transfers.create(
      {
        amount: rel.amount_cents, // FULL gross — never net of fees
        currency: "usd",
        destination: rel.destination_account_id,
        source_transaction: rel.source_charge_id,
        transfer_group: `donation_${donationId}`,
        description: "Donation release (full original amount)",
        metadata: { purpose: "donation_release", donation_id: donationId, release_id: rel.id },
      },
      { idempotencyKey: rel.idempotency_key },
    );
  } catch (e) {
    const msg = (e as Error).message ?? "transfer error";
    if (isDefinitiveFailure(e)) {
      await mark(rel.id, "FAILED", null, msg);
      throw new PaymentError("INVALID_STATE", `Stripe rejected the transfer: ${msg}`);
    }
    await mark(rel.id, "UNKNOWN", null, msg);
    throw new PaymentError("INVALID_STATE", "Transfer outcome unknown. Use Resume to reconcile — no second transfer will be created.");
  }
  if (!transfer?.id || transfer.amount !== rel.amount_cents || transfer.destination !== rel.destination_account_id || String(transfer.currency).toLowerCase() !== "usd") {
    await mark(rel.id, "UNKNOWN", null, "Transfer response did not match the approved operation");
    throw new PaymentError("INVALID_STATE", "Transfer response did not match the approved operation; reconcile in Stripe.");
  }
  let out: any;
  try {
    out = await mark(rel.id, "SUCCEEDED", transfer.id, null);
  } catch (e) {
    throw new PaymentError(
      "INVALID_STATE",
      `Transfer ${transfer.id} exists at Stripe but was not saved locally. Use Resume — it records it without creating another transfer.`,
    );
  }
  return { transferId: transfer.id as string, amountCents: rel.amount_cents as number, donationStatus: out?.donation_status as string };
}

export async function executeRelease(input: { donationId: string; previewHash: string; confirmedBy: string; maxAmountCents: number }) {
  const preview = await buildReleasePreview(input.donationId);
  if (!preview.allowed) throw new PaymentError("INVALID_STATE", "Release blocked.", { blockers: preview.blockers });
  if ((await previewHash(preview)) !== input.previewHash) {
    throw new PaymentError("INVALID_STATE", "Preview changed. Review it again before confirming.");
  }
  if (preview.transferAmountCents > input.maxAmountCents) throw new PaymentError("INVALID_STATE", "Transfer exceeds the confirmed maximum.");
  const d = must(await db.from("donations").select("*").eq("id", input.donationId).maybeSingle(), "Donation read").data;
  const settings = (await loadSettings(d.store_id)) ?? DEFAULT_SETTINGS;
  const { provider } = await boundProvider(d);
  const res = await db.rpc("donation_release_reserve", {
    _donation_id: d.id,
    _preview_hash: input.previewHash,
    _confirmed_by: input.confirmedBy,
    _amount: preview.transferAmountCents,
    _fee: preview.ngoCoverageRequiredCents,
    _dest: preview.recipientAccountId,
    _source: preview.sourceChargeId,
    _available_usd: preview.availableUsdCents,
    _fee_budget: settings.ngo_fee_funding_cents,
  });
  if (res.error) throw new PaymentError("INVALID_STATE", `Release blocked: ${res.error.message}`);
  const r = res.data;
  if (r.action === "done") return { transferId: r.transfer_id as string, amountCents: preview.transferAmountCents, donationStatus: d.status };
  if (r.action === "resume") throw new PaymentError("INVALID_STATE", "A release is already in progress — use Resume.");
  const rel = must(await db.from("donation_releases").select("*").eq("id", r.release_id).single(), "Release read").data;
  return submitTransfer(rel, d.id, provider);
}

/**
 * Resumes an approved in-flight release with its ORIGINAL immutable parameters and
 * idempotency key. First looks for an already-created transfer; never creates a second one.
 */
export async function resumeRelease(donationId: string) {
  const rel = must(await db.from("donation_releases").select("*").eq("donation_id", donationId).maybeSingle(), "Release read").data;
  if (!rel) throw new PaymentError("NOT_FOUND", "No release operation for this donation.");
  if (rel.status === "SUCCEEDED") return { transferId: rel.transfer_id as string, amountCents: rel.amount_cents as number, donationStatus: null };
  if (!["RESERVED", "SUBMITTED", "UNKNOWN"].includes(rel.status)) throw new PaymentError("INVALID_STATE", `Release is ${rel.status}; start a new preview.`);
  const d = must(await db.from("donations").select("*").eq("id", donationId).maybeSingle(), "Donation read").data;
  const { provider } = await boundProvider(d);
  const list = await provider.transfers.list({ transfer_group: `donation_${donationId}`, limit: 10 });
  const existing = (list?.data ?? []).find(
    (t: any) => t.metadata?.release_id === rel.id && t.amount === rel.amount_cents && t.destination === rel.destination_account_id,
  );
  if (existing) {
    // Recording a verified existing transfer is always allowed (even with releases switched off).
    const out = await mark(rel.id, "SUCCEEDED", existing.id, null);
    return { transferId: existing.id as string, amountCents: rel.amount_cents as number, donationStatus: out?.donation_status ?? null };
  }
  if (rel.manual_reconciliation_required) {
    throw new PaymentError("INVALID_STATE", "Release needs manual reconciliation in Stripe. No transfer was created.");
  }
  // Window starts at the FIRST submission of this key (immutable), never updated_at.
  if (rel.submitted_at && Date.now() - Date.parse(rel.submitted_at) > IDEMPOTENCY_WINDOW_SECONDS * 1000) {
    must(await db.rpc("donation_release_flag_manual", { _release_id: rel.id, _reason: "Idempotency window passed; transfer not found by list" }), "Manual flag");
    throw new PaymentError("INVALID_STATE", "Release needs manual reconciliation in Stripe (idempotency window passed). No transfer was created.");
  }
  // Any potentially new/repeated create must pass every CURRENT guard; otherwise the op stays held.
  const p = await buildReleasePreview(donationId, rel);
  const mismatch = p.recipientAccountId !== rel.destination_account_id || p.transferAmountCents !== rel.amount_cents || p.sourceChargeId !== rel.source_charge_id;
  if (!p.allowed || mismatch) {
    const reasons = [...p.blockers, ...(mismatch ? ["Approved parameters differ from current donation"] : [])];
    throw new PaymentError("INVALID_STATE", `Release held for reconciliation: ${reasons.join("; ")}. No transfer was created.`, { blockers: reasons });
  }
  return submitTransfer(rel, donationId, provider);
}

// ---------------- Recipient onboarding (existing accounts only) ----------------

export async function verifyBeneficiary(storeId: string, beneficiaryId: string) {
  const b = await loadBeneficiary(storeId, beneficiaryId);
  if (!b?.stripe_account_id) throw new PaymentError("INVALID_STATE", "Beneficiary has no connected account.");
  const store = must(await db.from("stores").select("*").eq("id", storeId).maybeSingle(), "Store read").data;
  const integration = await loadIntegrationById(store?.stripe_integration_id ?? null);
  const gaps = integrationGaps(integration);
  if (gaps.length) throw new PaymentError("CONFIG_ERROR", "Stripe integration not ready.", { gaps });
  const v = await verifyRecipient(await providerFactory(integration!), b.stripe_account_id);
  must(
    await db.from("donation_beneficiaries").update({
      provider_verified_at: new Date().toISOString(),
      provider_country: v.country,
      provider_transfers_status: v.error ? "error" : v.transfersStatus,
    }).eq("id", b.id).eq("store_id", storeId),
    "Verification save",
  );
  const settings = await loadSettings(storeId);
  return { verification: v, gaps: verificationGaps(b, v, { settings, livemode: integration!.environment === "live" }) };
}

export async function createOnboardingLink(storeId: string, beneficiaryId: string, origin: string, gapsFn: (s: DonationSettings | null, b: BeneficiaryLike | null) => string[]) {
  const [settings, b] = await Promise.all([loadSettings(storeId), loadBeneficiary(storeId, beneficiaryId)]);
  const gaps = gapsFn(settings, b);
  const store = must(await db.from("stores").select("*").eq("id", storeId).maybeSingle(), "Store read").data;
  const integration = await loadIntegrationById(store?.stripe_integration_id ?? null);
  gaps.push(...integrationGaps(integration));
  if (gaps.length) throw new PaymentError("CONFIG_ERROR", "Onboarding not available.", { gaps });
  const provider = await providerFactory(integration!);
  // Fresh actual-account read: ownership, country, responsibilities, dashboard and mode must match
  // before any hosted link. Transfers capability may still be pending — onboarding completes it.
  const v = await verifyRecipient(provider, b!.stripe_account_id!);
  const vGaps = verificationGaps(b, v, { settings, livemode: integration!.environment === "live", requireTransfers: false });
  if (vGaps.length) throw new PaymentError("CONFIG_ERROR", "Onboarding not available.", { gaps: vGaps });
  const link = await provider.v2.core.accountLinks.create({
    account: b!.stripe_account_id,
    use_case: {
      type: "account_onboarding",
      account_onboarding: {
        configurations: ["recipient"],
        refresh_url: `${origin}/admin?onboarding=refresh`,
        return_url: `${origin}/admin?onboarding=return`,
      },
    },
  });
  if (typeof link?.url !== "string" || !link.url.startsWith("https://")) throw new Error("Stripe returned no onboarding URL.");
  return { url: link.url as string };
}
