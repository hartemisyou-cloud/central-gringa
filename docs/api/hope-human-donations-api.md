# Hope Human Foundation — Donations API (central)

Donations are fully separate from ebooks: own tables (`donations`, `donation_ledger`,
`donation_releases`, `donation_campaigns`, `donation_beneficiaries`, `donation_settings`),
own Stripe SDK instance (API `2026-08-26.dahlia`), never the ebook products/orders/downloads.
Everything is **off by default** (`ready:false`) until a person confirms every gate in `/admin`.

## Authentication
Server-to-server only: `x-store-api-key: <keyId>.<secret>` + `x-store-slug: hope-human-books`.
Never expose the key in browser code.

## GET /api/public/v1/donations/catalog
```json
{"data":{"purpose":"donation","ready":false,"currency":"USD",
 "amountsCents":[2000,3000,5000,10000,25000,50000],
 "recipient":{"name":"Hope Human Foundation","country":"US","useOfFunds":""},
 "campaigns":[{"slug":"example","title":"Example","active":false,"ready":false}]}}
```
`useOfFunds:""` and `ready:false` are valid pending defaults. A campaign is `ready` only when the
global config is ready AND the campaign is human-reviewed, active, not ended, and mapped to a
reviewed beneficiary with an active connected account in an enabled country.

## POST /api/public/v1/donations
Strict body (unknown fields → 400):
```json
{"campaignSlug":"example","amountCents":2000,"currency":"USD","idempotencyKey":"uuid-or-similar",
 "donor":{"firstName":"Ada","lastName":"L","email":"ada@example.com"},"attribution":{"utm_source":"x"}}
```
Response:
```json
{"data":{"donationId":"…","donationNumber":"HHF-…","publicToken":"…","purpose":"donation",
 "status":"PENDING","amountCents":2000,"currency":"USD",
 "paymentUrl":"<central>/donations/pay/<token>","receiptUrl":"<central>/donations/receipt/<token>"}}
```
Errors: `NOT_FOUND` unknown campaign · `INVALID_STATE` campaign not ready / idempotency key reused
with a different payload · `CONFIG_ERROR` "Donation configuration pending." · `INVALID_INPUT`.
Idempotency is per store, persisted with a SHA-256 fingerprint of the payload; repeats and
concurrent requests return the same donation. There is never a fallback to ebook endpoints.

## GET /api/public/v1/donations/status/{publicToken}
```json
{"data":{"purpose":"donation","donationId":"…","donationNumber":"HHF-…","publicToken":"…",
 "status":"PAID","amountCents":2000,"currency":"USD",
 "receiptUrl":"<central>/donations/receipt/<token>","campaignSlug":"example",
 "payoutStatus":"HELD"}}
```
Status comes only from the database (verified webhooks). No ebook, order item or download fields.
`status`: PENDING, PROCESSING, PAID, FAILED, EXPIRED, CANCELLED, REFUNDED, PARTIALLY_REFUNDED,
DISPUTED, RELEASED, REVERSAL_REQUIRED.
`payoutStatus`: NOT_APPLICABLE, HELD, RELEASE_IN_PROGRESS, RELEASE_FAILED, RELEASED, REVERSAL_REQUIRED.

## Policy pages
`/donations/terms`, `/donations/privacy`, `/donations/refunds`.

## Checkout-side validation
Accept a create response only when `paymentUrl` is exactly `<central origin>/donations/pay/<publicToken>`,
`receiptUrl` is exactly `<central origin>/donations/receipt/<publicToken>`, `purpose` is `donation`,
`amountCents`/`currency` match the request, and the campaign was `ready` in the catalog.

## Payment flow
Checkout (Vercel) → POST /donations → redirect donor to `paymentUrl`. The central redirects (303)
only to the persisted official `https://checkout.stripe.com/…` URL of that donation; otherwise to
the receipt. Success/cancel both return to the fixed receipt path; the URL never marks anything
paid. Only verified webhooks (`checkout.session.completed` / `async_payment_succeeded` with
`payment_status=paid` and matching donation/session/store/integration/livemode/USD amount) do.

Webhook events to add to the existing Stripe endpoint: `checkout.session.completed`,
`checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`,
`checkout.session.expired` (plus the existing payment_intent / charge events).

## Funds and releases
Separate charges and transfers. Payment is captured automatically (never `capture_method: manual`, which would break Adaptive Pricing); "hold" only means the transfer is delayed. The platform is charged (no `transfer_data`, `on_behalf_of`,
`application_fee_amount`); funds are held until a person approves a release in `/admin`.
Release = full original USD gross, linked with `source_transaction` to that donation's own
charge, only when the charge settled in USD and available USD balance covers the full gross after reserving every other held donation. `source_transaction` never bypasses that check. The NGO covers all fees from
dedicated funding; if dedicated funding or free balance (excluding other held donations) is short,
the release is blocked with the deficit shown. Refunds/disputes after release set
`REVERSAL_REQUIRED` for human action — nothing is reversed automatically.

## Activation blockers (external, human only)
Stripe fundraising + Connect approval, platform country & USD settlement eligibility, Adaptive
Pricing eligibility, allowed recipient countries / recipient service agreement, Dashboard and
negative-balance responsibility choices, use of funds text, reviewed campaigns (manifest import
stays UNREVIEWED), reviewed beneficiaries with Stripe-hosted onboarding complete, NGO fee funding.
`integration_identifier` is sent as requested; it has not been verified against a live Stripe call.
