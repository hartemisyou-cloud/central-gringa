/**
 * Pure donation rules (no I/O) — readiness gates, request validation,
 * fingerprints, webhook matching, status transitions and release math.
 * Everything here fails closed: missing configuration means "not ready".
 */
import { z } from "zod";

export const DONATION_AMOUNTS_CENTS = [2000, 3000, 5000, 10000, 25000, 50000] as const;
export const DONATION_CURRENCY = "USD" as const;
export const DONATION_STRIPE_API_VERSION = "2026-08-26.dahlia";

/** Self-serve cross-border regions are an operator choice, never assumed worldwide. */
export const FEE_POLICY_NGO_COVERS_ALL = "NGO_COVERS_ALL";

export interface DonationSettings {
  recipient_name: string;
  recipient_country: string;
  use_of_funds: string;
  platform_country: string | null;
  stripe_fundraising_approved: boolean;
  connect_approved: boolean;
  usd_settlement_eligible: boolean;
  adaptive_pricing_eligible: boolean;
  adaptive_pricing_enabled: boolean;
  allowed_recipient_countries: string[];
  recipient_service_agreement_allowed: boolean;
  fee_coverage_policy: string | null;
  dashboard_responsibility: string | null;
  negative_balance_liability: string | null;
  donations_enabled: boolean;
  releases_enabled: boolean;
  ngo_fee_funding_cents: number;
  confirmed_by: string | null;
  confirmed_at: string | null;
}

export const DEFAULT_SETTINGS: DonationSettings = {
  recipient_name: "Hope Human Foundation",
  recipient_country: "US",
  use_of_funds: "",
  platform_country: null,
  stripe_fundraising_approved: false,
  connect_approved: false,
  usd_settlement_eligible: false,
  adaptive_pricing_eligible: false,
  adaptive_pricing_enabled: false,
  allowed_recipient_countries: [],
  recipient_service_agreement_allowed: false,
  fee_coverage_policy: null,
  dashboard_responsibility: null,
  negative_balance_liability: null,
  donations_enabled: false,
  releases_enabled: false,
  ngo_fee_funding_cents: 0,
  confirmed_by: null,
  confirmed_at: null,
};

/** Gaps that block accepting donations. Empty list = ready. */
export function settingsGaps(s: DonationSettings | null, integrationActive: boolean): string[] {
  const c = s ?? DEFAULT_SETTINGS;
  const gaps: string[] = [];
  if (!c.recipient_name.trim()) gaps.push("Recipient name missing");
  if (!c.recipient_country.trim()) gaps.push("Recipient country missing");
  if (!c.use_of_funds.trim()) gaps.push("Use of funds not described");
  if (!c.platform_country) gaps.push("Platform Stripe account country not set");
  if (!c.stripe_fundraising_approved) gaps.push("Stripe fundraising approval not confirmed");
  if (!c.connect_approved) gaps.push("Stripe Connect approval not confirmed");
  if (!c.usd_settlement_eligible) gaps.push("USD settlement eligibility not confirmed");
  if (c.fee_coverage_policy !== FEE_POLICY_NGO_COVERS_ALL) gaps.push("Fee coverage policy not confirmed");
  if (!c.dashboard_responsibility) gaps.push("Dashboard responsibility not selected");
  if (!c.negative_balance_liability) gaps.push("Negative balance liability not selected");
  if (!c.confirmed_by || !c.confirmed_at) gaps.push("Human confirmation of financial responsibilities missing");
  if (!integrationActive) gaps.push("Stripe integration not active");
  if (!c.donations_enabled) gaps.push("Donations switch is off");
  return gaps;
}

export interface CampaignLike {
  slug: string;
  title: string;
  review_status: string;
  active: boolean;
  ends_at: string | null;
  beneficiary_id: string | null;
}
export interface BeneficiaryLike {
  id: string;
  display_name: string;
  country: string;
  stripe_account_id: string | null;
  onboarding_status: string;
  transfers_capability: string;
  service_agreement: string | null;
  review_status: string;
}

