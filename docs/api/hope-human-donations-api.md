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

## Campaign manifest v1 (source SHA8e93)

`docs/donations/campaign-manifest.v1.json` lists 54 trusted slug/title pairs; `campaign-manifest.v1.seed.sql` imports them idempotently as `review_status = PENDING`, `active = true`, no beneficiary. The manifest authorizes listing only — no creator accounts, verified campaign claims, beneficiary mappings, approvals or releases. The catalog shows these campaigns with `ready: false`, and global `ready` stays `false` until configuration is complete, so the checkout should explain "configuration pending" and keep Continue disabled.

## Real-funds constraints (release gates)

- The internal held ledger does not segregate or reserve Stripe cash. Automatic bank payouts can remove available balance, so release is blocked until a human confirms a manual payout schedule.
- Release is blocked unless the full creator USD amount plus the NGO fee coverage is actually available, after setting aside every other held donation. Fees are never deducted from the creator, and other held donations never pay for them.
- Release is blocked until the actual Stripe hold limit for the platform country (`max_hold_days`) is configured. Donations held longer than that limit are blocked and flagged for reconciliation. This is not escrow and there is no unlimited hold.
- Separate transfers do not reverse automatically after refunds or disputes. The donation is flagged REVERSAL_REQUIRED (recovery/reconciliation needed) and release is frozen. Funds are never reported as recovered unless they actually are.
- A transfer moves funds into the creator's Stripe balance. That is not a bank payout; the creator's own payout schedule controls when money reaches their bank.
- The NGO covers processing and Connect fees. Optional Adaptive Pricing currency conversion fees are disclosed to the donor by Stripe and are not "zero fees".
- A recipient country counts as eligible only if the real account/allowlist capability eligibility is confirmed. General Stripe country availability is not enough.

## Financial correctness (revision after review)

- **Checkout retries.** Before calling Stripe, the full Checkout Session request is stored and cannot change afterwards. That includes the fixed 8-letter `integration_identifier`, the origin, recipient and campaign. Every retry sends the same request under `donation-checkout:<id>`. The Session Stripe returns (id, url, livemode, amount, currency, client_reference_id, metadata) is checked before it is saved.
- **Webhooks.** State, total refunded amount (only ever increases), dispute flag (stays set), ledger entry and the in-flight release marker are all applied in one locked database function, `donation_apply_event`, which only the server can call.
  - Duplicate events are recognised by Stripe event id.
  - Events that cannot yet be linked to a donation are retried, not acknowledged.
  - A paid Session after a card decline still confirms the payment.
  - Refund or dispute facts recorded before payment confirmation are kept.
- **Releases.** Handled by `donation_release_reserve` / `donation_release_mark`, which add a lock per platform account and store a durable operation: RESERVED → SUBMITTED → SUCCEEDED | UNKNOWN | FAILED. FAILED is used only for a clear Stripe rejection.
- **Status contract** is unchanged. `payoutStatus` now reports `RELEASE_IN_PROGRESS` for RESERVED/SUBMITTED/UNKNOWN.
- Configuration plan: `docs/deploy/hope-human-donations-connect-plan.md`.

## Provider-verified account model (compatibility guard)
Every fresh recipient read (new/retried Session, new/resumed transfer, admin verify, hosted onboarding link) calls Accounts v2 retrieve with `include: ["configuration.recipient","identity","defaults"]` and compares ACTUAL provider values with the locally human-approved model:
- `defaults.responsibilities.fees_collector` must be `application` and `losses_collector` must be `application`; the local approval must be negative balance liability `PLATFORM`.
- Top-level `dashboard` must equal the human-selected model (`EXPRESS` → `express`, `NONE` → `none`).
- Returned `livemode` must match the expected integration mode (original integration for retries/releases), and the returned account id must equal the registry/snapshot account.
- Missing, unknown, `stripe`, `full`, and legacy `application_express`/`application_custom` values all fail closed as pending (no approved compatibility path yet). The code never selects or changes these provider settings.
- Onboarding: responsibilities, dashboard, mode, country and account ownership are required before a link is created; a pending transfers capability does NOT block beginning onboarding (onboarding completes it). Sessions and transfers still require it `active`.

This is compatibility validation only, not a forecast of future fees. With separate charges the platform already pays processing fees regardless of `fees_collector`. The full original USD principal is transferred to the recipient's Stripe balance; it is not a guarantee of bank net proceeds after payout/FX fees. Actual configured fee/payout/FX coverage remains an external activation check for a human.

## FINAL NARROW SCOPE: direct NGO collection (supersedes acceptance rules above)
Hope Human Foundation receives each donation for the selected campaign. New donations persist `beneficiary_id = NULL` and `beneficiary_snapshot = NULL` plus an immutable `receipt_snapshot` (purpose `donation`, Foundation recipient, campaign, use of funds). No recipient is auto-assigned or fabricated; a future transfer is unavailable until a separate human-verified flow is designed.

Collection eligibility (catalog `ready`, create, retry and `/donations/pay/<token>`) requires only: known ACTIVE campaign (review may stay PENDING, not past `ends_at`), supported USD preset, ACTIVE store, ACTIVE integration with key and platform account, store/integration mode match, original integration/account/mode binding on retries, and the collection switch. It does NOT read Accounts v2 or require campaign review, beneficiary/KYC, Connect, fee reserves, payout schedule, hold limits or release settings. Catalog always lists every campaign entry (54 in production) even when not ready.

- TEST: may create native Stripe-hosted Sessions without a webhook signing secret. Without it nothing can become PAID; only a verified signed matching webhook confirms payment, so receipts stay PENDING/PROCESSING.
- TEST-only default (documented fallback, no DB write): when NO `donation_settings` row exists and store + integration are ACTIVE/test with key and account, collection is on. All release/onboarding/live-approval fields stay off/null and `confirmed_by` stays null. Any saved row wins; `donations_enabled=false` always closes collection. /admin shows this effective default and switching off = uncheck "Accept donations" and save.
- LIVE: requires webhook signing secret, Stripe fundraising approval, legal account-name confirmation, a use-of-funds text, human confirmation and explicit `donations_enabled`. No fallback, no bypass.
- `/pay` only blocks NEW local redirects; an already-open Stripe page is not revoked.

Deferred and OFF (not part of this scope): beneficiary onboarding, Connect, reserves, payouts/releases. Known release activation blocker: CAMPAIGN_END release timing based on `ends_at` is not designed/verified; releases must stay OFF until it is.

Remaining setup for TEST collection to confirm payments: add the TEST webhook signing secret through the secure Stripe integration form in /admin.
