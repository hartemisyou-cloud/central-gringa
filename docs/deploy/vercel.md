# Hope Human Books ebook checkout on Vercel

This guide covers the `main` branch's existing TanStack Start + Vite application and
hosted Stripe Checkout purchases at `/comprar/<slug>`. It does not change product
mapping, prices, tracking, incoming redirects, or receipt behavior.

If `/comprar/little-women` renders and then displays
`Secure checkout is unavailable. Please try again later.`, use the protected diagnostic
below. Rendering HTML does not prove server access to Supabase or usable Stripe keys;
the home catalog also requires the privileged server database client.

## Build configuration

Keep the existing `vercel.json` and use Node.js 22:

```json
{ "framework": "tanstack-start", "buildCommand": "vite build", "installCommand": "bun install" }
```

`@lovable.dev/vite-tanstack-config` uses Nitro, which detects Vercel outside Lovable
and builds `.vercel/output/`. Deploy its server function and static assets together.
`NITRO_PRESET=vercel` can explicitly select the preset in another CI environment;
Vercel itself does not require this override.

## Environment variables: names, purpose and obtaining values

Set variables in **Vercel → Project → Settings → Environment Variables**, for the
Production and/or Preview environment actually being tested. Choose Secret for
privileged credentials; never prefix server secrets with `VITE_`.

| Name | Function | How to obtain the value |
|---|---|---|
| `SUPABASE_URL` | Server Data API and Storage endpoint. | Destination Supabase project → **Connect**: copy Project URL (`https://<project-ref>.supabase.co`). |
| `SUPABASE_SERVICE_ROLE_KEY` | Required privileged server database/storage access, bypassing RLS. | Destination project → **Settings → API Keys**: copy a server Secret key (`sb_secret_...`) or its legacy `service_role` key. The existing client supports both under this variable name. A publishable/anon key is not a substitute. |
| `SUPABASE_PUBLISHABLE_KEY` | Public Supabase client for SSR/auth middleware. | Copy the same project's publishable key from **Connect** or **Settings → API Keys**. |
| `VITE_SUPABASE_URL` | Browser endpoint embedded at build time. | Same destination URL as `SUPABASE_URL`; override the old committed `.env` value before building. |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Browser key embedded at build time. | Same publishable key as `SUPABASE_PUBLISHABLE_KEY`; set before building. |
| `ADMIN_PANEL_PASSWORD` | Existing `/admin` password gate. | Choose a strong administrator password and enter it directly in Vercel. |
| `ADMIN_SESSION_SECRET` | Encrypts the existing `admin-gate` httpOnly cookie. | Generate a cryptographically random secret of at least 32 characters, independently of the password. |
| `PAYMENTS_ENCRYPTION_KEY` | AES-GCM master key for database secrets, including saved integrations. | Reuse the original value when restoring encrypted rows. For a new database with no encrypted configuration, generate a random secret of at least 32 characters. A new value cannot decrypt old rows. Stripe env fallback does not recover other encrypted credentials. |
| `STRIPE_SECRET_KEY` | Server-only fallback when database Stripe credentials are unavailable or cannot decrypt. | Correct Stripe account → existing test environment → **Developers/Workbench → API keys**: copy `sk_test_...`, or a restricted test key with Account Read, Checkout Sessions Read/Write and PaymentIntents Read. Additional permissions are needed only for other existing operations that use this key. Never use a live key for these checks. |
| `STRIPE_WEBHOOK_SECRET` | Signing secret for the matching fallback endpoint. | Same Stripe test environment → **Webhooks/Event destinations** → endpoint for this deployment and persisted integration ID → reveal `whsec_...`. It is separate from the API key and a local Stripe CLI listener's secret. |

`SUPABASE_PROJECT_ID` and `VITE_SUPABASE_PROJECT_ID` appear in the old configuration
but are not read by the current ecommerce runtime. They may be updated for tooling
consistency. `/comprar/<slug>` hosted Checkout does not require
`STRIPE_PUBLISHABLE_KEY`, `STORE_API_KEY`, or a base URL variable. Its serving request
continues to determine Checkout and receipt origins.

