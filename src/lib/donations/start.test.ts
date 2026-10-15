// @ts-nocheck -- test doubles
import { describe, expect, it, vi } from "vitest";
import { handleDonationStart } from "./start.server";

const SELF = "https://hopehumanbooks.com";
const STORE = { id: "s1", slug: "hope-human-books" };

function deps(over = {}) {
  const byKey = new Map();
  const calls = [];
  const d = {
    calls,
    byKey,
    loadStore: vi.fn(async () => STORE),
    rateLimit: vi.fn(async () => {}),
    clientIp: () => "1.2.3.4",
    createDonation: vi.fn(async ({ store, body, origin }) => {
      calls.push({ store, body, origin });
      if (!byKey.has(body.idempotencyKey)) byKey.set(body.idempotencyKey, { publicToken: `tok_${byKey.size + 1}` });
      return byKey.get(body.idempotencyKey);
    }),
    ...over,
  };
  return d;
}
const payload = (o = {}) => ({ campaignSlug: "help-maria", amountCents: 2000, idempotencyKey: "site-key-123456", ...o });
function req({ method = "POST", origin = "https://www.hopehumanfoundation.org", body, ctype = "application/x-www-form-urlencoded" } = {}) {
  const h = new Headers();
  if (origin) h.set("origin", origin);
  if (ctype) h.set("content-type", ctype);
  const b = body ?? new URLSearchParams({ payload: JSON.stringify(payload()) }).toString();
  return new Request(`${SELF}/donations/start`, { method, headers: h, body: method === "POST" ? b : undefined });
}

