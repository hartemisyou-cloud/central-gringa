# Donation start handoff (Foundation site → Central → Stripe)

```text
hopehumanfoundation.org (user picks campaign + amount, clicks Donate)
  └─ same-tab form POST https://hopehumanbooks.com/donations/start
       └─ 303 → https://hopehumanbooks.com/donations/pay/<publicToken>
            └─ 303 → official Stripe-hosted Checkout (checkout.stripe.com)
```

No extra page and no second click. `/donations/pay/<token>` stays the owner of the Session and keeps every readiness gate.

## Request
- `POST /donations/start`, `Content-Type: application/x-www-form-urlencoded`, exactly one field `payload` (JSON), body ≤ 8 KiB.
- Payload (strict, no other fields): `{ campaignSlug: string, amountCents: number, idempotencyKey: string, attribution?: Record<string,string> }`.
  - `amountCents` ∈ 2000, 3000, 5000, 10000, 25000, 50000 (USD 20 → 2000). Currency is always USD.
  - No donor fields: Stripe collects contact details.
  - Keep `idempotencyKey` stable for the same selection; a retry returns the same donation/Session.
- `Origin` must exactly equal `https://hopehumanfoundation.org`, `https://www.hopehumanfoundation.org`, `https://id-preview--5dc3b815-88ea-4da6-b1d3-a58fa6079440.lovable.app`, or the Central's own origin. No wildcards/suffixes.
- The store (`hope-human-books`) is resolved on the server only; no store slug/ID/API key is accepted or needed in the browser.

## Responses
| Case | Response |
| --- | --- |
| Success | `303`, empty body, `cache-control: no-store`, `Location: <central origin>/donations/pay/<publicToken>` |
| Valid selection but gate/campaign/config/rate-limit/provider unavailable | `303` → `https://www.hopehumanfoundation.org/donate?slug=<slug>&amount=<USD>&checkout_error=unavailable` |
| Bad origin | `403` |
| Bad content type, oversize, invalid JSON, extra/unknown fields, unsupported amount | `400` |
| GET/HEAD/OPTIONS/PUT/PATCH/DELETE | `405` (no record, no Session) |

Uses the same server-only `createDonation` (schema, fingerprint idempotency, collection gates, kill switch, TEST/LIVE rules) as `POST /api/public/v1/donations`. Never creates ebook orders.

## Site form example
```html
<form method="POST" action="https://hopehumanbooks.com/donations/start">
  <input type="hidden" name="payload" value='{"campaignSlug":"<slug>","amountCents":2000,"idempotencyKey":"<stable-uuid>"}'>
  <button type="submit">Donate</button>
</form>
```
