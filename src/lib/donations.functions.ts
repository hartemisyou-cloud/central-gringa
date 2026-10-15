import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/** Public receipt read by token. Status always comes from the database, never the URL. */
export const getDonationReceipt = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ token: z.string().min(20).max(80) }).parse(d))
  .handler(async ({ data }) => {
    const { donationByToken, receiptView } = await import("./donations/service.server");
    const { getRequest } = await import("@tanstack/react-start/server");
    const d = await donationByToken(data.token);
    if (!d) return null;
    return receiptView(d, new URL(getRequest().url).origin);
  });

async function admin() {
  const { requireAdmin } = await import("./admin/session.server");
  await requireAdmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { supabaseAdmin } = (await import("@/integrations/supabase/client.server")) as any;
  return supabaseAdmin;
}

export const adminDonationOverview = createServerFn({ method: "GET" }).handler(async () => {
  const db = await admin();
  const { settingsGaps, campaignGaps } = await import("./donations/rules");
  const { data: store } = await db.from("stores").select("*").eq("slug", "hope-human-books").maybeSingle();
  if (!store) return null;
  const [{ data: settings }, { data: integration }, { data: campaigns }, { data: beneficiaries }, { data: donations }] =
    await Promise.all([
      db.from("donation_settings").select("*").eq("store_id", store.id).maybeSingle(),
      store.stripe_integration_id
        ? db.from("stripe_integrations").select("status").eq("id", store.stripe_integration_id).maybeSingle()
        : Promise.resolve({ data: null }),
      db.from("donation_campaigns").select("*").eq("store_id", store.id).order("slug"),
      db.from("donation_beneficiaries").select("*").eq("store_id", store.id).order("display_name"),
      db.from("donations").select("id, donation_number, status, amount_cents, created_at, campaign_id").eq("store_id", store.id).order("created_at", { ascending: false }).limit(50),
    ]);
  const benById = new Map((beneficiaries ?? []).map((b: { id: string }) => [b.id, b]));
  return {
    storeId: store.id as string,
    settings,
    gaps: settingsGaps(settings, integration?.status === "ACTIVE"),
    campaigns: (campaigns ?? []).map((c: Record<string, unknown>) => ({
      ...c,
      gaps: campaignGaps(c as never, (benById.get(c.beneficiary_id as string) as never) ?? null, settings),
    })),
    beneficiaries: beneficiaries ?? [],
    donations: donations ?? [],
  };
});

const settingsSchema = z.object({
  storeId: z.string().uuid(),
  recipient_name: z.string().trim().min(1).max(120),
  recipient_country: z.string().trim().length(2),
  use_of_funds: z.string().trim().max(1000),
  platform_country: z.string().trim().length(2).nullable(),
  stripe_fundraising_approved: z.boolean(),
  connect_approved: z.boolean(),
  usd_settlement_eligible: z.boolean(),
  adaptive_pricing_eligible: z.boolean(),
  adaptive_pricing_enabled: z.boolean(),
  allowed_recipient_countries: z.array(z.string().trim().length(2)).max(60),
  recipient_service_agreement_allowed: z.boolean(),
  fee_coverage_policy: z.enum(["NGO_COVERS_ALL"]).nullable(),
  dashboard_responsibility: z.enum(["PLATFORM", "STRIPE"]).nullable(),
  negative_balance_liability: z.enum(["PLATFORM", "STRIPE"]).nullable(),
  donations_enabled: z.boolean(),
  releases_enabled: z.boolean(),
  ngo_fee_funding_cents: z.number().int().min(0).max(100_000_000),
  /** Typed name of the human confirming these financial responsibilities. */
  confirmedBy: z.string().trim().max(120).optional(),
});

export const adminSaveDonationSettings = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => settingsSchema.parse(d))
  .handler(async ({ data }) => {
    const db = await admin();
    const { storeId, confirmedBy, ...rest } = data;
    const needsConfirm = rest.donations_enabled || rest.releases_enabled || rest.fee_coverage_policy || rest.dashboard_responsibility || rest.negative_balance_liability;
    if (needsConfirm && !confirmedBy) {
      return { ok: false as const, message: "Type your full name to confirm financial responsibilities." };
    }
    const row = {
      store_id: storeId,
      ...rest,
      allowed_recipient_countries: rest.allowed_recipient_countries.map((c) => c.toUpperCase()),
      recipient_country: rest.recipient_country.toUpperCase(),
      platform_country: rest.platform_country?.toUpperCase() ?? null,
      confirmed_by: confirmedBy || null,
      confirmed_at: confirmedBy ? new Date().toISOString() : null,
    };
    const { error } = await db.from("donation_settings").upsert(row, { onConflict: "store_id" });
    if (error) return { ok: false as const, message: "Could not save donation settings." };
    return { ok: true as const };
  });

