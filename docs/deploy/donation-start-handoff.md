# Donation start handoff (Foundation site → Central → Stripe)

```text
hopehumanfoundation.org (user picks campaign + amount, clicks Donate)
  └─ same-tab form POST https://hopehumanbooks.com/donations/start
       └─ 303 → https://hopehumanbooks.com/donations/pay/<publicToken>
            └─ 200 minimal Central (Books) document → immediate navigation → official Stripe-hosted Checkout (checkout.stripe.com)
```

No second click. `/donations/pay/<token>` returns a tiny Books-served document (`<meta name="referrer" content="origin">`, nonce-CSP inline `location.replace(<persisted, re-validated checkout.stripe.com URL>)`, `<noscript>` refresh 0, accessible fallback link `rel="noopener" referrerpolicy="origin"`). Stripe receives exactly the Books origin (`https://hopehumanbooks.com/`) as Referer — never the `/donations/pay/...` path or token. No timer, no Stripe.js, no Session creation in this GET, no target taken from the request. Gate failures / non-PENDING / expired still `303` to the receipt (those error redirects keep `no-referrer`). `/donations/pay/<token>` stays the owner of the Session and keeps every readiness gate.

## Request
- `POST /donations/start`, `Content-Type: application/x-www-form-urlencoded`, exactly one field `payload` (JSON), body ≤ 8 KiB, enforced while streaming (reading is cancelled once the limit is exceeded); a malformed or oversize `Content-Length` is rejected with 400 before any store lookup, rate limit or creation.
- Payload (strict, no other fields): `{ campaignSlug: string, amountCents: number, idempotencyKey: string, attribution?: Record<string,string> }`.
  - `amountCents` ∈ 2000, 3000, 5000, 10000, 25000, 50000 (USD 20 → 2000). Currency is always USD.
  - No donor fields: Stripe collects contact details.
  - Keep `idempotencyKey` stable for the same selection; a retry returns the same donation/Session.
- `Origin` must exactly equal `https://hopehumanfoundation.org`, `https://www.hopehumanfoundation.org`, `https://id-preview--5dc3b815-88ea-4da6-b1d3-a58fa6079440.lovable.app`, or the Central's own origin. No wildcards/suffixes.
- The store (`hope-human-books`) is resolved on the server only; no store slug/ID/API key is accepted or needed in the browser.

## Responses
| Case | Response |
| --- | --- |
| Success | `303`, empty body, `cache-control: no-store`, `referrer-policy: no-referrer`, `x-content-type-options: nosniff`, `Location: <central origin>/donations/pay/<publicToken>` |
| Valid selection but gate/campaign/config/rate-limit/provider unavailable | `303` → `https://www.hopehumanfoundation.org/donate?slug=<slug>&amount=<USD>&checkout_error=unavailable` |
| Bad origin | `403` |
| Bad content type, oversize, invalid JSON, extra/unknown fields, unsupported amount | `400` |
| GET/HEAD/PUT/PATCH/DELETE | `405` (no record, no Session) |
| OPTIONS | Answered by the framework before the handler (observed `204`, no body); the handler's `405` is not guaranteed on the network. No record or Session is ever created. |

Uses the same server-only `createDonation` (schema, fingerprint idempotency, collection gates, kill switch, TEST/LIVE rules) as `POST /api/public/v1/donations`. Never creates ebook orders.

## Site form example
```html
<form method="POST" action="https://hopehumanbooks.com/donations/start">
  <input type="hidden" name="payload" value='{"campaignSlug":"<slug>","amountCents":2000,"idempotencyKey":"<stable-uuid>"}'>
  <button type="submit">Donate</button>
</form>
```

## Referrer and technical URLs (privacy / data minimization)
- The production edge rewrites the `Referrer-Policy` response header to `strict-origin-when-cross-origin` (the bridge document sends `origin`; observed preview vs production). The effective `origin` policy for the Central → Stripe navigation therefore comes from the meta tag in the Books document, not the header. Headers `no-store`, `nosniff` and `origin` are still sent. This does not prevent Stripe from associating the sites, and browsers/extensions that strip referrers may still send none; the real Referer will be verified in a browser after publish.
- The request *into* `/donations/start` / `/donations/pay` still carries the Foundation page's referrer under the Foundation site's own policy; this project does not change that.
- New Sessions send only Books URLs: logo `https://hopehumanbooks.com/brand/hope-human-logo.png` (byte-identical copy of the original Foundation logo, SHA-256 `4b163c39…665bda`) in `branding_settings.logo` and `product_data.images`; success/cancel = `<central origin>/donations/receipt/<token>`. No marketing attribution is sent to Stripe.
- Limitation: this minimizes forwarded data; it does NOT prevent Stripe from associating the sites. The transaction stays openly a donation to Hope Human Foundation (`purpose=donation`, `submit_type=donate`, recipient name, campaign metadata).
- Only NEW Sessions are affected. Stored session requests/idempotency keys and historical records are not rewritten or deleted (an already-stored request keeps its old logo URL).