describe("POST /donations/start", () => {
  it("valid payload -> 303 to own /donations/pay/<token>, empty body, no-store", async () => {
    const d = deps();
    const r = await handleDonationStart(req(), d);
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe(`${SELF}/donations/pay/tok_1`);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.headers.get("referrer-policy")).toBe("no-referrer");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await r.text()).toBe("");
    expect(d.loadStore).toHaveBeenCalledWith("hope-human-books");
    expect(d.calls[0].body).toEqual({ campaignSlug: "help-maria", amountCents: 2000, currency: "USD", idempotencyKey: "site-key-123456" });
    expect(d.calls[0].body.donor).toBeUndefined();
  });

  it("forwards attribution and allows exact same-origin", async () => {
    const d = deps();
    const body = new URLSearchParams({ payload: JSON.stringify(payload({ attribution: { utm_source: "fb" } })) }).toString();
    const r = await handleDonationStart(req({ origin: SELF, body }), d);
    expect(r.status).toBe(303);
    expect(d.calls[0].body.attribution).toEqual({ utm_source: "fb" });
  });

  it.each([null, "https://evil.com", "https://hopehumanfoundation.org.evil.com", "https://x.hopehumanfoundation.org", "http://hopehumanfoundation.org"])(
    "rejects origin %s with 403 and no creation",
    async (origin) => {
      const d = deps();
      const r = await handleDonationStart(req({ origin }), d);
      expect(r.status).toBe(403);
      expect(d.createDonation).not.toHaveBeenCalled();
    },
  );

  it("rejects oversize body, extra fields, donor, store override, bad JSON, wrong ctype", async () => {
    const cases = [
      req({ body: new URLSearchParams({ payload: JSON.stringify(payload({ attribution: { x: "a".repeat(400) }, pad: "y".repeat(9000) })) }).toString() }),
      req({ body: new URLSearchParams({ payload: JSON.stringify(payload({ extra: 1 })) }).toString() }),
      req({ body: new URLSearchParams({ payload: JSON.stringify(payload({ donor: { email: "a@b.co" } })) }).toString() }),
      req({ body: new URLSearchParams({ payload: JSON.stringify(payload({ storeSlug: "other" })) }).toString() }),
      req({ body: new URLSearchParams({ payload: JSON.stringify(payload()), storeId: "x" }).toString() }),
      req({ body: "payload=%7Bnot-json" }),
      req({ ctype: "application/json", body: JSON.stringify(payload()) }),
      req({ body: new URLSearchParams({ payload: JSON.stringify(payload({ amountCents: 2500 })) }).toString() }),
      req({ body: new URLSearchParams({ payload: JSON.stringify(payload({ amountCents: "2000" })) }).toString() }),
    ];
    for (const c of cases) {
      const d = deps();
      const r = await handleDonationStart(c, d);
      expect(r.status).toBe(400);
      expect(d.createDonation).not.toHaveBeenCalled();
    }
  });

  it("chunked body >8KiB without Content-Length is cancelled mid-stream, no creation", async () => {
    let pulled = 0, cancelled = false;
    const chunk = new TextEncoder().encode("payload=" + "a".repeat(1016));
    const stream = new ReadableStream({
      pull(c) { pulled++; c.enqueue(chunk); },
      cancel() { cancelled = true; },
    });
    const r0 = new Request(`${SELF}/donations/start`, { method: "POST", body: stream, duplex: "half", headers: { origin: "https://hopehumanfoundation.org", "content-type": "application/x-www-form-urlencoded" } });
    expect(r0.headers.get("content-length")).toBeNull();
    const d = deps();
    const r = await handleDonationStart(r0, d);
    expect(r.status).toBe(400);
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(cancelled).toBe(true);
    expect(pulled).toBeLessThan(20);
    expect(d.loadStore).not.toHaveBeenCalled();
    expect(d.rateLimit).not.toHaveBeenCalled();
    expect(d.createDonation).not.toHaveBeenCalled();
  });

  it.each(["-1", "abc", "1.5", "99999999"])("invalid Content-Length %s -> 400 before store/rate/create", async (cl) => {
    const d = deps();
    const h = new Headers({ origin: "https://hopehumanfoundation.org", "content-type": "application/x-www-form-urlencoded", "content-length": cl });
    const fake = { method: "POST", url: `${SELF}/donations/start`, headers: h, body: null };
    const r = await handleDonationStart(fake, d);
    expect(r.status).toBe(400);
    expect(d.loadStore).not.toHaveBeenCalled();
    expect(d.createDonation).not.toHaveBeenCalled();
  });

  it.each(["GET", "HEAD", "OPTIONS", "PUT", "DELETE"])("%s -> 405 without creation", async (method) => {
    const d = deps();
    const r = await handleDonationStart(new Request(`${SELF}/donations/start`, { method, headers: { origin: "https://hopehumanfoundation.org" } }), d);
    expect(r.status).toBe(405);
    expect(d.createDonation).not.toHaveBeenCalled();
  });

  it("gate/campaign unavailable -> 303 back to Foundation donate page preserving selection", async () => {
    const err = Object.assign(new Error("Donation configuration pending."), { code: "CONFIG_ERROR" });
    const d = deps({ createDonation: vi.fn(async () => { throw err; }) });
    const r = await handleDonationStart(req(), d);
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe("https://www.hopehumanfoundation.org/donate?slug=help-maria&amount=20&checkout_error=unavailable");
    const d2 = deps({ rateLimit: vi.fn(async () => { throw new Error("rate"); }) });
    expect((await handleDonationStart(req(), d2)).headers.get("location")).toContain("checkout_error=unavailable");
    expect(d2.createDonation).not.toHaveBeenCalled();
    const d3 = deps({ loadStore: vi.fn(async () => null) });
    expect((await handleDonationStart(req(), d3)).headers.get("location")).toContain("checkout_error=unavailable");
  });

  it("retry with same key reuses the same attempt", async () => {
    const d = deps();
    const a = await handleDonationStart(req(), d);
    const b = await handleDonationStart(req(), d);
    expect(a.headers.get("location")).toBe(b.headers.get("location"));
    expect(d.byKey.size).toBe(1);
  });

  it("drops unknown attribution keys, keeps/sanitizes allowed ones, deterministic on retry", async () => {
    const attribution = {
      utm_source: " fb\u0007 ",
      utm_campaign: "spring",
      evil_key: "drop-me",
      referrer: "https://example.org/x",
      empty: "",
    };
    const body = new URLSearchParams({ payload: JSON.stringify(payload({ attribution })) }).toString();
    const d = deps();
    const r1 = await handleDonationStart(req({ body }), d);
    const r2 = await handleDonationStart(req({ body }), d);
    expect(r1.status).toBe(303);
    expect(r1.headers.get("location")).toBe(r2.headers.get("location"));
    expect(d.byKey.size).toBe(1);
    const sent = d.calls[0].body.attribution;
    expect(sent).toEqual({ utm_source: "fb", utm_campaign: "spring", referrer: "https://example.org/x" });
    expect(sent).not.toHaveProperty("evil_key");
    expect(sent).not.toHaveProperty("empty");
    expect(d.calls[0].body.idempotencyKey).toBe("site-key-123456");
  });

  it("attribution with only unknown/empty keys is omitted entirely", async () => {
    const body = new URLSearchParams({ payload: JSON.stringify(payload({ attribution: { nope: "x", blank: "   " } })) }).toString();
    const d = deps();
    const r = await handleDonationStart(req({ body }), d);
    expect(r.status).toBe(303);
    expect(d.calls[0].body.attribution).toBeUndefined();
  });

  it("never touches ebook order creation", async () => {
    const src = await import("node:fs").then((fs) => fs.readFileSync("src/lib/donations/start.server.ts", "utf8"));
    expect(src).not.toMatch(/orders\.server|createOrder|fulfillment|from\("orders"\)/);
    expect(src).not.toMatch(/fetch\(/);
  });
});
