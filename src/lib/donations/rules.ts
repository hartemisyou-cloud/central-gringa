/**
 * Pure donation rules (no I/O) — readiness gates, request validation,
 * fingerprints, webhook matching, session request snapshot and release math.
 * Everything here fails closed: missing configuration means "not ready".
 * Donation status transitions live in the database (donation_apply_event).
 */
import { z } from "zod";

export const DONATION_AMOUNTS_CENTS = [2000, 3000, 5000, 10000, 25000, 50000] as const;
export const DONATION_CURRENCY = "USD" as const;
export const DONATION_STRIPE_API_VERSION = "2026-08-26.dahlia";
export const FEE_POLICY_NGO_COVERS_ALL = "NGO_COVERS_ALL";

/** Genuine, unmodified public Foundation logo. Used only on donation Checkout Sessions. */
export const FOUNDATION_LOGO_URL =
  "https://www.hopehumanfoundation.org/__l5e/assets-v1/48bd9da7-fcfd-4aff-975f-d04afa35f809/hope-human-logo.png";
export const DONATION_BRANDING = {
  display_name: "Hope Human Foundation",
  logo: { type: "url", url: FOUNDATION_LOGO_URL },
  button_color: "#08733D",
  background_color: "#FFFFFF",
  border_style: "rounded",
} as const;

/**
 * Self-serve Connect cross-border payout regions (docs.stripe.com/connect/cross-border-payouts):
 * US, UK, EEA, CA, CH. Anything else needs an explicit Stripe grant recorded by a human.
 */
export const CROSS_BORDER_SELF_SERVE = new Set([
  "US", "GB", "CA", "CH",
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU",
  "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE", "IS", "LI", "NO",
]);

/** Accounts v2 dashboard choices compatible with platform-paid fees and platform-owned losses. */
export const DASHBOARD_CHOICES = ["EXPRESS", "NONE"] as const;
/** Separate charges and transfers: the platform owns negative balances. */
export const LIABILITY_CHOICES = ["PLATFORM"] as const;

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
  /** Countries Stripe explicitly granted outside the self-serve regions. */
  stripe_granted_countries?: string[];
  fee_coverage_policy: string | null;
  dashboard_responsibility: string | null;
  negative_balance_liability: string | null;
  donations_enabled: boolean;
  releases_enabled: boolean;
  ngo_fee_funding_cents: number;
  manual_payout_schedule_confirmed?: boolean;
  max_hold_days?: number | null;
  legal_account_name_confirmed?: boolean;
  onboarding_enabled?: boolean;
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
  stripe_granted_countries: [],
  fee_coverage_policy: null,
  dashboard_responsibility: null,
  negative_balance_liability: null,
  donations_enabled: false,
  releases_enabled: false,
  ngo_fee_funding_cents: 0,
  manual_payout_schedule_confirmed: false,
  max_hold_days: null,
  legal_account_name_confirmed: false,
  onboarding_enabled: false,
  confirmed_by: null,
  confirmed_at: null,
};

export interface IntegrationLike {
  id: string;
  status: string;
  environment: string;
  secret_key_ciphertext: string | null;
  webhook_secret_ciphertext?: string | null;
  stripe_account_id?: string | null;
}

/** Active, signed, identified platform integration — or the reasons it is not. */
export function integrationGaps(i: IntegrationLike | null): string[] {
  if (!i) return ["Stripe integration not connected"];
  const g: string[] = [];
  if (i.status !== "ACTIVE") g.push("Stripe integration not active");
  if (!i.secret_key_ciphertext) g.push("Stripe secret key missing");
  if (!i.webhook_secret_ciphertext) g.push("Stripe webhook signing secret missing");
  if (!i.stripe_account_id) g.push("Platform Stripe account not identified");
  return g;
}

