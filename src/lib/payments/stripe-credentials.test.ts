import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ from: vi.fn(), account: vi.fn() }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: mocks.from } }));
vi.mock("./stripe.server", () => ({ StripeService: class { retrieveAccount = mocks.account; } }));
import { encryptSecret } from "./crypto.server";
import { resolveStripeCredentials, resolveStoreStripeCredentials, resolveIntegrationStripeCredentials, type StripeCredentialIntegration } from "./stripe-credentials.server";

const env = { STRIPE_SECRET_KEY: "sk_test_Environment123", STRIPE_WEBHOOK_SECRET: "whsec_Environment123" };
const store = { id: "store", name: "Books", environment: "test" as const, stripe_integration_id: "integration" as string | null };
let integration: StripeCredentialIntegration;
beforeEach(async () => {
  vi.clearAllMocks(); vi.stubEnv("PAYMENTS_ENCRYPTION_KEY", "fixture-encryption-key-at-least-32-characters");
  vi.stubEnv("STRIPE_SECRET_KEY", env.STRIPE_SECRET_KEY); vi.stubEnv("STRIPE_WEBHOOK_SECRET", env.STRIPE_WEBHOOK_SECRET);
  mocks.account.mockResolvedValue({ id: "acct_Books123" });
  integration = { id: "integration", status: "ACTIVE", environment: "test", stripe_account_id: "acct_Books123", secret_key_ciphertext: await encryptSecret("sk_test_Database123"), webhook_secret_ciphertext: await encryptSecret("whsec_Database123") };
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

function queue(...results: Array<{ data?: unknown; error?: unknown }>) {
  mocks.from.mockImplementation(() => {
    const result = { error: null, ...results.shift() };
    const builder: Record<string, unknown> = { then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve) };
    for (const method of ["select", "eq", "is", "maybeSingle", "single", "insert", "upsert", "update"]) builder[method] = vi.fn(() => builder);
    return builder;
  });
}

describe("Stripe credential priority", () => {
  it("prefers a decryptable ACTIVE database integration over environment keys", async () => {
    expect(await resolveStripeCredentials({ integration, environment: "test", env })).toMatchObject({ source: "database", integrationId: "integration", secretKey: "sk_test_Database123", webhookSecret: "whsec_Database123" });
  });
  it("falls back to environment keys when no database integration exists", async () => {
    expect(await resolveStripeCredentials({ integration: null, environment: "test", env })).toMatchObject({ source: "environment", integrationId: null, ...{ secretKey: env.STRIPE_SECRET_KEY, webhookSecret: env.STRIPE_WEBHOOK_SECRET } });
  });
  it.each(["missing secret", "missing webhook", "inactive", "wrong mode", "wrong master key", "malformed ciphertext"])("falls back for %s without overwriting database credentials", async (reason) => {
    const before = { ...integration };
    if (reason === "missing secret") integration.secret_key_ciphertext = null;
    if (reason === "missing webhook") integration.webhook_secret_ciphertext = null;
    if (reason === "inactive") integration.status = "INACTIVE";
    if (reason === "wrong mode") integration.environment = "live";
    if (reason === "wrong master key") vi.stubEnv("PAYMENTS_ENCRYPTION_KEY", "different-encryption-key-at-least-32-characters");
    if (reason === "malformed ciphertext") integration.secret_key_ciphertext = "broken";
    const snapshot = { ...integration };
    expect(await resolveStripeCredentials({ integration, environment: "test", env })).toMatchObject({ source: "environment", integrationId: before.id });
    expect(integration).toEqual(snapshot); expect(mocks.from).not.toHaveBeenCalled();
  });
  it("accepts a restricted test key", async () => {
    expect(await resolveStripeCredentials({ integration: null, environment: "test", env: { ...env, STRIPE_SECRET_KEY: "rk_test_Restricted123" } })).toMatchObject({ source: "environment" });
  });
  it.each([
    {}, { STRIPE_SECRET_KEY: env.STRIPE_SECRET_KEY }, { ...env, STRIPE_SECRET_KEY: "pk_test_Public123" },
    { ...env, STRIPE_SECRET_KEY: "sk_live_Live123" }, { ...env, STRIPE_WEBHOOK_SECRET: "invalid" },
  ])("rejects missing or unsafe environment credentials", async (badEnv) => {
    await expect(resolveStripeCredentials({ integration: null, environment: "test", env: badEnv })).rejects.toMatchObject({ stage: expect.stringMatching(/missing_env|no_stripe_integration/) });
  });
  it("does not contact Stripe or bootstrap when database keys are usable", async () => {
    expect(await resolveStoreStripeCredentials(store, integration)).toMatchObject({ source: "database", integrationId: integration.id });
    expect(mocks.account).not.toHaveBeenCalled(); expect(mocks.from).not.toHaveBeenCalled();
  });
  it("uses environment keys with the existing account and integration binding", async () => {
    expect(await resolveStoreStripeCredentials(store, { ...integration, secret_key_ciphertext: null })).toMatchObject({ source: "environment", integrationId: integration.id });
    expect(mocks.account).toHaveBeenCalledOnce(); expect(mocks.from).not.toHaveBeenCalled();
  });
  it("rejects environment keys for a different persisted account", async () => {
    mocks.account.mockResolvedValue({ id: "acct_Other123" });
    await expect(resolveStoreStripeCredentials(store, { ...integration, secret_key_ciphertext: null })).rejects.toMatchObject({ stage: "no_stripe_integration", operation: "stripe_credentials.account_binding" });
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("rejects an existing unvalidated account rather than guessing its identity", async () => {
    await expect(resolveStoreStripeCredentials(store, { ...integration, stripe_account_id: null, secret_key_ciphertext: null })).rejects.toMatchObject({ stage: "no_stripe_integration" });
    expect(mocks.account).not.toHaveBeenCalled();
  });
  it("reports an integration lookup failure instead of masking it with fallback", async () => {
    queue({ error: { message: "connection refused" } });
    await expect(resolveStoreStripeCredentials(store)).rejects.toMatchObject({ stage: "db_unreachable" });
    expect(mocks.account).not.toHaveBeenCalled();
  });
  it("keeps a retired integration's original webhook secret for paid events", async () => {
    queue({ data: { ...integration, status: "INACTIVE", secret_key_ciphertext: null } });
    expect(await resolveIntegrationStripeCredentials(integration.id, "webhook")).toMatchObject({ source: "database", webhookSecret: "whsec_Database123" });
    expect(mocks.account).not.toHaveBeenCalled(); expect(mocks.from).toHaveBeenCalledOnce();
  });
  it("keeps a retired integration's original secret for payment binding", async () => {
    queue({ data: { ...integration, status: "INACTIVE", webhook_secret_ciphertext: null } });
    expect(await resolveIntegrationStripeCredentials(integration.id, "binding")).toMatchObject({ source: "database", secretKey: "sk_test_Database123" });
    expect(mocks.account).not.toHaveBeenCalled(); expect(mocks.from).toHaveBeenCalledOnce();
  });
  it("allows environment webhook/binding credentials only on the bookstore integration", async () => {
    queue({ data: { ...integration, secret_key_ciphertext: null } }, { data: { id: store.id } });
    expect(await resolveIntegrationStripeCredentials(integration.id)).toMatchObject({ source: "environment", integrationId: integration.id });
    queue({ data: { ...integration, secret_key_ciphertext: null } }, { data: null });
    await expect(resolveIntegrationStripeCredentials(integration.id)).rejects.toMatchObject({ stage: "no_stripe_integration" });
  });
});

function bootstrapDatabase(options: { competingBinding?: string; existingAccount?: string } = {}) {
  let current: string | null = null;
  const rows = new Map<string, Record<string, unknown>>();
  const writes: Array<{ table: string; method: string; patch: Record<string, unknown>; options?: unknown }> = [];
  mocks.from.mockImplementation((table: string) => {
    let method = "select", patch: Record<string, unknown> = {}, upsertOptions: unknown;
    const filters: Record<string, unknown> = {};
    const builder = {
      select: () => builder, maybeSingle: () => builder,
      eq: (key: string, value: unknown) => { filters[key] = value; return builder; },
      is: (key: string, value: unknown) => { filters[key] = value; return builder; },
      upsert: (value: Record<string, unknown>, opts: unknown) => { method = "upsert"; patch = value; upsertOptions = opts; return builder; },
      update: (value: Record<string, unknown>) => { method = "update"; patch = value; return builder; },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve().then(() => {
        if (method === "upsert") {
          writes.push({ table, method, patch, options: upsertOptions });
          if (!rows.has(String(patch["id"]))) rows.set(String(patch["id"]), { ...patch, ...(options.existingAccount ? { stripe_account_id: options.existingAccount } : {}) });
          return { data: null, error: null };
        }
        if (method === "update") {
          writes.push({ table, method, patch });
          if (options.competingBinding) current = options.competingBinding;
          if (filters["stripe_integration_id"] === null && current === null) current = String(patch["stripe_integration_id"]);
          return { data: null, error: null };
        }
        return { data: table === "stores" ? { stripe_integration_id: current, environment: "test" } : rows.get(String(filters["id"])) ?? null, error: null };
      }).then(resolve),
    };
    return builder;
  });
  return { rows, writes, binding: () => current };
}

describe("environment-only integration bootstrap", () => {
  it("creates only non-secret metadata and atomically binds it to the store", async () => {
    const db = bootstrapDatabase();
    const result = await resolveStoreStripeCredentials({ ...store, stripe_integration_id: null }, null);
    expect(result).toMatchObject({ source: "environment", environment: "test" });
    expect(result.integrationId).toMatch(/^[a-f0-9-]{36}$/); expect(db.binding()).toBe(result.integrationId);
    const row = db.rows.get(result.integrationId);
    expect(row).toMatchObject({ status: "ACTIVE", stripe_account_id: "acct_Books123", secret_key_ciphertext: null, webhook_secret_ciphertext: null, publishable_key: "" });
    expect(JSON.stringify(db.writes)).not.toContain(env.STRIPE_SECRET_KEY); expect(JSON.stringify(db.writes)).not.toContain(env.STRIPE_WEBHOOK_SECRET);
    expect(db.writes[0]?.options).toEqual({ onConflict: "id", ignoreDuplicates: true });
  });
  it("concurrent checkouts converge on one integration without overwriting it", async () => {
    const db = bootstrapDatabase();
    const results = await Promise.all([resolveStoreStripeCredentials({ ...store, stripe_integration_id: null }, null), resolveStoreStripeCredentials({ ...store, stripe_integration_id: null }, null)]);
    expect(results[0]?.integrationId).toBe(results[1]?.integrationId); expect(db.rows.size).toBe(1); expect(db.binding()).toBe(results[0]?.integrationId);
    expect(db.writes.filter((w) => w.method === "upsert").every((w) => (w.options as { ignoreDuplicates: boolean }).ignoreDuplicates)).toBe(true);
  });
  it("never replaces an integration saved concurrently by Admin", async () => {
    const db = bootstrapDatabase({ competingBinding: "admin-integration" });
    await expect(resolveStoreStripeCredentials({ ...store, stripe_integration_id: null }, null)).rejects.toMatchObject({ stage: "no_stripe_integration", operation: "stripe_credentials.store_binding" });
    expect(db.binding()).toBe("admin-integration");
  });
  it("does not reassign a bootstrap identity previously bound to another account", async () => {
    const db = bootstrapDatabase({ existingAccount: "acct_Other123" });
    await expect(resolveStoreStripeCredentials({ ...store, stripe_integration_id: null }, null)).rejects.toMatchObject({ stage: "no_stripe_integration" });
    expect(db.binding()).toBeNull(); expect(db.writes.filter((w) => w.method === "update")).toHaveLength(0);
  });
});
