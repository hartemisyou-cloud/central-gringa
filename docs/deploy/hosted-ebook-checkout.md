# Hosted Checkout for the digital bookstore entry

This change targets `vercel-migration`, the existing Vercel + Neon PostgreSQL +
private Blob deployment. It replaces only `/comprar/{slug}` payment collection:
the server creates the same digital order and redirects directly to Stripe
Checkout. The embedded `/pay` page, public API v1/v2, receipt/downloads,
donations, catalog and tracking modules are unchanged.

## Purchase parameters

The six existing slug/product mappings and shared `orders:{store}:{IP}` quota
remain. Order prices, quantities and displayed names come from the persisted
database order snapshot, never query parameters or the local manifest price.
Only one digital product, quantity one, in USD is accepted. A bundle is one
product and still unlocks its existing catalog files after PAID.

Production and the protected health diagnostic use the same
`buildEbookCheckoutSessionParams` builder:

- `mode=payment`; Stripe API `submit_type=pay` identifies a purchase submission.
  Stripe controls the localized button label. Literal `Buy` is not a supported
  API enum.
- One `line_items` entry, quantity one, with the database price and the existing
  displayed `Title — Author` name. Its description is
  `Order {order_number} · Digital delivery, no shipping`.
- `payment_intent_data.description=Order {order_number}`.
- Session and PaymentIntent metadata use exactly the existing operational
  allowlist: `store_id`, `order_id`, `order_number`, `environment`,
  `product_name`, `product_type`, `category`, `quantity`, `sku`, `item_count`,
  `delivery_type`. No customer, campaign, attribution or marker fields are added.
- `customer_email` is omitted; Stripe collects contact information on its page.
  This change adds no contact synchronization to local customers or tracking.
- Success returns to `/order/{publicToken}` with no query parameters. Cancel
  returns to `/comprar/{slug}`. Origins come from the request, following the
  existing deployment architecture; production resolves to hopehumanbooks.com.
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

`checkout.session.expired` is not implemented or required by this change. A
cancel returns to the requested GET entry, which creates another order and
Session and immediately redirects to Stripe again. It is not a stationary
cancel page and does not mark the earlier order CANCELLED or release its
reservation. Expired/abandoned orders retain the existing reservation lifecycle;
this PR does not add an order cleanup process.

## Configuration and diagnostic

No environment variable, credential, schema, ACL or Stripe API version changes
are needed. Keys remain encrypted in PostgreSQL and use the unchanged
`PAYMENTS_ENCRYPTION_KEY`; there is no environment-key fallback. Existing Neon,
private Blob and admin session configuration is preserved.

`/admin/health-checkout` uses the same admin gate and reports the same JSON
shape as before. Its one unpaid TEST Session now uses the production builder,
Little Women at the database price (catalog US$30), and an ephemeral diagnostic
order ID/token. It inserts no order/payment and reserves no stock. Never pay
the diagnostic Session. Expected successful fields include HTTP 200,
`dry_run.amount_cents=3000`, `session_created=true`, `error=null`.

## Verification in TEST after publication

1. Use a clean browser session for this purchase test. The unchanged legacy
   `hhf-return` helper is session-scoped; a flag left by another legacy flow can
   still affect an order page. This entry neither reads a Referer nor appends
   `via` nor writes that flag, and this change does not modify that helper.
2. Open
   `https://hopehumanbooks.com/comprar/the-adventures-of-tom-sawyer`.
   Expect HTTP 302 directly to checkout.stripe.com in TEST, with
   `The Adventures of Tom Sawyer — Mark Twain`, US$20 and
   `Order ORD-... · Digital delivery, no shipping`.
3. Pay with test card `4242 4242 4242 4242`, a future expiry and CVC `123`.
   Expect `/order/{token}`. Pending receipts keep waiting until the signed
   webhook confirms PAID; then the existing purchase confirmation and private
   download appear. No new marker or redirect is introduced.
4. Cancel a separate unpaid Checkout. Inspect the intermediate return to
   `/comprar/{slug}` and its new 302 to another Session, as required above.
5. In Stripe TEST, confirm the Session and PaymentIntent have the same
   operational metadata, and the PaymentIntent description is `Order ORD-...`.
   Stripe's built-in object fields are distinct from this metadata allowlist.
6. Verify a repeated completed event and a PaymentIntent success event do not
   repeat the stock commit, change the paid timestamp or revoke downloads.
7. Verify an existing embedded `/pay` purchase still works. No new Checkout
   behavior applies to storefront/API orders.

The hosted page's eligible wallets, Link/Amazon Pay and displayed business name
come from Stripe and the existing account profile, not new application UI.

Primary references: [Checkout Session creation](https://docs.stripe.com/api/checkout/sessions/create)
and [hosted Checkout fulfillment](https://docs.stripe.com/checkout/fulfillment?payment-ui=stripe-hosted).
