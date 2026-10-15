/**
 * Minimal Central-served forwarding document for /donations/pay/<token>.
 * The production edge rewrites Referrer-Policy headers, so the policy is also set
 * inside the document (meta referrer) and the Central document performs the navigation.
 * The target is only ever the persisted Stripe Checkout URL, validated here again.
 */
export const PAY_SECURITY_HEADERS = {
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
} as const;

export function isOfficialStripeCheckoutUrl(raw: unknown): raw is string {
  if (typeof raw !== "string" || raw.length > 2048) return false;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && u.hostname === "checkout.stripe.com" && !u.username && !u.password && u.port === "";
  } catch {
    return false;
  }
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export function payBridgeResponse(target: string): Response {
  if (!isOfficialStripeCheckoutUrl(target)) throw new Error("invalid checkout target");
  const href = new URL(target).href;
  // JSON in a script, with "<" escaped so no </script> breakout is possible.
  const js = JSON.stringify(href).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta name="robots" content="noindex"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Continuing to secure checkout</title><script nonce="${nonce}">location.replace(${js});</script><noscript><meta http-equiv="refresh" content="0;url=${esc(href)}"></noscript></head><body><p>Continuing to Stripe secure checkout&hellip;</p><p><a href="${esc(href)}" rel="noreferrer noopener" referrerpolicy="no-referrer">Continue to checkout</a></p></body></html>`;
  return new Response(html, {
    status: 200,
    headers: {
      ...PAY_SECURITY_HEADERS,
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": `default-src 'none'; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; navigate-to https://checkout.stripe.com`,
    },
  });
}

export const seeOther = (location: string) =>
  new Response(null, { status: 303, headers: { ...PAY_SECURITY_HEADERS, location } });
