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
  adminSaveBeneficiary,
  adminUpdateCampaign,
} from "@/lib/donations.functions";
import { DEFAULT_SETTINGS } from "./rules";

const STORE = "11000000-0000-4000-8000-000000000001";
const OTHER = "11000000-0000-4000-8000-000000000002";
const BENEFICIARY = "22000000-0000-4000-8000-000000000001";
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
  it("imports without approving, activating or replacing an existing reviewed campaign", async () => {
    await adminImportCampaigns({
      data: { storeId: STORE, campaigns: [{ slug: "fixture", title: "Original" }] },
    });
    const [initial] = await H.current!
      .client`SELECT * FROM donation_campaigns WHERE store_id = ${STORE}`;
    expect(initial).toMatchObject({
      title: "Original",
      review_status: "UNREVIEWED",
      active: false,
    });
    await H.current!
      .client`UPDATE donation_campaigns SET review_status='APPROVED', active=true WHERE store_id=${STORE}`;
    await adminImportCampaigns({
      data: { storeId: STORE, campaigns: [{ slug: "fixture", title: "Replacement" }] },
    });
    expect(
      await H.current!.client`SELECT title,review_status,active FROM donation_campaigns`,
    ).toEqual([{ title: "Original", review_status: "APPROVED", active: true }]);
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
      testFallback: false,
      campaigns: [],
      beneficiaries: [],
      donations: [],
    });
    expect(JSON.parse(JSON.stringify(overview))).toEqual(overview);
    expect(JSON.stringify(overview)).not.toMatch(/ciphertext|secret_key|webhook_secret/);
  });
});
