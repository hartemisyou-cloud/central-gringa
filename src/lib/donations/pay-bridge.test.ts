import { describe, it, expect } from "vitest";
import { buildSessionRequest } from "./rules";
import { isOfficialStripeCheckoutUrl, payBridgeResponse, seeOther } from "./pay-bridge";
import { FOUNDATION_LOGO_URL, DONATION_BRANDING } from "./rules";

describe("donation privacy: Central-only technical URLs", () => {
  it("logo/branding point to Books", () => {
    expect(FOUNDATION_LOGO_URL).toBe("https://hopehumanbooks.com/brand/hope-human-logo.png");
    expect(DONATION_BRANDING.display_name).toBe("Hope Human Foundation");
    expect(JSON.stringify(DONATION_BRANDING)).not.toMatch(/hopehumanfoundations?\.org/);
  });
  it("real buildSessionRequest payload: Books-only technical URLs, identity/campaign/amount intact", () => {
    const B = "https://hopehumanbooks.com";
    const p = buildSessionRequest({
      donationId: "11111111-1111-4111-8111-111111111111",
      donationNumber: "DN-000123",
      storeId: "22222222-2222-4222-8222-222222222222",
      integrationId: "33333333-3333-4333-8333-333333333333",
      publicToken: "tok_abc123",
      amountCents: 2000,
      donorEmail: null,
      origin: B,
      campaign: { slug: "mateo", title: "Help Mateo" },
      recipientName: "Hope Human Foundation",
      adaptivePricing: true,
      integrationIdentifier: "hhf_donations_ABCDEFGH",
    }) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(JSON.stringify(p)).not.toMatch(/hopehumanfoundations?\.org/i);
    const logo = `${B}/brand/hope-human-logo.png`;
    expect(p.line_items[0].price_data.product_data.images).toEqual([logo]);
    expect(p.branding_settings.logo).toEqual({ type: "url", url: logo });
    expect(p.success_url).toBe(`${B}/donations/receipt/tok_abc123`);
    expect(p.cancel_url).toBe(`${B}/donations/receipt/tok_abc123`);
    expect(p.submit_type).toBe("donate");
    expect(p.mode).toBe("payment");
    expect(p.metadata).toMatchObject({ purpose: "donation", recipient: "Hope Human Foundation", campaign_slug: "mateo", campaign_title: "Help Mateo", base_amount_cents: "2000", base_currency: "USD" });
    expect(p.payment_intent_data.metadata.purpose).toBe("donation");
    expect(p.line_items[0].price_data).toMatchObject({ currency: "usd", unit_amount: 2000 });
    expect(p.branding_settings.display_name).toBe("Hope Human Foundation");
  });
});

describe("pay bridge", () => {
  const ok = "https://checkout.stripe.com/c/pay/cs_test_abc#frag";
  it("accepts only exact Stripe checkout host", () => {
    expect(isOfficialStripeCheckoutUrl(ok)).toBe(true);
    for (const bad of ["http://checkout.stripe.com/x", "https://checkout.stripe.com.evil.com/x", "https://evil.com/?checkout.stripe.com", "https://u:p@checkout.stripe.com/x", "https://checkout.stripe.com:8443/x", "javascript:alert(1)", 5, null])
      expect(isOfficialStripeCheckoutUrl(bad)).toBe(false);
    expect(() => payBridgeResponse("https://evil.com/")).toThrow();
  });
  it("serves no-referrer document with immediate JS nav, nonce CSP and safe fallback", async () => {
    const r = payBridgeResponse(ok);
    expect(r.status).toBe(200);
    expect(r.headers.get("referrer-policy")).toBe("no-referrer");
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    const csp = r.headers.get("content-security-policy")!;
    const nonce = /nonce-([a-f0-9]+)/.exec(csp)![1];
    const html = await r.text();
    expect(html).toContain('<meta name="referrer" content="no-referrer">');
    expect(html).toContain(`<script nonce="${nonce}">location.replace("${ok}");</script>`);
    expect(html).toMatch(/rel="noreferrer noopener"/);
    expect(html).not.toMatch(/setTimeout|js\.stripe\.com/);
  });
  it("escapes markup in target (no XSS)", async () => {
    const html = await payBridgeResponse('https://checkout.stripe.com/c/"><\/script><img src=x onerror=1>').text();
    expect(html).not.toContain("</script><img");
    expect(html).not.toContain('"><img');
  });
  it("redirect helper keeps no-referrer", () => {
    const r = seeOther("https://hopehumanbooks.com/donations/receipt/t");
    expect(r.status).toBe(303);
    expect(r.headers.get("referrer-policy")).toBe("no-referrer");
  });
});
