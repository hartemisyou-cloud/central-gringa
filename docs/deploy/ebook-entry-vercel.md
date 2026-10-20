# Ebook entry flow on Vercel

This guide applies to `vercel-migration`, the PostgreSQL Neon + private Vercel
Blob application served at `hopehumanbooks.com`. It does not apply to the old
Supabase application on `main`.

## Runtime configuration

Set server-only variables in Vercel → `central-gringa` → Settings → Environment
Variables for the deployment environment being verified. Redeploy after changing
variables. Never put credentials in Git, chat, logs or a `VITE_*` variable.

| Variable | Required / function | Where to obtain the value |
| --- | --- | --- |
| `DATABASE_URL` | Required. TLS PostgreSQL connection for the existing restricted `central_runtime` login. | Keep the existing working Vercel value. If restoring configuration, Neon → existing project → Connect: select the application database and `central_runtime` role. Use its connection string with TLS, not the owner/migration connection. Preserve the existing role and database; do not create a replacement database. |
| `PAYMENTS_ENCRYPTION_KEY` | Required. Deciphers Stripe credentials and other integration secrets already saved in PostgreSQL. | Preserve the **exact existing value** from the deployment that encrypted those records, or the administrator's secure backup. A newly generated value cannot open the existing ciphertext. Do not rotate it for this change. |
| `BLOB_STORE_ID` | Required for the deployment's OIDC authentication path. Identifies the connected private ebook store. | Vercel → Storage → existing private Blob store → store settings/details. Connecting that store to `central-gringa` provides its store ID. Keep the existing connection and `v1/` files. |
| `BLOB_READ_WRITE_TOKEN` | Alternative Blob authentication when OIDC is unavailable. Optional when `BLOB_STORE_ID` and deployment OIDC work. | Vercel → Storage → existing private Blob store → access tokens/project connection. Use only the existing store's server-side token if this alternative is needed; do not expose it to the browser. |
| `ADMIN_PANEL_PASSWORD` | Required. Password for the existing `/admin` gate. | The password chosen by the administrator and saved in Vercel. Preserve it; it cannot be recovered from the application. |
| `ADMIN_SESSION_SECRET` | Required. Encrypts the secure, httpOnly `admin-gate` cookie; at least 32 characters. | Preserve the random secret already saved in Vercel or the administrator's secure backup. Replacing it invalidates current admin sessions. |
| `RESEND_API_KEY` | Required for automatic ebook delivery email after PAID; server-only. | The owner's Resend account, using its existing verified sender/domain. |
| `DELIVERY_EMAIL_FROM` | Required with the email key. Verified delivery sender. | The sender address verified in that account; never invent a sender address. |

Vercel supplies the rotating OIDC identity (`VERCEL_OIDC_TOKEN`) automatically;
it is not a user-created static credential. The installed Blob SDK uses an
explicit token first, then OIDC + store ID, then `BLOB_READ_WRITE_TOKEN`. The
application passes no explicit token, so OIDC can serve the private files
without a read-write token variable.

Stripe keys are **not** Vercel environment variables in this branch. The
existing `/admin` integration stores the publishable key and encrypted secret
key/webhook signing secret in `stripe_integrations`. Keep the existing active
TEST integration, account, integration ID and matching webhook signing secret.
There is no `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` environment fallback.
If a credential genuinely needs secure reconfiguration, enter it in `/admin`
from the same Stripe account and TEST environment; changing credentials is not
part of this entry-flow change.

Before publishing, execute the owner SQL in
`migrations/0006_orders_client_ip.sql` against the existing Neon database and
confirm the three nullable `orders` columns through its `information_schema`
query. This manual migration is separate from the historical Drizzle migration
with a `0006` prefix. Required order: **ALTER → publish → GET probe**.

## Entry and payment audit

`GET /comprar/{slug}` resolves only these six server-controlled products. The
local manifest identifies the product; the order's price is read from the
existing database through the same digital order path as API v1. Quantity is
always one, including a collection sold as one product.

