import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { createTestClient } from "@/lib/db/test-client";
import { HHB_PRODUCTS, HHB_STORE_ID, HHB_WORKS } from "@/lib/catalog/hhb";
import { encryptSecret } from "./crypto.server";
import { PaymentError } from "./errors";
import { CheckoutFailure, classifyCheckoutFailure, logCheckoutFailure, safeCheckoutError } from "./checkout-log.server";

const H = vi.hoisted(() => ({ current: null as Awaited<ReturnType<typeof createTestClient>> | null, queries: 0, get: vi.fn(), admin: vi.fn(), fetch: vi.fn(), cancel: vi.fn() }));
vi.mock("@/lib/db/client.server", async original => {
  const actual = await original<typeof import("@/lib/db/client.server")>();
  return { ...actual, sql: new Proxy(function (...args: unknown[]) {
    H.queries += 1;
    return (H.current!.client as unknown as (...args: unknown[]) => unknown)(...args);
  }, { get(_target, key) { const value = Reflect.get(H.current!.client, key); return typeof value === "function" ? value.bind(H.current!.client) : value; } }) };
});
vi.mock("@vercel/blob", () => ({ get: H.get }));
vi.mock("@/lib/admin/session.server", () => ({ requireAdmin: H.admin }));
import { CHECKOUT_ENV_NAMES, checkoutHealthResponse } from "./checkout-health.server";