/** Human responsibility / approval gates shared by payment acceptance and release. */
export function responsibilityGaps(c: DonationSettings): string[] {
  const gaps: string[] = [];
  if (!c.platform_country) gaps.push("Platform Stripe account country not set");
  if (!c.stripe_fundraising_approved) gaps.push("Stripe fundraising approval not confirmed");
  if (!c.connect_approved) gaps.push("Stripe Connect approval not confirmed");
  if (!c.usd_settlement_eligible) gaps.push("USD settlement eligibility not confirmed");
  if (c.fee_coverage_policy !== FEE_POLICY_NGO_COVERS_ALL) gaps.push("Fee coverage policy not confirmed");
  if (!c.dashboard_responsibility) gaps.push("Dashboard responsibility not selected");
  else if (!(DASHBOARD_CHOICES as readonly string[]).includes(c.dashboard_responsibility))
    gaps.push("Dashboard choice is incompatible with platform-paid fees and platform-owned losses");
  if (!c.negative_balance_liability) gaps.push("Negative balance liability not selected");
  else if (!(LIABILITY_CHOICES as readonly string[]).includes(c.negative_balance_liability))
    gaps.push("Stripe-owned negative balance liability is incompatible with separate charges and transfers");
  if (!c.manual_payout_schedule_confirmed) gaps.push("Manual payout schedule not confirmed");
  if (!c.max_hold_days) gaps.push("Country hold limit not configured");
  if (!c.legal_account_name_confirmed) gaps.push("Legal Stripe account name (shown on receipts and terms) not confirmed");
  if (!c.confirmed_by || !c.confirmed_at) gaps.push("Human confirmation of financial responsibilities missing");
  return gaps;
}

/** Gaps that block accepting donations. Empty list = ready. */
export function settingsGaps(s: DonationSettings | null, integration: boolean | string[]): string[] {
  const c = s ?? DEFAULT_SETTINGS;
  const gaps: string[] = [];
  if (!c.recipient_name.trim()) gaps.push("Recipient name missing");
  if (!c.recipient_country.trim()) gaps.push("Recipient country missing");
  if (!c.use_of_funds.trim()) gaps.push("Use of funds not described");
  gaps.push(...responsibilityGaps(c));
  if (integration === false) gaps.push("Stripe integration not active");
  if (Array.isArray(integration)) gaps.push(...integration);
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
  store_id?: string;
  display_name: string;
  country: string;
  stripe_account_id: string | null;
  service_agreement: string | null;
  review_status: string;
}

/** Result of a live provider read of the connected account (never operator-typed). */
export interface RecipientVerification {
  accountId: string;
  country: string | null;
  transfersStatus: string | null;
  recipientConfigured: boolean;
  error?: string;
}

export function recipientCountryAllowed(country: string, c: DonationSettings): string | null {
  if (!c.allowed_recipient_countries.includes(country)) return "Recipient country not enabled";
  if (!c.platform_country) return "Platform Stripe account country not set";
  if (country === c.platform_country) return null;
  const granted = (c.stripe_granted_countries ?? []).includes(country);
  const selfServe = CROSS_BORDER_SELF_SERVE.has(c.platform_country) && CROSS_BORDER_SELF_SERVE.has(country);
  if (!selfServe && !granted) return "Cross-border payouts to this country are not supported or granted by Stripe";
  return null;
}

export function beneficiaryGaps(b: BeneficiaryLike | null, s: DonationSettings | null, storeId?: string): string[] {
  const c = s ?? DEFAULT_SETTINGS;
  if (!b) return ["No beneficiary mapped"];
  const gaps: string[] = [];
  if (storeId && b.store_id !== storeId) gaps.push("Beneficiary belongs to another store");
  if (b.review_status !== "APPROVED") gaps.push("Beneficiary not reviewed");
  if (!b.stripe_account_id) gaps.push("Beneficiary has no connected account");
  const countryGap = recipientCountryAllowed(b.country, c);
  if (countryGap) gaps.push(countryGap);
  const crossBorder = c.platform_country !== null && b.country !== c.platform_country;
  if (crossBorder && b.service_agreement !== "full") {
    // Stripe: cross-border payouts cannot go to accounts under the recipient service agreement.
    gaps.push("Cross-border recipients must be under the full service agreement");
  }
  return gaps;
}