export const adminImportCampaigns = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      storeId: z.string().uuid(),
      campaigns: z.array(z.object({ slug: z.string().regex(/^[a-z0-9-]{1,120}$/), title: z.string().trim().min(1).max(200) })).min(1).max(200),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const db = await admin();
    // Import never approves: new rows stay UNREVIEWED and inactive. Existing rows keep their review state.
    const rows = data.campaigns.map((c) => ({ store_id: data.storeId, slug: c.slug, title: c.title }));
    const { error } = await db.from("donation_campaigns").upsert(rows, { onConflict: "store_id,slug", ignoreDuplicates: true });
    return error ? { ok: false as const, message: "Import failed." } : { ok: true as const, count: rows.length };
  });

export const adminUpdateCampaign = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      id: z.string().uuid(),
      review_status: z.enum(["UNREVIEWED", "IN_REVIEW", "APPROVED", "REJECTED"]),
      active: z.boolean(),
      ends_at: z.string().datetime().nullable(),
      release_mode: z.enum(["MANUAL", "CAMPAIGN_END"]),
      beneficiary_id: z.string().uuid().nullable(),
      reviewedBy: z.string().trim().max(120).optional(),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const db = await admin();
    const { id, reviewedBy, ...patch } = data;
    if (patch.review_status === "APPROVED" && !reviewedBy) {
      return { ok: false as const, message: "Type your name to record the campaign review." };
    }
    const { data: current } = await db.from("donation_campaigns").select("beneficiary_id").eq("id", id).maybeSingle();
    if (current && current.beneficiary_id !== patch.beneficiary_id) {
      // Existing donations keep their immutable snapshot; we only warn via count.
      const { count } = await db.from("donations").select("id", { count: "exact", head: true }).eq("campaign_id", id).in("status", ["PAID", "PROCESSING", "PENDING"]);
      if ((count ?? 0) > 0) {
        return { ok: false as const, message: "Campaign has held donations; the beneficiary mapping cannot change." };
      }
    }
    const { error } = await db.from("donation_campaigns").update({
      ...patch,
      ...(patch.review_status === "APPROVED" ? { reviewed_by: reviewedBy, reviewed_at: new Date().toISOString() } : {}),
    }).eq("id", id);
    return error ? { ok: false as const, message: "Update failed." } : { ok: true as const };
  });

export const adminSaveBeneficiary = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      id: z.string().uuid().optional(),
      storeId: z.string().uuid(),
      display_name: z.string().trim().min(1).max(160),
      country: z.string().trim().length(2),
      stripe_account_id: z.string().regex(/^acct_[A-Za-z0-9]+$/).nullable(),
      onboarding_status: z.enum(["NOT_STARTED", "PENDING", "COMPLETE"]),
      transfers_capability: z.enum(["inactive", "pending", "active"]),
      service_agreement: z.enum(["full", "recipient"]).nullable(),
      review_status: z.enum(["UNREVIEWED", "APPROVED", "REJECTED"]),
      reviewedBy: z.string().trim().max(120).optional(),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const db = await admin();
    const { id, storeId, reviewedBy, ...rest } = data;
    if (rest.review_status === "APPROVED" && !reviewedBy) {
      return { ok: false as const, message: "Type your name to record the beneficiary review." };
    }
    const row = {
      store_id: storeId,
      ...rest,
      country: rest.country.toUpperCase(),
      ...(rest.review_status === "APPROVED" ? { reviewed_by: reviewedBy, reviewed_at: new Date().toISOString() } : {}),
    };
    const { error } = id
      ? await db.from("donation_beneficiaries").update(row).eq("id", id)
      : await db.from("donation_beneficiaries").insert(row);
    return error ? { ok: false as const, message: "Save failed." } : { ok: true as const };
  });

export const adminReleasePreview = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ donationId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    await admin();
    const { buildReleasePreview, previewHash } = await import("./donations/service.server");
    try {
      const preview = await buildReleasePreview(data.donationId);
      return { ok: true as const, preview, hash: await previewHash(preview) };
    } catch (e) {
      return { ok: false as const, message: (e as Error).message };
    }
  });

export const adminExecuteRelease = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      donationId: z.string().uuid(),
      previewHash: z.string().length(64),
      maxAmountCents: z.number().int().positive(),
      confirmedBy: z.string().trim().min(3).max(120),
      confirmText: z.literal("RELEASE FULL DONATION"),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    await admin();
    const { executeRelease } = await import("./donations/service.server");
    try {
      return { ok: true as const, ...(await executeRelease(data)) };
    } catch (e) {
      const details = (e as { details?: unknown }).details;
      return { ok: false as const, message: (e as Error).message, details: details ?? null };
    }
  });