export function beneficiaryGaps(b: BeneficiaryLike | null, s: DonationSettings | null): string[] {
  const c = s ?? DEFAULT_SETTINGS;
  if (!b) return ["No beneficiary mapped"];
  const gaps: string[] = [];
  if (b.review_status !== "APPROVED") gaps.push("Beneficiary not reviewed");
  if (!b.stripe_account_id) gaps.push("Beneficiary has no connected account");
  if (b.onboarding_status !== "COMPLETE") gaps.push("Recipient onboarding incomplete");
  if (b.transfers_capability !== "active") gaps.push("Transfers capability not active");
  if (!c.allowed_recipient_countries.includes(b.country)) gaps.push("Recipient country not enabled");
  const crossBorder = c.platform_country !== null && b.country !== c.platform_country;
  if (crossBorder) {
    if (b.service_agreement !== "recipient") gaps.push("Cross-border recipient needs recipient service agreement");
    if (!c.recipient_service_agreement_allowed) gaps.push("Cross-border recipients not enabled");
  }
  return gaps;
}

export function campaignGaps(
  campaign: CampaignLike,
  beneficiary: BeneficiaryLike | null,
  s: DonationSettings | null,
  now = Date.now(),
): string[] {
  const gaps: string[] = [];
  if (campaign.review_status !== "APPROVED") gaps.push("Campaign not reviewed");
  if (!campaign.active) gaps.push("Campaign inactive");
  if (campaign.ends_at && new Date(campaign.ends_at).getTime() <= now) gaps.push("Campaign ended");
  return [...gaps, ...beneficiaryGaps(beneficiary, s)];
}

export const createDonationSchema = z
  .object({
    campaignSlug: z.string().trim().min(1).max(120).regex(/^[a-z0-9-]+$/),
    amountCents: z.number().int(),
    currency: z.literal("USD"),
    idempotencyKey: z.string().trim().min(8).max(200),
    donor: z
      .object({
        firstName: z.string().trim().min(1).max(80).optional(),
        lastName: z.string().trim().min(1).max(80).optional(),
        email: z.string().trim().email().max(160).optional(),
      })
      .strict()
      .optional(),
    attribution: z.record(z.string(), z.string().max(500)).optional(),
  })
  .strict()
  .refine((v) => (DONATION_AMOUNTS_CENTS as readonly number[]).includes(v.amountCents), {
    message: "Unsupported amount",
    path: ["amountCents"],
  });
export type CreateDonationInput = z.infer<typeof createDonationSchema>;

function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const o = value as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stable(o[k])}`)
    .join(",")}}`;
}

/** Canonical payload string for idempotency fingerprinting (key itself excluded). */
export function fingerprintPayload(input: CreateDonationInput): string {
  const { idempotencyKey: _k, ...rest } = input;
  return stable(rest);
}

export function formatDonationName(amountCents: number): string {
  const d = amountCents / 100;
  return `$${Number.isInteger(d) ? d : d.toFixed(2)} Donation`;
}

// ---------- Status machine ----------

export type DonationStatus =
  | "PENDING"
  | "PROCESSING"
  | "PAID"
  | "FAILED"
  | "EXPIRED"
  | "CANCELLED"
  | "REFUNDED"
  | "PARTIALLY_REFUNDED"
  | "DISPUTED"
  | "RELEASED"
  | "REVERSAL_REQUIRED";

export type DonationSignal =
  | "SESSION_PAID"
  | "SESSION_UNPAID"
  | "ASYNC_FAILED"
  | "EXPIRED"
  | "PI_FAILED"
  | "PI_CANCELED"
  | "REFUND_FULL"
  | "REFUND_PARTIAL"
  | "DISPUTE"
  | "RELEASED";