export function verificationGaps(b: BeneficiaryLike | null, v: RecipientVerification | null): string[] {
  if (!b?.stripe_account_id) return [];
  if (!v) return ["Recipient account not verified with Stripe"];
  if (v.error) return [`Recipient account could not be verified: ${v.error}`];
  const g: string[] = [];
  if (v.accountId !== b.stripe_account_id) g.push("Stripe returned a different account");
  if (!v.recipientConfigured) g.push("Account has no recipient configuration on this platform");
  if (v.transfersStatus !== "active") g.push(`Stripe transfers capability is ${v.transfersStatus ?? "unknown"}`);
  if (!v.country || v.country !== b.country) g.push("Stripe account country differs from the registry");
  return g;
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

/** Gaps for starting Stripe-hosted onboarding of an existing connected account. */
export function onboardingGaps(s: DonationSettings | null, b: BeneficiaryLike | null): string[] {
  const c = s ?? DEFAULT_SETTINGS;
  const g: string[] = [];
  if (!c.onboarding_enabled) g.push("Recipient onboarding switch is off");
  if (!c.connect_approved) g.push("Stripe Connect approval not confirmed");
  if (!c.stripe_fundraising_approved) g.push("Stripe fundraising approval not confirmed");
  if (!c.dashboard_responsibility || !(DASHBOARD_CHOICES as readonly string[]).includes(c.dashboard_responsibility))
    g.push("Compatible dashboard choice not confirmed");
  if (c.negative_balance_liability !== "PLATFORM") g.push("Platform negative balance liability not accepted");
  if (!c.confirmed_by) g.push("Human confirmation of financial responsibilities missing");
  if (!b) g.push("No beneficiary selected");
  else {
    if (!b.stripe_account_id) g.push("No existing connected account (account creation is not authorized in this build)");
    const cg = recipientCountryAllowed(b.country, c);
    if (cg) g.push(cg);
  }
  return g;
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

export function stable(value: unknown): string {
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

/** Deterministic 8-letter suffix: the same donation always yields the same identifier. */
export function lettersFromHex(hex: string, n = 8): string {
  const a = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let out = "";
  for (let i = 0; i < n; i++) out += a[parseInt(hex.slice(i * 2, i * 2 + 2), 16) % 26];
  return out;
}

/**
 * Immutable Checkout Session request, persisted before the remote call so every
 * retry sends identical parameters under the same idempotency key.
 */
export function buildSessionRequest(i: {
  donationId: string;
  donationNumber: string;
  storeId: string;
  integrationId: string;
  publicToken: string;
  amountCents: number;
  donorEmail: string | null;
  origin: string;
  campaign: { slug: string; title: string };
  recipientName: string;
  adaptivePricing: boolean;
  integrationIdentifier: string;
}) {
  const metadata = {
    purpose: "donation",
    donation_id: i.donationId,
    donation_number: i.donationNumber,
    store_id: i.storeId,
    integration_id: i.integrationId,
    campaign_slug: i.campaign.slug,
    campaign_title: i.campaign.title.slice(0, 450),
    recipient: i.recipientName,
    base_amount_cents: String(i.amountCents),
    base_currency: "USD",
  };
  const receipt = `${i.origin}/donations/receipt/${i.publicToken}`;
  return {
    mode: "payment",
    submit_type: "donate",
    client_reference_id: i.donationId,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: i.amountCents,
          product_data: {
            name: formatDonationName(i.amountCents),
            description: `Donation to ${i.recipientName} — ${i.campaign.title}`.slice(0, 500),
            images: [FOUNDATION_LOGO_URL],
          },
        },
      },
    ],
    success_url: receipt,
    cancel_url: receipt,
    metadata,
    payment_intent_data: { description: `Donation ${i.donationNumber} to ${i.recipientName}`, metadata },
    adaptive_pricing: { enabled: i.adaptivePricing },
    branding_settings: DONATION_BRANDING,
    integration_identifier: i.integrationIdentifier,
    ...(i.donorEmail ? { customer_email: i.donorEmail } : {}),
  };
}

/** Validates the Session Stripe returned before anything is persisted. */
export function sessionResponseGaps(
  s: Record<string, unknown> | null | undefined,
  d: { id: string; amount_cents: number; livemode: boolean },
): string[] {
  if (!s) return ["empty response"];
  const g: string[] = [];
  if (typeof s["id"] !== "string" || !String(s["id"]).startsWith("cs_")) g.push("session id");
  if (typeof s["url"] !== "string" || !String(s["url"]).startsWith("https://checkout.stripe.com/")) g.push("session url");
  if ("livemode" in s && Boolean(s["livemode"]) !== d.livemode) g.push("livemode");
  if ("amount_total" in s && s["amount_total"] !== d.amount_cents) g.push("amount");
  if ("currency" in s && String(s["currency"]).toLowerCase() !== "usd") g.push("currency");
  if ("client_reference_id" in s && s["client_reference_id"] !== d.id) g.push("client_reference_id");
  const md = s["metadata"] as Record<string, string> | undefined;
  if (md && md["donation_id"] !== undefined && md["donation_id"] !== d.id) g.push("metadata donation_id");
  return g;
}

// ---------- Status ----------

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
  | "REFUND"
  | "DISPUTE";

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

export type ReleaseState = "NONE" | "IN_FLIGHT" | "SUCCEEDED" | "FAILED";

