# Hosted Checkout for the digital bookstore entry

This change targets `vercel-migration`, the existing Vercel + Neon PostgreSQL +
private Blob deployment. It replaces only `/comprar/{slug}` payment collection:
the server creates the same digital order and redirects directly to Stripe
Checkout. HHF and native purchases share the ebook identity, receipt and
authorized downloads. The verified webhook also supplies delivery email and
customer data for Meta/UTMify. The embedded `/pay` entry, public API v1/v2,
donation subsystem and existing catalog prices/files are retained.

## Purchase parameters

The six existing slug/product mappings and shared `orders:{store}:{IP}` quota
remain. Order prices and quantities come from the persisted database order
snapshot, never query parameters or the local manifest price. Displayed names
use the approved native catalog identity for the selected slug.
Only one digital product, quantity one, in USD is accepted. A bundle is one
product and still unlocks its existing catalog files after PAID.

Production and the protected health diagnostic use the same
`buildEbookCheckoutSessionParams` builder:

- `mode=payment`; Stripe API `submit_type=pay` identifies a purchase submission.
  Stripe controls the localized button label. Literal `Buy` is not a supported
  API enum.
- One `line_items` entry, quantity one, with the database price and existing
  native full product name, including the collection name/count for bundles.
  Description is `E-book · {unique authors}`. Descriptions over 90 characters
  use the first two authors plus ` e outros`; only `american-classics-library`
  needs this abbreviation. Both origins use the same six existing storefront
  covers; no replacement artwork is added.
- `payment_intent_data.description=Order {order_number}`.
- Session and PaymentIntent metadata use exactly the existing operational
  allowlist: `store_id`, `order_id`, `order_number`, `environment`,
  `product_name`, `product_type`, `category`, `quantity`, `sku`, `item_count`,
  `delivery_type`. No customer, campaign, attribution or marker fields are added.
- `customer_email` is omitted; Stripe collects contact information on its page.
  A verified, locally bound Session supplies an allowlisted customer snapshot
  in `orders.checkout_customer_details` for delivery email and conversion data.
  `orders.client_ip` captures the first `x-forwarded-for` hop, otherwise
  `x-real-ip`, on entry. That IP is never added to a Stripe Session field.
- A persisted HHF order uses exactly
  `https://hopehumanbooks.com/order/{publicToken}?ret=1`; native success uses
  the request origin and `/order/{publicToken}` without a marker. Cancel returns
  to `/comprar/{slug}` on the request origin. No Session field contains the
  foundation domain; the previous success-URL exception is removed.
- Idempotency key: `checkout:create:{order_id}:{attempt}`. Creation parameters
  use the persisted attempt timestamp and order snapshot so retries stay stable.

The requested 30-minute expiry includes a fixed **60-second transport margin**:
`expires_at = floor(attempt.created_at / 1000) + 1860`. Stripe requires at least
30 minutes after its own Session creation, so exactly 1800 seconds from an
earlier database write can fall below its minimum during transport. A bound
Session retry uses GET to retrieve the same Session; an unbound attempt that
has exhausted the margin fails safely without changing parameters under the
same idempotency key or silently creating another attempt.

The server validates the returned Session's mode, environment, amount,
currency, metadata and HTTPS checkout.stripe.com destination before exposing
the redirect. Binding the `cs_...` ID, append-only payment audit and order
processing status is one atomic PostgreSQL statement. The current runtime
permissions are retained; `payment_events` is never read by this flow.

## Signed confirmation

The existing webhook URL and signature verification remain unchanged:
`/api/public/webhooks/stripe/{integrationId}`.

Before publishing, enable these events on that existing **TEST** endpoint:

1. `checkout.session.completed`.
2. `checkout.session.async_payment_succeeded` for eligible delayed methods.

Retain the endpoint's existing PaymentIntent, refund, dispute and donation
subscriptions. Keep the same account, integration ID and signing secret.
Subscription changes are an operational step, not performed by this PR.

Checkout events must match the persisted Session/payment attempt, order,
integration, environment, value and currency. Metadata alone cannot bind an
unrelated Session. The payment provider ID is atomically rebound from `cs_...`
to the resulting `pi_...`; the original Session ID remains in the append-only
payment audit. An unpaid completed Session only associates its PaymentIntent;
it does not authorize downloads.

