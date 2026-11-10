/**
 * Minimal capture document for /comprar/<slug>.
 *
 * The Meta `_fbp`/`_fbc` cookies and the page that sent the buyer here
 * (document.referrer — the Foundation donation page for cloaker traffic) are
 * only fully visible in the browser, so the first GET serves this document
 * instead of creating an order. The inline script synchronously appends those
 * values to the query (fbp/fbc/esrc) and re-enters the same route with `c=1`;
 * the `c=1` request performs the real server-side purchase entry. Capture is
 * best effort: any failure falls back to the plain `c=1` URL, so a missing
 * value never blocks the order.
 *
 * Referrer policy "origin": the follow-up request is same-origin, and the
 * later 302 to Stripe sends only the Books origin as Referer — never the
 * /comprar path, query or tracking values.
 */
export const CAPTURE_PARAM = "c";

const BRIDGE_HEADERS = {
  "cache-control": "no-store",
  "referrer-policy": "origin",
  "x-content-type-options": "nosniff",
  "x-robots-tag": "noindex",
} as const;

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export function purchaseBridgeResponse(url: URL): Response {
  const next = new URL(url);
  next.searchParams.set(CAPTURE_PARAM, "1");
  // Same-origin relative target: pathname + existing query + c=1.
  const href = next.pathname + next.search;
  // JSON in a script, with "<" escaped so no </script> breakout is possible.
  const js = JSON.stringify(href).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");

  const nonce = crypto.randomUUID().replace(/-/g, "");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="referrer" content="origin"><meta name="robots" content="noindex"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Preparing your order</title><script nonce="${nonce}">try{var p=new URLSearchParams(location.search);p.set(${JSON.stringify(CAPTURE_PARAM)},"1");var read=function(n){var m=document.cookie.match(new RegExp("(?:^|; )"+n+"=([^;]*)"));return m?decodeURIComponent(m[1]):""};var fbp=read("_fbp");if(fbp&&!p.has("fbp"))p.set("fbp",fbp);var fbc=read("_fbc");if(fbc&&!p.has("fbc"))p.set("fbc",fbc);if(document.referrer&&!p.has("esrc"))p.set("esrc",document.referrer);try{history.replaceState(null,"",location.pathname)}catch(e){}location.replace(location.pathname+"?"+p.toString())}catch(e){location.replace(${js})}</script><noscript><meta http-equiv="refresh" content="0;url=${esc(href)}"></noscript></head><body><p>Preparing your order&hellip;</p><p><a href="${esc(href)}" rel="noopener" referrerpolicy="origin">Continue</a></p></body></html>`;
  return new Response(html, {
    status: 200,
    headers: {
      ...BRIDGE_HEADERS,
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": `default-src 'none'; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    },
  });
}