/** Returns the next status, or null when the signal must be ignored. */
export function nextDonationStatus(current: DonationStatus, signal: DonationSignal): DonationStatus | null {
  const open = current === "PENDING" || current === "PROCESSING";
  switch (signal) {
    case "SESSION_PAID":
      return open ? "PAID" : null;
    case "SESSION_UNPAID":
      return current === "PENDING" ? "PROCESSING" : null;
    case "ASYNC_FAILED":
    case "PI_FAILED":
      return open ? "FAILED" : null;
    case "PI_CANCELED":
      return open ? "CANCELLED" : null;
    case "EXPIRED":
      return current === "PENDING" ? "EXPIRED" : null;
    case "REFUND_FULL":
      if (current === "RELEASED" || current === "REVERSAL_REQUIRED") return "REVERSAL_REQUIRED";
      return ["PAID", "PARTIALLY_REFUNDED", "DISPUTED"].includes(current) ? "REFUNDED" : null;
    case "REFUND_PARTIAL":
      if (current === "RELEASED" || current === "REVERSAL_REQUIRED") return "REVERSAL_REQUIRED";
      return current === "PAID" ? "PARTIALLY_REFUNDED" : null;
    case "DISPUTE":
      if (current === "RELEASED" || current === "REVERSAL_REQUIRED") return "REVERSAL_REQUIRED";
      return ["PAID", "PARTIALLY_REFUNDED", "PROCESSING"].includes(current) ? "DISPUTED" : null;
    case "RELEASED":
      return current === "PAID" ? "RELEASED" : null;
  }
}

// ---------- Webhook matching ----------

export interface DonationMatchRow {
  id: string;
  store_id: string;
  integration_id: string | null;
  livemode: boolean;
  amount_cents: number;
  currency: string;
  checkout_session_id: string | null;
}

/** Every field must match; any mismatch means the event is not for this donation. */
export function sessionMatchesDonation(
  session: Record<string, unknown>,
  d: DonationMatchRow,
  ctx: { integrationId: string; livemode: boolean },
): string | null {
  const md = (session["metadata"] ?? {}) as Record<string, string>;
  if (session["id"] !== d.checkout_session_id) return "session id";
  if (session["client_reference_id"] !== d.id) return "client_reference_id";
  if (md["purpose"] !== "donation") return "purpose";
  if (md["donation_id"] !== d.id) return "donation_id";
  if (md["store_id"] !== d.store_id) return "store";
  if (!d.integration_id || d.integration_id !== ctx.integrationId) return "integration";
  if (md["integration_id"] !== ctx.integrationId) return "integration metadata";
  if (Boolean(session["livemode"]) !== d.livemode || ctx.livemode !== d.livemode) return "livemode";
  if (session["amount_total"] !== d.amount_cents) return "amount";
  if (String(session["currency"] ?? "").toUpperCase() !== d.currency) return "currency";
  if (md["base_amount_cents"] !== String(d.amount_cents)) return "base amount metadata";
  return null;
}

// ---------- Release math ----------

export interface ReleaseInputs {
  donation: {
    id: string;
    status: string;
    amount_cents: number;
    currency: string;
    refunded_cents: number;
    disputed: boolean;
    charge_id: string | null;
    beneficiary_snapshot: { account_id?: string; display_name?: string; country?: string } | null;
  };
  beneficiary: BeneficiaryLike | null;
  settings: DonationSettings | null;
  charge: {
    id: string;
    amount: number;
    paid: boolean;
    refunded: boolean;
    amount_refunded: number;
    disputed: boolean;
    balanceTransactionCurrency: string;
    feeCents: number;
    feeDetails: Array<{ type: string; amount: number; description?: string | null }>;
    fundsAvailable: boolean;
  } | null;
  /** Platform available balance in USD (cents) right now. */
  availableUsdCents: number;
  /** Gross of OTHER held (paid, unreleased) donations that must stay untouched. */
  otherHeldObligationsCents: number;
  /** Fee coverage already consumed by previous releases. */
  feeCoverageUsedCents: number;
  existingRelease: boolean;
}