const INTEGRATION = "c1000000-0000-4000-8000-000000000001";
beforeAll(async () => {
  H.current = await createTestClient();
  await H.current.db.exec(await readFile(new URL("../db/test-schema.sql", import.meta.url), "utf8"));
});
afterAll(async () => { await H.current?.close(); });
beforeEach(async () => {
  vi.clearAllMocks();
  H.queries = 0;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  for (const name of CHECKOUT_ENV_NAMES) vi.stubEnv(name, "");
  vi.stubEnv("DATABASE_URL", "postgres://runtime@localhost/health-test");
  vi.stubEnv("PAYMENTS_ENCRYPTION_KEY", "mock-master-key-for-checkout-health-32-chars");
  vi.stubEnv("BLOB_STORE_ID", "mockStoreId");
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_Unused");
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_Unused");
  H.admin.mockResolvedValue(undefined);
  H.get.mockImplementation(async () => ({ statusCode: 200, stream: new ReadableStream({ cancel: H.cancel }) }));
  H.fetch.mockImplementation(async (_url: string, init: RequestInit) => {
    const form = new URLSearchParams(String(init.body));
    const metadata = Object.fromEntries([...form.entries()].filter(([key]) => /^metadata\[/.test(key)).map(([key, value]) => [key.slice(9, -1), value]));
    return Response.json({ id: "cs_test_Fixture123", status: "open", livemode: false, metadata, amount_total: Number(form.get("line_items[0][price_data][unit_amount]")), currency: "usd", url: "https://checkout.stripe.com/c/pay/cs_test_Fixture123" });
  });
  vi.stubGlobal("fetch", H.fetch);
  await H.current!.db.exec("TRUNCATE stores, stripe_integrations CASCADE");
  const q = H.current!.client;
  await q`insert into stripe_integrations (id,name,environment,publishable_key,secret_key_ciphertext,webhook_secret_ciphertext,status)
    values (${INTEGRATION},'Health test','test','pk_test_Fixture123',${await encryptSecret("sk_test_Fixture123")},${await encryptSecret("whsec_Fixture123")},'ACTIVE')`;
  await q`insert into stores (id,name,slug,environment,currency,stripe_integration_id) values (${HHB_STORE_ID},'Hope Human Books','hope-human-books','test','USD',${INTEGRATION})`;
  for (const product of HHB_PRODUCTS) await q`insert into products (id,store_id,name,slug,sku,description,category,price_cents,currency,weight_grams,stock)
    values (${product.id},${HHB_STORE_ID},${product.name},${product.slug},${product.sku},${product.description},${product.category},${product.priceCents},'USD',0,1000)`;
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("protected PostgreSQL/Blob checkout diagnostic", () => {
  it("requires the existing Admin gate before any infrastructure check", async () => {
    H.admin.mockRejectedValue(new PaymentError("UNAUTHORIZED", "Expired"));
    const response = await checkoutHealthResponse("https://books.example.test");
    expect(response.status).toBe(401); expect(await response.json()).toEqual({ error: "Admin authentication required." });
    expect(H.queries).toBe(0); expect(H.get).not.toHaveBeenCalled(); expect(H.fetch).not.toHaveBeenCalled();
  });
  it("checks real SQL and private Blob, creates one correctly shaped TEST Session, and writes no financial rows", async () => {
    const response = await checkoutHealthResponse("https://books.example.test");
    const report = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(Object.keys(report)).toEqual(["environment", "postgres", "catalog", "integration", "blob", "dry_run"]);
    expect(report.environment).toEqual({ defined: ["DATABASE_URL", "PAYMENTS_ENCRYPTION_KEY", "BLOB_STORE_ID"], missing: ["BLOB_READ_WRITE_TOKEN", "ADMIN_PANEL_PASSWORD", "ADMIN_SESSION_SECRET"] });
    expect(report).toMatchObject({ postgres: { connected: true }, catalog: { count: 11, store_count: 11 }, integration: { exists: true, secret_decrypted: true, publishable_key_present: true, webhook_decrypted: true }, blob: { accessible: true }, dry_run: { environment: "test", slug: "little-women", amount_cents: 3000, session_created: true, error: null } });
    expect(report.catalog.slugs).toHaveLength(6); expect(report.catalog.slugs.every((entry: { resolves: boolean }) => entry.resolves)).toBe(true);
    expect(H.get).toHaveBeenCalledExactlyOnceWith(`v1/${HHB_WORKS[0]!.file}`, { access: "private" }); expect(H.cancel).toHaveBeenCalledOnce();
    expect(H.fetch).toHaveBeenCalledOnce();
    const [url, init] = H.fetch.mock.calls[0]!;
    expect(url).toBe("https://api.stripe.com/v1/checkout/sessions");
    expect(init.headers.Authorization).toBe("Bearer sk_test_Fixture123");
    const form = new URLSearchParams(init.body);
    expect(form.get("mode")).toBe("payment"); expect(form.get("line_items[0][quantity]")).toBe("1");
    expect(form.get("line_items[0][price_data][unit_amount]")).toBe("3000");
    expect(form.get("payment_intent_data[description]")).toBe(`Order ${form.get("metadata[order_number]")}`);
    for (const [key, value] of Object.entries({ category: "ebook", delivery_type: "digital", environment: "test", item_count: "1", product_type: "ebook", quantity: "1", sku: "HHB-EB-030" })) {
      expect(form.get(`metadata[${key}]`)).toBe(value); expect(form.get(`payment_intent_data[metadata][${key}]`)).toBe(value);
    }
    expect(form.get("metadata[order_id]")).toMatch(/^[a-f0-9-]{36}$/); expect(form.get("metadata[product_name]")).toBe(purchaseName());
    expect(form.get("metadata[store_id]")).toBe(HHB_STORE_ID);
    expect(String(init.body)).not.toMatch(/via|foundation|campaign|utm_|fbclid|fbc|fbp/);
    const financial = await H.current!.client`select (select count(*) from orders)::int as orders, (select count(*) from payments)::int as payments, (select sum(reserved_stock) from products)::int as reserved`;
    expect(financial[0]).toEqual({ orders: 0, payments: 0, reserved: 0 });
    expect(JSON.stringify(report)).not.toMatch(/Fixture123|mock-master|mockStoreId|postgres:\/\/|checkout\.stripe\.com|Unused/);
  });
  it("reports missing database configuration without a Stripe call", async () => {
    vi.stubEnv("DATABASE_URL", "");
    const response = await checkoutHealthResponse("https://books.example.test");
    expect(response.status).toBe(503); expect((await response.json()).postgres.error.stage).toBe("missing_env"); expect(H.fetch).not.toHaveBeenCalled();
  });
  it("reports missing catalog entries from PostgreSQL", async () => {
    await H.current!.client`delete from products where sku = 'HHB-EB-030'`;
    const report = await (await checkoutHealthResponse("https://books.example.test")).json();
    expect(report.catalog.error.stage).toBe("db_unreachable"); expect(report.catalog.slugs.find((entry: { slug: string }) => entry.slug === "little-women").resolves).toBe(false); expect(H.fetch).not.toHaveBeenCalled();
  });
  it("reports missing database Stripe integration and never falls back to env keys", async () => {
    await H.current!.client`update stores set stripe_integration_id = null`;
    const report = await (await checkoutHealthResponse("https://books.example.test")).json();
    expect(report.integration).toMatchObject({ exists: false, error: { stage: "no_stripe_integration" } }); expect(H.fetch).not.toHaveBeenCalled();
  });
  it("reports a wrong master key and never changes encrypted rows or uses env Stripe keys", async () => {
    const original = await H.current!.client`select secret_key_ciphertext from stripe_integrations`;
    vi.stubEnv("PAYMENTS_ENCRYPTION_KEY", "a-different-master-key-that-is-long-enough");
    const report = await (await checkoutHealthResponse("https://books.example.test")).json();
    expect(report.integration.error.stage).toBe("decrypt_failed"); expect(H.fetch).not.toHaveBeenCalled();
    expect(await H.current!.client`select secret_key_ciphertext from stripe_integrations`).toEqual(original);
  });
  it("reports a missing master key precisely", async () => {
    vi.stubEnv("PAYMENTS_ENCRYPTION_KEY", "");
    const report = await (await checkoutHealthResponse("https://books.example.test")).json();
    expect(report.integration.error.stage).toBe("missing_env"); expect(H.fetch).not.toHaveBeenCalled();
  });
  it("reports private Blob failure without exposing its URL or token", async () => {
    H.get.mockRejectedValue(new Error("GET https://private.example.test/file?token=secret vercel_blob_rw_fakeToken failed"));
    const report = await (await checkoutHealthResponse("https://books.example.test")).json();
    expect(report.blob).toMatchObject({ accessible: false, error: { stage: "blob_error" } });
    expect(JSON.stringify(report)).not.toMatch(/private\.example|fakeToken|token=secret/); expect(H.fetch).not.toHaveBeenCalled();
  });
  it("refuses LIVE integration credentials before creating any Session", async () => {
    const q = H.current!.client;
    await q`update stores set environment = 'live'`;
    await q`update stripe_integrations set environment = 'live',publishable_key = 'pk_live_Fixture123',secret_key_ciphertext = ${await encryptSecret("sk_live_Fixture123")}`;
    const report = await (await checkoutHealthResponse("https://books.example.test")).json();
    expect(report.dry_run.error).toMatchObject({ stage: "stripe_error", operation: "health.test_mode" }); expect(H.fetch).not.toHaveBeenCalled();
  });
  it("returns a sanitized Stripe failure without retries", async () => {
    H.fetch.mockResolvedValue(Response.json({ error: { message: "Invalid API Key provided: sk_test_NotARealKey", code: "api_key_invalid" } }, { status: 401 }));
    const response = await checkoutHealthResponse("https://books.example.test");
    expect(response.status).toBe(503);
    expect((await response.json()).dry_run).toMatchObject({ session_created: false, error: { stage: "stripe_error", message: "Invalid API Key provided: [redacted]" } }); expect(H.fetch).toHaveBeenCalledOnce();
  });
});

function purchaseName() { return HHB_PRODUCTS.find(product => product.slug === "little-women")!.name; }

describe("sanitized checkout stages", () => {
  it.each(["missing_env", "db_unreachable", "no_stripe_integration", "decrypt_failed", "blob_error", "stripe_error"] as const)("retains %s", stage => {
    expect(classifyCheckoutFailure(new CheckoutFailure(stage, "test.operation"))).toBe(stage);
  });
  it("preserves existing public provider details and logs one sanitized line per error", () => {
    const original = new PaymentError("PROVIDER_ERROR", "Safe buyer message", { providerCode: "api_key_invalid" });
    const error = new CheckoutFailure("stripe_error", "pay.create", original, { code: original.code, message: original.message });
    expect(error.details).toEqual(original.details); expect(error.message).toBe(original.message); expect(error.status).toBe(original.status);
    expect(safeCheckoutError(new Error("Private store mockStoreId is unavailable"))).toBe("Private store [redacted] is unavailable");
    logCheckoutFailure(error, "pay"); logCheckoutFailure(error, "pay");
    expect(console.error).toHaveBeenCalledTimes(1); expect(JSON.parse(vi.mocked(console.error).mock.calls[0]![0])).toMatchObject({ event: "checkout_failure", stage: "stripe_error", operation: "pay.create" });
  });
});