| Slug | Product ID suffix | SKU | Catalog price | Files |
| --- | --- | --- | --- | --- |
| `the-adventures-of-tom-sawyer` | `000000000104` | `HHB-EB-020` | US$20 | 1 |
| `little-women` | `000000000105` | `HHB-EB-030` | US$30 | 1 |
| `adventures-of-huckleberry-finn` | `000000000106` | `HHB-EB-050` | US$50 | 1 |
| `moby-dick` | `000000000108` | `HHB-EB-100` | US$100 | 1 |
| `american-classics-collection` | `000000000110` | `HHB-COL-250` | US$250 | 6 |
| `american-classics-library` | `000000000111` | `HHB-LIB-500` | US$500 | 10 |

All six IDs have prefix `b0b5e000-4848-4b00-8000-`. An unknown slug returns
404. The route creates an ebook order and returns a 302 directly to
`checkout.stripe.com`. A Foundation Referer records `orders.origin_hhf`; it
does not change the ebook identity or authorize a download. Allowlisted UTMs,
`fbclid` and registry `ref` are persisted in `order_attribution`, never Stripe
metadata. The first `x-forwarded-for` hop, otherwise `x-real-ip`, is saved in
`orders.client_ip` and never added to any Stripe Session field.

These six GET entries use **Stripe-hosted Checkout Sessions**. The separate
legacy `/pay` flow still uses Stripe Elements + PaymentIntent for existing
storefront/API entries. The hosted line item uses the approved full native
catalog name, `E-book · {unique authors}` and the corresponding existing
storefront cover in both origins. Only the library's author description needs
the over-90-character abbreviation: first two authors plus ` e outros`.
The existing PaymentIntent description is
`Order {orderNumber}`. Its operational metadata includes `environment`,
`store_id`, `order_id`, `order_number`, `item_count`, `product_type`,
`delivery_type`, `sku`, `product_name`, `quantity` and `category`. For this
one-product digital flow, item count and quantity are `1`, product type is
`ebook` and delivery type is `digital`. The existing extra `store_id` is
preserved. Single-book database categories are `ebook`; the two bundle
categories are `collection`. For the new anonymous six-product entry only,
the two bundles' payment metadata is normalized to `category=ebook` as requested.
Catalog rows and existing customer/API v1/v2 purchases retain their categories.

HHF Session success uses exactly
`https://hopehumanbooks.com/order/{publicToken}?ret=1`. Native success uses the
request origin and `/order/{publicToken}` without the parameter. The entire
serialized Session parameters must pass the forbidden-string regex without
exceptions; there is no foundation domain in a success URL or any other field.

Every receipt uses the standard items and Download view. After 600 ms,
`location.replace` may return to
`https://www.hopehumanfoundation.org/thank-you?amount={Math.round(totalCents/100)}`
only if **all three** conditions hold: current URL has `ret=1`, the loaded
receipt confirms persisted `origin_hhf`, and database status is `PAID`.
The marker alone and old `hbb_from_hhf` browser storage cannot trigger it.
Without `ret=1`, there is no bounce, even after PAID. The verified webhook
records the allowlisted Checkout contact snapshot for conversion matching and
sends delivery email listing the ebooks. That email always links to
`https://hopehumanbooks.com/order/{publicToken}` without a parameter. Payment
confirmation and download authorization still depend on the verified webhook.

## Protected diagnostic

Sign in at `https://hopehumanbooks.com/admin` with the existing admin password.
The diagnostic uses the same encrypted `admin-gate` session cookie. A password
in a query string or Authorization header does not substitute for this cookie.
Export only your own administrative cookie to a private local cookie file,
then run:

```sh
curl --fail-with-body -i \
  --cookie /absolute/private/admin-cookies.txt \
  https://hopehumanbooks.com/admin/health-checkout
```

The response is JSON with `Cache-Control: no-store`. Environment checks expose
variable **names and defined-state only**, never values. Database/Stripe/Blob
checks expose sanitized status/errors, never credentials, connection URLs,
private ebook content, session secrets or checkout session URLs.

The dry-run is a real **unpaid TEST Checkout Session** for Little Women at the
current database price (catalog US$30), using the decrypted database integration.
It is a diagnostic only: it does not insert an order, reserve stock or mark
anything PAID. It exercises the same hosted builder used by `/comprar`; the
legacy Elements/PaymentIntent entry remains separate.
Each complete diagnostic invocation attempts at most one session. Do not pay
that diagnostic session; use the normal flow below to verify the webhook.

