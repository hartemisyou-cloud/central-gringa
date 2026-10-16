import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { makeTestDb } from "./test-db";

const H = vi.hoisted(() => ({
  current: null as Awaited<ReturnType<typeof makeTestDb>> | null,
  authorized: true,
}));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validate = (value: unknown) => value;
    const builder = {
      inputValidator(fn: typeof validate) {
        validate = fn;
        return builder;
      },
      handler(fn: (input: { data: unknown }) => unknown) {
        return (input: { data?: unknown } = {}) => fn({ data: validate(input.data) });
      },
    };
    return builder;
  },
}));
vi.mock("@/lib/admin/session.server", () => ({
  requireAdmin: async () => {
    if (!H.authorized) throw new Error("Unauthorized");
  },
}));
vi.mock("@/lib/db/client.server", async (original) => {
  const actual = await original<typeof import("@/lib/db/client.server")>();
  return {
    ...actual,
    sql: new Proxy(
      function (...args: unknown[]) {
        return (H.current!.client as unknown as (...args: unknown[]) => unknown)(...args);
      },
      {
        get(_target, key) {
          const value = Reflect.get(H.current!.client, key);
          return typeof value === "function" ? value.bind(H.current!.client) : value;
        },
      },
    ),
  };
});

import {
  adminDonationOverview,
  adminImportCampaigns,
  adminSaveDonationSettings,
  adminSaveDonationCollection,
  adminSaveBeneficiary,
  adminUpdateCampaign,
} from "@/lib/donations.functions";
import { DEFAULT_SETTINGS } from "./rules";

const STORE = "11000000-0000-4000-8000-000000000001";
const OTHER = "11000000-0000-4000-8000-000000000002";
const BENEFICIARY = "22000000-0000-4000-8000-000000000001";
const INTEGRATION = "33000000-0000-4000-8000-000000000001";
beforeAll(async () => {
  H.current = await makeTestDb();
});
afterAll(async () => {
  await H.current?.close();
});
beforeEach(async () => {
  H.authorized = true;
  await H.current!.pg.exec("TRUNCATE stores CASCADE; TRUNCATE stripe_integrations CASCADE;");
  await H.current!
    .client`INSERT INTO stores (id,slug) VALUES (${STORE},'hope-human-books'),(${OTHER},'other')`;
});