Use a password manager's secure generator for the new Admin session/encryption
secrets (for example, 64 random characters); save them directly in Vercel and your
private vault, not in the repository. Preserve existing encryption keys as noted above.

The diagnostic inventories only the six requested server names: `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_PUBLISHABLE_KEY`, `PAYMENTS_ENCRYPTION_KEY`,
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`. Env Stripe keys are optional when valid
database credentials are used; the encryption key is required to decrypt those
credentials. An inventory reports presence, never values.

Create a **new deployment** after changing variables. Existing deployments keep their
original environment; changing `VITE_*` also requires rebuilding the browser bundle.
See [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys),
[Stripe API keys](https://docs.stripe.com/keys), and
[Vercel environment variables](https://vercel.com/docs/environment-variables).

## Stripe credential priority and webhook binding

For an ACTIVE integration bound to Hope Human Books, the central resolver first uses
a valid saved store/environment credential pair decrypted with
`PAYMENTS_ENCRYPTION_KEY`. Otherwise it uses the server-only
`STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` pair. Checkout creation, PaymentIntent
binding and webhook verification select the same pair without mixing sources.
An existing integration with an unknown account or an account different from the
fallback key fails safely; account, environment, and payment bindings remain
authoritative. Env fallback is restricted to the bookstore. Retired integrations
and other stores preserve their existing purpose-specific database credential
behavior so earlier payment confirmations continue to work.

If no integration exists, the purchase bootstrap creates only a persisted integration
link, without copying env secrets into the database. Its ID is deterministic per
store/environment, and the store link uses compare-and-set. Payments and Checkout
Sessions still reference a real persisted integration ID. The same resolver is used
when binding the PaymentIntent and verifying its webhook. Env keys do not bypass the
database, signature verification, or fulfillment checks.

Obtain the endpoint path from the authenticated diagnostic's
`integration.webhook_path` or, for an existing integration, from
`/admin → Stripe integration`. The diagnostic computes the same deterministic ID
as the purchase bootstrap if no integration exists; it does not write an integration
row. Prefix the path with the origin of the deployment being verified:

```text
https://hopehumanbooks.com/api/public/webhooks/stripe/<persisted-integration-id>
```

Create/select the endpoint for the deployment being tested in the same Stripe test
environment. Keep the existing PaymentIntent, refund/dispute and Checkout events:

- `payment_intent.succeeded`
- `payment_intent.payment_failed`
- `payment_intent.canceled`
- `charge.refunded`
- `charge.dispute.created`
- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`
- `checkout.session.expired`

Use that endpoint's actual `whsec_...` as `STRIPE_WEBHOOK_SECRET` for fallback, or save
it through Admin for database credentials. For first-time env setup:

1. Set the database/Admin variables and the test `STRIPE_SECRET_KEY`, then deploy.
2. Sign in at `/admin` and call `/admin/health-checkout` once. While the signing secret
   is missing, expect 503. Read `integration.webhook_path` after the database/catalog
   checks; this works before any integration row has been created.
3. Create the Stripe test endpoint with this deployment's origin plus that exact path,
   enable the events above, and copy its actual signing secret into
   `STRIPE_WEBHOOK_SECRET` in Vercel. Do not invent a signing secret or integration ID.
4. Redeploy and call the diagnostic once; expect 200 and test Session creation.
   That diagnostic Session must not be paid and does not exercise fulfillment.
5. Open `/comprar/little-women`. The purchase flow persists its integration link
   before creating the actual order/Session. Only now pay that normal test purchase;
   the endpoint has the correct key and persisted binding for its webhook.

Only a signature-verified webhook marks an order `PAID` and unlocks downloads;
a return URL does not prove fulfillment succeeded.

## Lovable Cloud limitation and a new Supabase project