Expect HTTP 200 and this successful shape (the example contains only the
11-product Books catalog; `count` includes all database stores, whereas
`store_count` counts Books products):

```json
{
  "environment": {
    "defined": ["DATABASE_URL", "PAYMENTS_ENCRYPTION_KEY", "BLOB_STORE_ID", "ADMIN_PANEL_PASSWORD", "ADMIN_SESSION_SECRET"],
    "missing": ["BLOB_READ_WRITE_TOKEN"]
  },
  "postgres": { "connected": true, "error": null },
  "catalog": {
    "checked": true,
    "count": 11,
    "store_count": 11,
    "slugs": [
      { "slug": "the-adventures-of-tom-sawyer", "sku": "HHB-EB-020", "resolves": true },
      { "slug": "little-women", "sku": "HHB-EB-030", "resolves": true },
      { "slug": "adventures-of-huckleberry-finn", "sku": "HHB-EB-050", "resolves": true },
      { "slug": "moby-dick", "sku": "HHB-EB-100", "resolves": true },
      { "slug": "american-classics-collection", "sku": "HHB-COL-250", "resolves": true },
      { "slug": "american-classics-library", "sku": "HHB-LIB-500", "resolves": true }
    ],
    "error": null
  },
  "integration": {
    "checked": true,
    "exists": true,
    "environment": "test",
    "secret_decrypted": true,
    "publishable_key_present": true,
    "webhook_decrypted": true,
    "error": null
  },
  "blob": { "accessible": true, "error": null },
  "dry_run": { "environment": "test", "slug": "little-women", "checked": true, "amount_cents": 3000, "session_created": true, "error": null }
}
```

This example uses OIDC and therefore omits the optional
`BLOB_READ_WRITE_TOKEN` from `defined`; it can appear in `missing` without
making a valid OIDC deployment unhealthy. Deployments using that token report
its name in `defined` instead. No environment values appear. Without an admin
cookie, expect 401.
A completed diagnostic with an unsuccessful dependency check returns 503 and
the corresponding sanitized error stage. The session dry-run refuses LIVE
credentials rather than creating a live payment session.

## Manual verification

1. Confirm this change uses `vercel-migration`, the existing Neon database,
   private Blob store and TEST Stripe integration. Execute ALTER and confirm
   the schema before publish; after publication probe
   `GET https://hopehumanbooks.com/comprar/little-women` for 302 to Stripe,
   never 400. This US$30 probe is separate from the US$20 test purchase.
2. For the US$20 test, follow a real Foundation link to
   `https://hopehumanbooks.com/comprar/the-adventures-of-tom-sawyer?utm_source=test&utm_medium=manual&utm_campaign=livecheck-fix1&fbclid=IwARlivecheck`.
   Expect a 302 directly to Stripe TEST Checkout with title
   `The Adventures of Tom Sawyer — Mark Twain`, `E-book · Mark Twain`, US$20
   and the existing cover. No `/pay?via=hhf` hop is part of this entry.
3. Use cardholder `Hope Human`, a reachable test email and card
   `4242 4242 4242 4242`, any future expiry and any three-digit CVC, then pay.
4. Expect `/order/{publicToken}?ret=1`. The standard receipt remains pending
   and polls until the verified webhook confirms PAID; neither the URL nor
   browser storage can set PAID.
5. After PAID, the marked HHF receipt shows the purchase, waits 600 ms, consumes
   `ret` and replaces the page with
   `https://www.hopehumanfoundation.org/thank-you?amount=20`.
6. Confirm delivery email lists the work and its link has no marker. Open that
   link: expect the normal receipt and a working private Download without a
   bounce. Adding `ret=1` to a native order cannot redirect it. An unpaid order
   must not download a file.
7. Test an unknown `/comprar` slug (404). Check the Vercel server logs if a valid
   entry fails: structured stages distinguish `missing_env`, `db_unreachable`,
   `no_stripe_integration`, `decrypt_failed`, `blob_error` and `stripe_error`.
   Do not paste raw secrets or private receipt tokens into reports.

The donation subsystem, storefront/cart, policy pages, API v1/v2 contracts and
webhook URL/identity are retained. Meta CAPI and UTMify use the captured order
IP and verified Checkout contact snapshot, preserving server values and event
identity. Keep TEST mode; this guide does not activate LIVE payments.