describe("PostgreSQL donation administration", () => {
  it("activates authenticated new imports without approval and preserves existing pauses and reviews", async () => {
    await adminImportCampaigns({
      data: { storeId: STORE, campaigns: [{ slug: "fixture", title: "Original" }] },
    });
    const [initial] = await H.current!
      .client`SELECT * FROM donation_campaigns WHERE store_id = ${STORE}`;
    expect(initial).toMatchObject({
      title: "Original",
      review_status: "UNREVIEWED",
      active: true,
    });
    await H.current!
      .client`UPDATE donation_campaigns SET review_status='APPROVED', active=false WHERE store_id=${STORE}`;
    await adminImportCampaigns({
      data: { storeId: STORE, campaigns: [{ slug: "fixture", title: "Replacement" }] },
    });
    expect(
      await H.current!.client`SELECT title,review_status,active FROM donation_campaigns`,
    ).toEqual([{ title: "Original", review_status: "APPROVED", active: false }]);
  });

  it("saves the collection switch without a human signature or enabling deferred financial gates", async () => {
    expect(await adminSaveDonationCollection({ data: { storeId: STORE, enabled: true } })).toEqual({ ok: true });
    const [row] = await H.current!.client`SELECT donations_enabled, confirmed_by, confirmed_at,
      stripe_fundraising_approved, connect_approved, legal_account_name_confirmed,
      releases_enabled, onboarding_enabled FROM donation_settings WHERE store_id=${STORE}`;
    expect(row).toEqual({
      donations_enabled: true,
      confirmed_by: null,
      confirmed_at: null,
      stripe_fundraising_approved: false,
      connect_approved: false,
      legal_account_name_confirmed: false,
      releases_enabled: false,
      onboarding_enabled: false,
    });
  });

  it("changes only collection state while preserving historical settings and confirmations", async () => {
    await H.current!.client`INSERT INTO donation_settings
      (store_id, recipient_name, use_of_funds, allowed_recipient_countries,
        adaptive_pricing_eligible, adaptive_pricing_enabled, ngo_fee_funding_cents,
        confirmed_by, confirmed_at, donations_enabled)
      VALUES (${STORE}, 'Historical recipient', 'Historical purpose', ARRAY['US','GB'],
        true, true, 1234, 'Historical reviewer', '2026-01-01T00:00:00Z', false)`;
    const [before] = await H.current!.client`SELECT * FROM donation_settings WHERE store_id=${STORE}`;
    for (const enabled of [true, false]) {
      expect(await adminSaveDonationCollection({ data: { storeId: STORE, enabled } })).toEqual({ ok: true });
      const [after] = await H.current!.client`SELECT * FROM donation_settings WHERE store_id=${STORE}`;
      const { updated_at: _beforeUpdated, donations_enabled: _beforeEnabled, ...historicalBefore } = before!;
      const { updated_at: _afterUpdated, donations_enabled: actualEnabled, ...historicalAfter } = after!;
      expect(actualEnabled).toBe(enabled);
      expect(historicalAfter).toEqual(historicalBefore);
    }
  });

  it("rejects hidden deferred settings, unknown stores and unauthorized switch writes", async () => {
    const unsupportedSettings = { storeId: STORE, enabled: true, releases_enabled: true };
    expect(() => adminSaveDonationCollection({ data: unsupportedSettings })).toThrow();
    expect(await adminSaveDonationCollection({ data: { storeId: BENEFICIARY, enabled: true } })).toEqual({ ok: false, message: "Store not found." });
    H.authorized = false;
    await expect(adminSaveDonationCollection({ data: { storeId: STORE, enabled: true } })).rejects.toThrow("Unauthorized");
    expect(await H.current!.client`SELECT id FROM donation_settings`).toHaveLength(0);
  });

  it("reports active unreviewed campaigns ready and keeps an explicit collection pause", async () => {
    await H.current!.client`INSERT INTO stripe_integrations VALUES (${INTEGRATION},'ACTIVE','test','fixture-key','fixture-webhook','acct_fixture')`;
    await H.current!.client`UPDATE stores SET stripe_integration_id=${INTEGRATION} WHERE id=${STORE}`;
    await adminImportCampaigns({ data: { storeId: STORE, campaigns: [{ slug: "unreviewed", title: "Known campaign" }] } });
    const overview = await adminDonationOverview();
    expect(overview).toMatchObject({ collectionEnabled: true, environment: "TEST", collectionGaps: [], settings: null });
    expect(overview?.campaigns).toEqual([expect.objectContaining({ review_status: "UNREVIEWED", active: true, reviewed_by: null, gaps: [] })]);
    await adminSaveDonationCollection({ data: { storeId: STORE, enabled: false } });
    expect(await adminDonationOverview()).toMatchObject({ collectionEnabled: false, collectionGaps: ["Donations switch is off"] });
    await adminSaveDonationCollection({ data: { storeId: STORE, enabled: true } });
    expect(await adminDonationOverview()).toMatchObject({ collectionEnabled: true, collectionGaps: [] });
  });

  it("requires named confirmation and preserves explicit country arrays and OFF gates", async () => {
    const input = {
      storeId: STORE,
      ...DEFAULT_SETTINGS,
      donations_enabled: true,
      allowed_recipient_countries: ["us", "br"],
      stripe_granted_countries: ["us"],
    };
    expect(await adminSaveDonationSettings({ data: input })).toMatchObject({ ok: false });
    expect(await H.current!.client`SELECT id FROM donation_settings`).toHaveLength(0);
    expect(
      await adminSaveDonationSettings({ data: { ...input, confirmedBy: "Fixture Reviewer" } }),
    ).toEqual({ ok: true });
    const [row] = await H.current!
      .client`SELECT allowed_recipient_countries,stripe_granted_countries,releases_enabled,onboarding_enabled,confirmed_by FROM donation_settings`;
    expect(row).toMatchObject({
      allowed_recipient_countries: ["US", "BR"],
      stripe_granted_countries: ["US"],
      releases_enabled: false,
      onboarding_enabled: false,
      confirmed_by: "Fixture Reviewer",
    });
  });

  it("enforces beneficiary store isolation and campaign review confirmation", async () => {
    await H.current!
      .client`INSERT INTO donation_beneficiaries (id,store_id,display_name,country) VALUES (${BENEFICIARY},${OTHER},'Other beneficiary','US')`;
    await adminImportCampaigns({
      data: { storeId: STORE, campaigns: [{ slug: "fixture", title: "Fixture" }] },
    });
    const [campaign] = await H.current!
      .client`SELECT id FROM donation_campaigns WHERE store_id=${STORE}`;
    const patch = {
      id: campaign!["id"] as string,
      review_status: "APPROVED" as const,
      active: true,
      ends_at: null,
      release_mode: "MANUAL" as const,
      beneficiary_id: BENEFICIARY,
    };
    expect(await adminUpdateCampaign({ data: patch })).toMatchObject({ ok: false });
    expect(
      await adminUpdateCampaign({ data: { ...patch, reviewedBy: "Fixture Reviewer" } }),
    ).toMatchObject({ ok: false, message: "Beneficiary does not belong to this store." });
    expect(
      await adminUpdateCampaign({
        data: { ...patch, beneficiary_id: null, reviewedBy: "Fixture Reviewer" },
      }),
    ).toEqual({ ok: true });
    await adminSaveBeneficiary({
      data: {
        id: BENEFICIARY,
        storeId: STORE,
        display_name: "Unauthorized replacement",
        country: "US",
        stripe_account_id: null,
        service_agreement: null,
        review_status: "UNREVIEWED",
      },
    });
    expect(
      await H.current!
        .client`SELECT display_name FROM donation_beneficiaries WHERE id=${BENEFICIARY}`,
    ).toEqual([{ display_name: "Other beneficiary" }]);
  });

  it("blocks beneficiary remapping while donations are held or their count is unavailable", async () => {
    await H.current!
      .client`INSERT INTO donation_beneficiaries (id,store_id,display_name,country) VALUES (${BENEFICIARY},${STORE},'Own beneficiary','US')`;
    await adminImportCampaigns({
      data: { storeId: STORE, campaigns: [{ slug: "fixture", title: "Fixture" }] },
    });
    const [campaign] = await H.current!
      .client`SELECT id FROM donation_campaigns WHERE store_id=${STORE}`;
    const id = campaign!["id"] as string;
    await H.current!
      .client`INSERT INTO donations (store_id,campaign_id,donation_number,public_token,amount_cents,idempotency_key,request_fingerprint) VALUES (${STORE},${id},'FIXTURE-DONATION','fixture-donation-token',2000,'fixture-key','fixture-fingerprint')`;
    const data = {
      id,
      review_status: "UNREVIEWED" as const,
      active: false,
      ends_at: null,
      release_mode: "MANUAL" as const,
      beneficiary_id: BENEFICIARY,
    };
    expect(await adminUpdateCampaign({ data })).toMatchObject({
      ok: false,
      message: "Campaign has held donations; the beneficiary mapping cannot change.",
    });
    await H.current!.client`ALTER TABLE donations RENAME TO donations_temporarily_unavailable`;
    try {
      expect(await adminUpdateCampaign({ data })).toMatchObject({
        ok: false,
        message: "Could not verify held donations.",
      });
    } finally {
      await H.current!.client`ALTER TABLE donations_temporarily_unavailable RENAME TO donations`;
    }
    expect(
      await H.current!.client`SELECT beneficiary_id FROM donation_campaigns WHERE id=${id}`,
    ).toEqual([{ beneficiary_id: null }]);
  });

  it("keeps admin authorization before any SQL and the overview serializable", async () => {
    H.authorized = false;
    await expect(
      adminImportCampaigns({
        data: { storeId: STORE, campaigns: [{ slug: "blocked", title: "Blocked" }] },
      }),
    ).rejects.toThrow("Unauthorized");
    expect(await H.current!.client`SELECT id FROM donation_campaigns`).toHaveLength(0);
    H.authorized = true;
    const overview = await adminDonationOverview();
    expect(overview).toMatchObject({
      storeId: STORE,
      settings: null,
      collectionEnabled: false,
      environment: "TEST",
      testFallback: false,
      campaigns: [],
      beneficiaries: [],
      donations: [],
    });
    expect(JSON.parse(JSON.stringify(overview))).toEqual(overview);
    expect(JSON.stringify(overview)).not.toMatch(/ciphertext|secret_key|webhook_secret/);
  });
});
