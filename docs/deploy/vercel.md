# Deploying the Hope Human Books central on Vercel

> **Migration target:** Vercel hosting, server-only PostgreSQL and private Vercel Blob.
> This isolated source copy removes Supabase from the application runtime. The published
> Lovable central remains the production source until the destination, data, credentials
> and payment flow have been verified and the domain cutover is complete. Local checks
> do not establish that a Vercel deployment or domain change has occurred.

The active donation flow is Foundation site → `hopehumanbooks.com/donations/start` →
Central Books bridge → Stripe-hosted Checkout. The former separate checkout stays outside
this flow. Donations keep their donation identity and existing TEST/LIVE gates; ebook
orders, catalog and private downloads remain separate. See
[`donation-start-handoff.md`](./donation-start-handoff.md) for the handoff contract and
[`migrations/README.md`](../../migrations/README.md) for the database restore contract.
[`architecture.md`](./architecture.md) describes the authorized destination and the
boundaries between donation collection, ebook fulfillment and administration.

## Build configuration

Use Node.js 22. `@lovable.dev/vite-tanstack-config` already runs Nitro on production builds;
outside the Lovable sandbox Nitro auto-detects Vercel (`VERCEL=1`) and uses the `vercel`
preset. Do not add a second Nitro plugin or configure a static-only SPA deployment.

`vercel.json` (repo root):

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "tanstack-start",
  "buildCommand": "vite build",
  "installCommand": "bun install --frozen-lockfile"
}
```

The reviewed migration passed 184 local tests, TypeScript checking, frozen-lockfile
installation and a Vercel-style build. The build produced `.vercel/output/` with
`config.json`, `static/` and `functions/__server.func`. The database restore was also
checked with native PostgreSQL. Repeat relevant checks after changes, and validate the
actual hosted application before cutover.

## Environment variables (names read by the code)

Server-only (Vercel → Project → Settings → Environment Variables):

| Name | Requirement |
| --- | --- |
| `DATABASE_URL` | TLS PostgreSQL connection for the restricted `central_runtime` login, never the provider owner/migration connection. `prepare: false` is configured for pooler compatibility. |
| `ADMIN_PANEL_PASSWORD` | Strong password for the Central's own `/admin` login. |
| `ADMIN_SESSION_SECRET` | Random value of at least 32 characters for the encrypted, secure, httpOnly admin cookie. |
| `PAYMENTS_ENCRYPTION_KEY` | The **same exact value as the source Central**. Imported Stripe keys, webhook secrets and other integration tokens remain encrypted with this key. A replacement value cannot decrypt them. |
| `BLOB_STORE_ID` | Connected **private** Vercel Blob store. The SDK can use the deployment's rotating OIDC identity with this store ID. |
| `BLOB_READ_WRITE_TOKEN` | Alternative server-only Blob authentication when a separately approved token is used. Local upload can use this token; never expose it to clients. |

Migration-only variables, configured locally through a secure mechanism and excluded from
the deployed application:

| Name | Requirement |
| --- | --- |
| `MIGRATION_DATABASE_URL` | Separate administrative connection able to create roles and restore the destination. Use the provider's direct connection for migration. |
| `CENTRAL_RUNTIME_PASSWORD` | Random password of at least 32 bytes used when initially creating `central_runtime`. Role setup preserves an existing password on repeat runs. |

Never place values in chat, Git, command logs, public JavaScript or `VITE_*` variables.
The destination needs no Supabase variables, SDK, Auth service or public database API.
If the Marketplace injects an administrative `DATABASE_URL`, replace it with the
`central_runtime` connection before deploying the application. Do not give the runtime
the provider's administrative credentials under another variable name.

No base-URL variable is required: payment, receipt and webhook URLs are derived from the
serving request. The destination can be tested on its `*.vercel.app` address before
`https://hopehumanbooks.com` is connected. Production canonical metadata remains Books.

Stripe secret keys and webhook signing secrets are not checkout-project environment
variables. They are managed through the Central's authenticated `/admin` and stored
encrypted in PostgreSQL. Preserve imported integrations, IDs and existing gates. If the
original encryption key is unavailable, stop activation and arrange explicit secure
reconfiguration of the affected integrations; do not silently reset their ciphertext.

## Database restore

Use PostgreSQL 17 or newer. The source schema and complete historical data come from the
authoritative export, not catalog seeds. Keep the backup and private data export outside
the repository, and retain the source deployment during migration.