export interface ReleaseInputs {
  donation: {
    id: string;
    status: string;
    amount_cents: number;
    currency: string;
    refunded_cents: number;
    disputed: boolean;
    charge_id: string | null;
    paid_at?: string | null;
    payment_confirmed?: boolean;
    beneficiary_snapshot: { account_id?: string; display_name?: string; country?: string } | null;
  };
  beneficiary: BeneficiaryLike | null;
  settings: DonationSettings | null;
  /** Live Stripe read of the recipient account. */
  verification: RecipientVerification | null;
  /** Gaps of the donation's ORIGINAL integration (not the store's current one). */
  integrationGaps: string[];
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
  /** Platform available balance in USD (cents) right now, in the original platform account. */
  availableUsdCents: number;
  /** Still-held principal of OTHER donations in the same platform account/environment (all stores). */
  otherHeldObligationsCents: number;
  /** Fee coverage reserved or consumed by releases in the same platform account/environment. */
  feeCoverageUsedCents: number;
  releaseState: ReleaseState;
  now?: number;
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
  otherHeldObligationsCents: number;
  freeBalanceCents: number;
  fundingDeficitCents: number;
  sourceChargeId: string | null;
  releaseState: ReleaseState;
  blockers: string[];
  allowed: boolean;
}

export function computeReleasePreview(i: ReleaseInputs): ReleasePreview {
  const s = i.settings ?? DEFAULT_SETTINGS;
  const d = i.donation;
  const snap = d.beneficiary_snapshot;
  const blockers: string[] = [];
  if (i.releaseState === "SUCCEEDED") blockers.push("A transfer already exists for this donation");
  if (i.releaseState === "IN_FLIGHT") blockers.push("A release is already in progress — resume it (no new transfer is created)");
  if (d.status !== "PAID" || d.payment_confirmed === false) blockers.push(`Donation status is ${d.status}, not PAID`);
  if (d.refunded_cents > 0) blockers.push("Donation has refunds");
  if (d.disputed) blockers.push("Donation is disputed");
  if (d.currency !== "USD") blockers.push("Only USD donations can be released");
  if (!s.releases_enabled) blockers.push("Releases switch is off");
  blockers.push(...responsibilityGaps(s));
  blockers.push(...i.integrationGaps);
  if (s.max_hold_days && d.paid_at) {
    const now = i.now ?? Date.now();
    if (now - Date.parse(d.paid_at) > s.max_hold_days * 86400000) {
      blockers.push("Hold limit exceeded: reconciliation needed before any release");
    }
  }
  if (!snap?.account_id) blockers.push("Donation has no beneficiary snapshot");
  if (!i.beneficiary || i.beneficiary.stripe_account_id !== snap?.account_id) {
    blockers.push("Beneficiary account does not match the donation snapshot");
  }
  blockers.push(...beneficiaryGaps(i.beneficiary, i.settings));
  blockers.push(...verificationGaps(i.beneficiary, i.verification));

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
  // Full gross leaves; every other held donation's principal must stay untouched.
  const freeBalance = i.availableUsdCents - i.otherHeldObligationsCents - gross;
  const deficit = Math.max(0, fee - dedicatedRemaining, -freeBalance);
  if (deficit > 0) blockers.push(`NGO fee funding deficit of ${deficit} cents`);
  if (gross > (c?.amount ?? 0)) blockers.push("Transfer would exceed source charge");

  const unique = [...new Set(blockers)];
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
    ngoCoverageRequiredCents: fee,
    dedicatedFundingRemainingCents: dedicatedRemaining,
    otherHeldObligationsCents: i.otherHeldObligationsCents,
    freeBalanceCents: freeBalance,
    fundingDeficitCents: deficit,
    sourceChargeId: c?.id ?? null,
    releaseState: i.releaseState,
    blockers: unique,
    allowed: unique.length === 0,
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

/** Zero-decimal and three-decimal currencies per Stripe's currency docs. */
const ZERO_DECIMAL = new Set(["BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF"]);
const THREE_DECIMAL = new Set(["BHD", "JOD", "KWD", "OMR", "TND"]);
export function currencyExponent(currency: string): number {
  const c = currency.toUpperCase();
  return ZERO_DECIMAL.has(c) ? 0 : THREE_DECIMAL.has(c) ? 3 : 2;
}
export function formatMinorUnits(amount: number, currency: string, locale = "en-US"): string {
  const exp = currencyExponent(currency);
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: exp,
    maximumFractionDigits: exp,
  }).format(amount / 10 ** exp);
}
