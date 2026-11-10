import { beforeEach, describe, expect, it, vi } from "vitest";
import { CAPTURE_PARAM, purchaseBridgeResponse } from "./purchase-bridge";

const entry = vi.hoisted(() => ({ handle: vi.fn(), deps: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({ createFileRoute: () => (options: unknown) => ({ options }) }));
vi.mock("./purchase-entry.server", () => ({ handlePurchaseEntry: entry.handle, defaultPurchaseEntryDeps: entry.deps }));
import { Route } from "@/routes/comprar.$slug";

const url = (query = "") => new URL(`https://hopehumanbooks.com/comprar/little-women${query}`);

describe("GET /comprar capture decision", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    entry.deps.mockResolvedValue({});
    entry.handle.mockResolvedValue(new Response(null, { status: 302, headers: { location: "https://checkout.stripe.com/c/pay/fixture" } }));
  });

  const get = (Route.options as unknown as {
    server: { handlers: { GET: (context: { request: Request; params: { slug: string } }) => Promise<Response> } };
  }).server.handlers.GET;

  it("serves capture HTML even when esrc is present, preserving it on re-entry", async () => {
    const request = new Request(url("?esrc=https%3A%2F%2Fpartner.example%2Fpage"));
    const response = await get({ request, params: { slug: "little-women" } });
    expect(response.status).toBe(200);
    expect(entry.handle).not.toHaveBeenCalled();
    expect(entry.deps).not.toHaveBeenCalled();
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    // The existing esrc query must survive into the c=1 re-entry.
    const html = await response.text();
    expect(html).toContain("esrc=https%3A%2F%2Fpartner.example%2Fpage");
    expect(html).toContain(`${CAPTURE_PARAM}=1`);
  });

  it.each(["", "?esrc=", "?esrc=%20%20"])("keeps capture without a non-empty esrc (%s)", async query => {
    const response = await get({ request: new Request(url(query)), params: { slug: "little-women" } });
    expect(response.status).toBe(200);
    expect(entry.handle).not.toHaveBeenCalled();
    expect(entry.deps).not.toHaveBeenCalled();
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
  });
});

describe("purchaseBridgeResponse", () => {
  it("serves a hardened no-store HTML document with a nonce-scoped script", async () => {
    const response = purchaseBridgeResponse(url());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("origin");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
    const csp = response.headers.get("content-security-policy") ?? "";
    const html = await response.text();
    const nonce = /script-src 'nonce-([a-f0-9]+)'/.exec(csp)?.[1];
    expect(nonce).toBeTruthy();
    expect(html).toContain(`<script nonce="${nonce}">`);
    expect(html).toContain('<meta name="referrer" content="origin">');
    expect(html).not.toMatch(/noreferrer|no-referrer|unsafe-url/);
  });

  it("re-enters the same route with c=1, preserving the existing query", async () => {
    const html = await purchaseBridgeResponse(url("?fbclid=IwAR0abc&utm_source=facebook")).text();
    expect(html).toContain(`p.set("${CAPTURE_PARAM}","1")`);
    // Noscript fallback keeps the original query and adds c=1.
    expect(html).toContain("fbclid=IwAR0abc");
    expect(html).toContain("utm_source=facebook");
    expect(html).toContain(`${CAPTURE_PARAM}=1`);
    // The script captures the Meta cookies and the referring page.
    expect(html).toContain('read("_fbp")');
    expect(html).toContain('read("_fbc")');
    expect(html).toContain('p.set("esrc",document.referrer)');
    expect(html).toContain("location.replace(");
  });

  it("escapes the noscript target so query values cannot break out of the document", async () => {
    const html = await purchaseBridgeResponse(url(`?ref=${encodeURIComponent('"><script>alert(1)</script>')}`)).text();
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("%22%3E%3Cscript%3E");
  });

  it("never navigates cross-origin: the fallback target is a same-origin relative path", async () => {
    const html = await purchaseBridgeResponse(url()).text();
    const match = /catch\(e\)\{location\.replace\((\"[^\"]+\")\)\}<\/script>/.exec(html);
    expect(match).toBeTruthy();
    const target = JSON.parse(match![1]!) as string;
    expect(target.startsWith("/comprar/little-women?")).toBe(true);
    expect(target).toContain(`${CAPTURE_PARAM}=1`);
    expect(target).not.toMatch(/https?:/);
  });
});