export interface ReleasePreview {
  donationId: string;
  recipientName: string | null;
  recipientAccountId: string | null;
  recipientCountry: string | null;
  grossCents: number;
  transferAmountCents: number;
  currency: "USD";
  stripeFeeCents: number;
  feeComponents: Array<{ type: string; amount: number; description?: string | null }>;
  ngoCoverageRequiredCents: number;
  dedicatedFundingRemainingCents: number;
  freeBalanceCents: number;
  fundingDeficitCents: number;
  sourceChargeId: string | null;
  blockers: string[];
  allowed: boolean;
}

export function computeReleasePreview(i: ReleaseInputs): ReleasePreview {
  const s = i.settings ?? DEFAULT_SETTINGS;
  const d = i.donation;
  const snap = d.beneficiary_snapshot;
  const blockers: string[] = [];
  if (d.status !== "PAID") blockers.push(`Donation status is ${d.status}, not PAID`);
  if (d.refunded_cents > 0) blockers.push("Donation has refunds");
  if (d.disputed) blockers.push("Donation is disputed");
  if (i.existingRelease) blockers.push("A transfer already exists for this donation");
  if (d.currency !== "USD") blockers.push("Only USD donations can be released");
  if (!s.releases_enabled) blockers.push("Releases switch is off");
  if (s.fee_coverage_policy !== FEE_POLICY_NGO_COVERS_ALL) blockers.push("Fee coverage policy not confirmed");
  if (!s.connect_approved) blockers.push("Stripe Connect approval not confirmed");
  if (!snap?.account_id) blockers.push("Donation has no beneficiary snapshot");
  if (!i.beneficiary || i.beneficiary.stripe_account_id !== snap?.account_id) {
    blockers.push("Beneficiary account does not match the donation snapshot");
  }
  blockers.push(...beneficiaryGaps(i.beneficiary, i.settings));

  const c = i.charge;
  if (!c) blockers.push("Charge not confirmed");
  else {
    if (c.id !== d.charge_id) blockers.push("Charge does not match donation");
    if (!c.paid) blockers.push("Charge not paid");
    if (c.refunded || c.amount_refunded > 0) blockers.push("Charge has refunds");
    if (c.disputed) blockers.push("Charge is disputed");
    if (c.amount !== d.amount_cents) blockers.push("Charge amount differs from donation");
    if (c.balanceTransactionCurrency.toUpperCase() !== "USD") blockers.push("Charge did not settle in USD");
    if (!c.fundsAvailable) blockers.push("Charge funds are not yet available");
  }

  const gross = d.amount_cents;
  const fee = c?.feeCents ?? 0;
  const dedicatedRemaining = Math.max(0, s.ngo_fee_funding_cents - i.feeCoverageUsedCents);
  // Platform keeps gross-fee from this charge; full gross leaves. The rest must
  // come from free balance that is NOT owed to other held donations.
  const freeBalance = i.availableUsdCents - i.otherHeldObligationsCents - gross;
  const coverage = fee;
  const deficit = Math.max(0, coverage - dedicatedRemaining, -freeBalance);
  if (deficit > 0) blockers.push(`NGO fee funding deficit of ${deficit} cents`);
  if (gross > (c?.amount ?? 0)) blockers.push("Transfer would exceed source charge");

  return {
    donationId: d.id,
    recipientName: snap?.display_name ?? null,
    recipientAccountId: snap?.account_id ?? null,
    recipientCountry: snap?.country ?? null,
    grossCents: gross,
    transferAmountCents: gross,
    currency: "USD",
    stripeFeeCents: fee,
    feeComponents: c?.feeDetails ?? [],
    ngoCoverageRequiredCents: coverage,
    dedicatedFundingRemainingCents: dedicatedRemaining,
    freeBalanceCents: freeBalance,
    fundingDeficitCents: deficit,
    sourceChargeId: c?.id ?? null,
    blockers: [...new Set(blockers)],
    allowed: blockers.length === 0,
  };
}

/** Deterministic hash input the human confirms; any change invalidates confirmation. */
export function previewHashInput(p: ReleasePreview): string {
  return stable({
    d: p.donationId,
    a: p.recipientAccountId,
    g: p.grossCents,
    t: p.transferAmountCents,
    f: p.stripeFeeCents,
    s: p.sourceChargeId,
  });
}