The committed `.env` points to Lovable Cloud project `tebyssdwenfurpkokcop` with public
credentials only. Lovable Cloud does not provide its service role key/direct database
URL through the user's Supabase Dashboard. Those public values cannot give the Vercel
server the privileged access it needs. See
[Supabase's explanation of Lovable Cloud access](https://supabase.com/docs/guides/troubleshooting/identify-lovable-cloud-or-supabase-backend).

For a Supabase project under your own account:

1. Create a project in your organization and copy its URL, reference, publishable key,
   and server secret/service-role key. Keep the source backend running while preparing
   and verifying the destination.
2. **Obtain the complete base schema first.** This branch has no complete ecommerce
   schema migration: `supabase/` contains only `config.toml`, `drizzle/schema.ts` is
   empty, and recorded Drizzle migrations assume existing base tables. The catalog
   seed contains only INSERT/UPSERT statements. These files alone cannot recreate
   the required tables, RPCs and RLS in an empty project.
3. Request the official Lovable export: **More → Cloud → Overview → Advanced settings
   → Export project data → Database → Export → Start export**. Download the completed
   archive from the supplied link/Cloud Storage. It includes schema and data; storage
   files and project secrets must be moved separately.
4. Inspect the custom-format `.backup` with `pg_restore --list` (extract an outer ZIP
   first, if present), using PostgreSQL client tools with zstd support. Plan a selective
   restore of application tables, constraints, RLS, functions, triggers and sequences
   into the initialized Supabase destination. Preserve stock RPCs `reserve_stock`,
   `commit_order_stock` and `release_order_stock`. Account for existing managed schemas
   and roles; do not blindly restore the archive or add `--clean` to resolve conflicts.
   A custom archive cannot be pasted into the SQL Editor. Follow
   [Lovable's managed-backend migration guide](https://docs.lovable.dev/tips-tricks/external-deployment-hosting#host-backend-and-data-on-a-managed-provider-supabase-example).
5. After restoring the complete schema, run `docs/catalog/hope-human-books-seed.sql`
   in the new project's SQL Editor. It upserts the store and 11 products, not orders,
   integrations or tokens. Reconcile restored data before applying it. Drizzle
   migrations follow their journal order and do not run through `supabase db push`;
   do not reapply objects already present in the restored schema.
6. In Supabase **Storage**, create/verify bucket **`ebooks`**, with Public **off**.
   Download the existing files separately from Lovable Storage and upload the 10
   files in `docs/catalog/hope-human-books-provenance.json` to exact `v1/<file>` keys.
   Verify byte sizes and SHA-256 values against the manifest. The 11 catalog products
   include bundles made from those 10 files. Do not create public object URLs or
   anonymous download access. See
   [Supabase private buckets](https://supabase.com/docs/guides/storage/buckets/fundamentals).
7. Fill the Vercel variables above, overriding server and browser values, then redeploy.
   Preserve the original encryption key for restored settings, or explicitly
   reconfigure integrations. Stripe env fallback does not recover Meta/UTMify tokens.
8. Configure the persisted Stripe endpoint, then verify the diagnostic, catalog,
   payment, webhook `PAID` status and private download before normal traffic uses
   the new backend. Do not delete the original backend during this maintenance.

## Protected checkout diagnostic

`GET /admin/health-checkout` uses the existing Admin password/session gate. It returns
JSON in this order, with `Cache-Control: no-store`, `Vary: Cookie`, and noindex:

1. `environment`: `defined` / `missing` arrays containing names of the six variables.
2. `supabase`: `connected`, `service_role`, and `error`.
3. `catalog`: `slug: "little-women"`, `checked`, `exists`, and `error`.
4. `integration`: `checked`, `exists`, `secret_decrypted`, `webhook_decrypted`,
   `source` (`"database"`, `"environment"` or `null`), `webhook_path`,
   `decryption_error`, and `error`.
5. `dry_run`: `environment: "test"`, `checked`, `url_session_created`, and `error`.

Failure objects contain `stage`, `operation`, and a sanitized `message`. Later checks
remain unchecked when an earlier required step fails. `decryption_error` can be a
warning when valid env fallback still succeeds. The env path also checks the Stripe
account with `GET /account`, even before an integration row exists; restricted keys
therefore need Account Read as well as Checkout permissions.

Each complete authorized GET creates **one real, unpaid Stripe test Checkout Session**
using the unchanged normal builder and a Tom Sawyer fixture: `2000` USD, quantity `1`,
description `Order ORD-...`, and normal operational metadata including
`category=ebook`, `delivery_type=digital`, `item_count`, `order_number`,
`product_name`, `product_type`, `quantity`, and `sku`. Stripe's `mode` is `payment`;
test mode comes from the key and must return `livemode: false`. The diagnostic creates
no local order, customer, payment or stock reservation, sends no tracking, and returns
no Session URL. Do not poll it as an uptime endpoint or pay its diagnostic Session.

Sign in normally at `/admin`. For curl, export that browser's authenticated cookies
(including any `admin-gate` chunks) in Netscape cookie-file format to a private file
**outside the repository**, readable only by you. Do not put the Admin password,
cookie value, or any key in command arguments, shell history, PRs or logs. The existing
login is not HTTP Basic Auth.

```sh
chmod 600 /secure/path/admin-cookies.txt
curl --fail-with-body -i \
  --cookie /secure/path/admin-cookies.txt \
  https://hopehumanbooks.com/admin/health-checkout
```

Success: **200**, JSON content type, `Cache-Control: no-store`, successful privileged
Supabase/catalog checks, resolved credential source, and
`dry_run.url_session_created: true`. With env fallback,
`integration.secret_decrypted: false` is compatible with success. No response includes
an env value, credential, bearer token or Checkout URL.

Without a valid Admin cookie, expect **401** and no Stripe call:

```sh
curl -i https://hopehumanbooks.com/admin/health-checkout
```

A diagnostic failure returns **503** with the failed stage. Missing Admin server
configuration also returns 503. Structured server failure logs identify `missing_env`,
`db_unreachable`, `no_stripe_integration`, `decrypt_failed`, `stripe_error`,
`bad_origin`, or `rate_limit`, with sanitized technical detail. The buyer-facing
unavailable message stays unchanged.

## Verification

Run the repository checks:

```sh
bun install --frozen-lockfile
bunx vitest run --config vitest.checkout.config.ts
bunx tsc --noEmit
VERCEL=1 bun run build
```

Then verify the deployment manually:

1. Confirm the database-backed home catalog works and run the authorized diagnostic
   once; expect 200 and a test Session creation. This does not test webhook delivery.
2. In a fresh tab/session, open `https://hopehumanbooks.com/comprar/little-women`.
   The existing mapping must resolve **Little Women**, SKU `HHB-EB-030`, **USD 30.00**.
   The diagnostic's USD 20 fixture does not change this product price.
3. Confirm hosted `checkout.stripe.com` opens in **test mode**, quantity 1, with the
   correct book/price. If Stripe offers local currency, select USD for comparison.
4. Enter public test card `4242 4242 4242 4242`, a future expiry, any three-digit CVC,
   and an email/name intended for testing. Submit once; never use a real card or live
   Session for this verification. See [Stripe testing](https://docs.stripe.com/testing).
5. Confirm Stripe returns to unchanged `/order/<public-token>`. The verified webhook
   must mark the order `PAID` and enable the Little Women download. A delayed webhook
   may briefly show `Waiting for payment confirmation`; receipt polling is every 3s.
6. Check the existing conditional redirect separately through the already-working
   incoming Foundation link. Its local `hbb_from_hhf` flag causes the receipt to
   redirect after about 600 ms to
   `https://www.hopehumanfoundation.org/thank-you?amount=30`. Direct Books visits
   without the flag stay on the receipt. Do not alter the incoming redirect or
   `src/routes/order.$token.tsx`; verify `PAID` independently if the receipt redirects
   before webhook processing finishes.
7. Check the unchanged PageView/InitiateCheckout, webhook CAPI Purchase, UTMify,
   noindex, Origin validation, rate limit and paid-only delivery behavior. The
   diagnostic does not exercise tracking or fulfillment.