Paid Session events reuse the existing PaymentIntent success pipeline. A
row-locked stock guard prevents simultaneous Session and PaymentIntent events
from committing stock twice. Repeated events preserve `paid_at` and refund
states. The signed webhook is still the only source of PAID; success URLs and
browser claims never unlock a file.

Both origins render the standard receipt with purchased items and Downloads.
The browser returns to the foundation after 600 ms only when all three hold:
the current URL contains `ret=1`, the receipt confirms persisted `origin_hhf`,
and its status is `PAID`. The marker alone and legacy browser storage cannot
trigger a return. Without the marker, including after PAID, the receipt stays
on Books. Delivery email lists the purchased ebooks and always links to
`https://hopehumanbooks.com/order/{publicToken}` without a query parameter.

`checkout.session.expired` is not implemented or required by this change. A
cancel returns to the requested GET entry, which creates another order and
Session and immediately redirects to Stripe again. It is not a stationary
cancel page and does not mark the earlier order CANCELLED or release its
reservation. Expired/abandoned orders retain the existing reservation lifecycle;
this PR does not add an order cleanup process.

## Configuration and diagnostic

Run the owner SQL in `migrations/0006_orders_client_ip.sql` and confirm its
`information_schema` result before publishing. It adds nullable `client_ip`,
`checkout_customer_details` and `delivery_email_sent_at` columns to `orders`.
Delivery email requires server-only `RESEND_API_KEY` and a verified sender in
`DELIVERY_EMAIL_FROM`; missing configuration is logged as `not_configured`.
Stripe keys remain encrypted in PostgreSQL with the existing
`PAYMENTS_ENCRYPTION_KEY`; there is no Stripe environment-key fallback. Existing
Neon, private Blob, admin session, ACL and Stripe API version are preserved.

`/admin/health-checkout` uses the same admin gate and reports the same JSON
shape as before. Its one unpaid TEST Session now uses the production builder,
Little Women at the database price (catalog US$30), and an ephemeral diagnostic
order ID/token. It inserts no order/payment and reserves no stock. Never pay
the diagnostic Session. Expected successful fields include HTTP 200,
`dry_run.amount_cents=3000`, `session_created=true`, `error=null`.

## Verification in TEST after publication

1. Follow **ALTER → publish → probe**. After confirming the schema and
   publication, GET `/comprar/little-women` must return 302 to Stripe, never
   400. Little Women costs US$30; this probe is separate from the US$20 payment.
2. For the US$20 HHF purchase, follow a Foundation link to
   `https://hopehumanbooks.com/comprar/the-adventures-of-tom-sawyer?utm_source=test&utm_medium=manual&utm_campaign=livecheck-fix1&fbclid=IwARlivecheck`.
   Expect HTTP 302 directly to checkout.stripe.com in TEST, with
   `The Adventures of Tom Sawyer — Mark Twain`, US$20 and
   `E-book · Mark Twain`, plus the existing Tom Sawyer cover.
3. Pay with test card `4242 4242 4242 4242`, a future expiry and CVC `123`.
   Use cardholder `Hope Human` and a reachable test email. Expect
   `/order/{token}?ret=1`. The standard receipt waits for the signed webhook;
   once PAID, it shows the purchase and returns to
   `https://www.hopehumanfoundation.org/thank-you?amount=20`.
4. Cancel a separate unpaid Checkout. Inspect the intermediate return to
   `/comprar/{slug}` and its new 302 to another Session, as required above.
5. In Stripe TEST, confirm the Session and PaymentIntent have the same
   operational metadata, and the PaymentIntent description is `Order ORD-...`.
   Apply the full forbidden-string regex to the entire serialized Session
   parameters for both HHF and native: zero matches, with no field exceptions.
6. Verify a repeated completed event and a PaymentIntent success event do not
   repeat the stock commit, change the paid timestamp or revoke downloads.
7. Confirm the delivery email lists the purchased work. Its unmarked order
   link must show items and a working Download without any bounce, including
   with stale legacy browser storage. A native order never returns to the
   foundation, even if `ret=1` is added manually. Verify an existing embedded
   `/pay` purchase still works; it remains a separate payment entry.

The hosted page's eligible wallets, Link/Amazon Pay and displayed business name
come from Stripe and the existing account profile, not new application UI.

Primary references: [Checkout Session creation](https://docs.stripe.com/api/checkout/sessions/create)
and [hosted Checkout fulfillment](https://docs.stripe.com/checkout/fulfillment?payment-ui=stripe-hosted).