1. Provision the approved destination and configure `MIGRATION_DATABASE_URL` and
   `CENTRAL_RUNTIME_PASSWORD` securely. Run `node scripts/setup-database-roles.mjs`.
   Roles must be created through this SQL script: `central_owner` is restricted NOLOGIN;
   `central_runtime` is LOGIN, NOINHERIT, NOBYPASSRLS, owns no objects and has no role
   memberships. A provider-created administrative role is not a substitute for runtime.
2. Revalidate that the export contains no legacy Auth users and that `profiles` and
   `user_roles` are empty. The reviewed portability changes remove only their two
   `auth.users` foreign keys. If this condition changes, revise the migration explicitly.
3. Import the real private data export using the command below. The script refuses a
   populated destination; it does not clear or reseed it.
4. The importer validates all 35 COPY blocks and their column order, applies pre-data
   schema, imports rows, verifies counts and canonical hashes, and applies post-data
   constraints/triggers plus server ACL in one transaction. Preserve all historical IDs,
   tokens, payment events, financial snapshots, stock state and encrypted integrations.
5. Verify the committed result and restricted runtime permissions. The reviewed local
   snapshot restored 35 tables and 379 rows with matching hashes. Those counts describe
   that snapshot; a later source snapshot may contain additional legitimate records.

```sh
node scripts/migrate-database.mjs --apply --auth-users-empty-confirmed --data /absolute/private/public-data.sql
```

Replace the final argument with the actual private export path. RLS remains enabled on
all 35 tables. Runtime receives the reviewed operations on 29 active tables and EXECUTE
on exactly nine server RPCs. PUBLIC has no database/schema application access or
financial-function EXECUTE; the six historical tables remain preserved without runtime
grants. Do not relax these permissions to make deployment pass. Detailed schema
adaptations and known source risks are in the migration README.

## Private ebook storage

The ten books are separate from the database export and source repository. Preserve
their exact bytes, provenance hashes and `v1/` paths in a private Vercel Blob store.

1. Connect the approved private store to the destination project and intended deployment
   environments. Configure the SDK's OIDC/store identity or approved server-only token.
2. Keep the source ebook directory outside the repository. With approved Blob access,
   run `node scripts/upload-ebooks.mjs /absolute/private/ebook-directory --apply`.
3. The script checks every source against `docs/catalog/hope-human-books-provenance.json`
   before the first upload, refuses a different existing destination file and verifies
   each uploaded book by reading it back and comparing its hash.
4. Test `/api/public/v1/downloads/{publicToken}/{workId}`: unknown/unpaid orders and titles
   outside the purchased SKU must fail. A verified PAID order can stream only its allowed
   file with `cache-control: private, no-store`. Never replace this route with public Blob
   URLs or unlock downloads based on redirect parameters.

## Activation and domain cutover

1. Deploy the isolated migration branch with restricted runtime credentials and all
   required secrets. Avoid pushing this backend replacement to the connected Lovable
   production branch during preparation. Inspect the build and server logs without
   exposing credentials or private records.
2. Verify the storefront, all catalog entries, the unchanged books, admin login/session
   protection, API authorization, rate limiting and private download authorization on the
   Vercel address. Confirm that imported integration secrets can actually be decrypted.
3. Verify the webhook route shown in admin, `/api/public/webhooks/stripe/{integrationId}`,
   with signed TEST events. Test ebook PaymentIntent and donation Checkout Session events,
   payment failure, refund/dispute handling and retry/duplicate behavior as applicable.
   Keep endpoint URLs, integration IDs and their matching signing secrets aligned. A
   separate preview endpoint has its own secret; do not replace the production endpoint's
   secret accidentally. If the final domain and path remain unchanged, preserve the
   existing matching endpoint configuration.
4. Complete the donor flow in TEST and verify receipt/return behavior. Keep current
   TEST/LIVE settings, human approvals, kill switch and disabled release/onboarding gates.
   Migration does not authorize activating LIVE collection or releases.
5. Coordinate a consistent final source snapshot and incoming writes/webhooks before
   cutover. A successful earlier import does not include subsequent source changes.
   Prevent the old and new databases from processing different parts of one payment;
   reconcile in-flight events and verify the final destination before switching traffic.
6. Connect `hopehumanbooks.com` only after these checks pass. Verify DNS/TLS and repeat
   Foundation → Books → Stripe in a browser on the final domain, including the actual
   Books referrer, session URLs, signed webhook delivery, receipt and authorized download.
   Browser referrer minimization does not guarantee that Stripe cannot associate sites.
7. Keep the previous deployment and backup available for rollback. Once the new database
   receives writes, rolling traffic back also requires reconciling those writes and
   webhook deliveries; a DNS reversal alone is not a complete data rollback.
