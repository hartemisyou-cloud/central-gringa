# Hope Human Foundation — Donations API

The active flow is direct donation collection for Hope Human Foundation. Known active campaigns work without manual review in the app. Donations have their own records, ledger and Stripe Checkout Sessions; they never create ebook orders, stock changes or download access.

## Basic administration

`/admin` shows the collection status, Stripe mode, active campaign count and recent donations. The only collection setting is **Accept donations**. Saving it changes only `donations_enabled`, preserves historical settings, and does not require a typed name or campaign approval.

- An eligible ACTIVE store and Stripe integration in the same mode enable collection by default when no settings row exists. This effective default does not write a row or claim any external approval.
- A saved `donations_enabled=false` pauses collection, including new redirects for existing pending donations. An already-open Stripe page is not revoked; its verified payment result is still recorded.
- LIVE additionally requires the webhook signing secret. TEST can open a test Session without it, but no payment can become PAID without a verified signed webhook.
- Campaigns must be known server-side, active and not ended. `review_status`, beneficiary review, Connect, fee reserves, payout schedules and local financial attestations do not control collection.
- Authenticated campaign imports create new active entries without fabricating a review. Existing entries retain their state, including an explicit suspension. The public start form cannot register arbitrary campaigns or titles.
- The change does not switch the current Stripe mode, modify provider account settings or override requirements enforced by Stripe.

Connect onboarding, beneficiary registration and manual transfer/release controls are absent from the basic panel. Their historical tables and guarded implementation are retained for data compatibility and remain inactive. They are not part of donation collection.

## Authentication

Server-to-server API calls require `x-store-api-key: <keyId>.<secret>` and `x-store-slug: hope-human-books`. Never expose that key in browser code.

The Foundation browser uses the separate same-tab form POST `/donations/start`. The Central resolves the store on the server, validates the exact Origin allowlist, body size, known campaign and supported amount, and rate-limits the request. See `docs/deploy/donation-start-handoff.md`.

## GET /api/public/v1/donations/catalog

```json
{"data":{"purpose":"donation","ready":true,"currency":"USD",
 "amountsCents":[2000,3000,5000,10000,25000,50000],
 "recipient":{"name":"Hope Human Foundation","country":"US","useOfFunds":"..."},
 "campaigns":[{"slug":"example","title":"Example","active":true,"ready":true}]}}
```

Global `ready` reflects the current store/integration/mode and collection switch. Each campaign also checks active/expiry state. A campaign can be ready while its historical review status remains PENDING or UNREVIEWED. All registered campaigns remain listed, including paused ones. Unknown campaigns are rejected.

## POST /api/public/v1/donations

Strict body; unknown fields are rejected:

```json
{"campaignSlug":"example","amountCents":2000,"currency":"USD","idempotencyKey":"uuid-or-similar",
 "donor":{"firstName":"Ada","lastName":"L","email":"ada@example.com"},"attribution":{"utm_source":"x"}}
```

The donor fields are optional for the browser handoff; Stripe collects contact details. Supported base tickets are US$20, US$30, US$50, US$100, US$250 and US$500.

```json
{"data":{"donationId":"...","donationNumber":"HHF-...","publicToken":"...","purpose":"donation",
 "status":"PENDING","amountCents":2000,"currency":"USD",
 "paymentUrl":"<central>/donations/pay/<token>","receiptUrl":"<central>/donations/receipt/<token>"}}
```

Errors include `NOT_FOUND` for an unknown campaign, `INVALID_STATE` for a paused/ended campaign or an idempotency key reused with a different payload, `CONFIG_ERROR` for an unavailable integration/collection, and `INVALID_INPUT`.

Idempotency is per store, with a persisted SHA-256 payload fingerprint. Repeated/concurrent requests return the same donation. The complete Stripe request is persisted before the provider call and stays fixed on retry. Retries retain the original integration, account, mode and Session binding. No fallback uses ebook payment endpoints.

## Browser payment flow

```text
Foundation: select campaign and amount, click Donate
  -> POST Books /donations/start
  -> 303 Books /donations/pay/<token>
  -> official Stripe Checkout URL
  -> Books /donations/receipt/<token>
```

The Books bridge immediately navigates only to the persisted, revalidated official Stripe URL. Success and cancellation return to the receipt. URL parameters and the success page never mark a donation paid. The browser reference observed in tests is the Books origin; this does not guarantee that Stripe cannot associate the sites or identify the declared organization/campaign.

## Signed payment confirmation

The existing integration webhook remains `/api/public/webhooks/stripe/<integrationId>`. It subscribes to:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`
- `checkout.session.expired`
- The existing `payment_intent` success/failure/cancellation and charge refund/dispute events used by ebooks and financial reconciliation.

Only a signed paid Checkout Session with matching donation, Session, store, integration, mode, USD amount and currency confirms the donation. A `payment_intent.succeeded` alone does not confirm this Checkout flow. Failed or unresolved processing is retried; duplicate events are idempotent. Status, refund/dispute facts and ledger changes are applied atomically by the restricted financial functions.

## Receipt and status

`GET /api/public/v1/donations/status/<publicToken>` and `/donations/receipt/<token>` report persisted status, amount, campaign and Foundation recipient. Donation purpose remains explicit. The immutable receipt snapshot and all historical donation/payment rows are preserved.

Status compatibility includes PENDING, PROCESSING, PAID, FAILED, EXPIRED, CANCELLED, REFUNDED, PARTIALLY_REFUNDED, DISPUTED, RELEASED and REVERSAL_REQUIRED. Historical `payoutStatus` fields remain compatible; an internal ledger state is not escrow, segregated Stripe cash or proof of a bank payout. No transfers or payouts are started by collecting a donation.

Policy pages: `/donations/terms`, `/donations/privacy`, `/donations/refunds`.
