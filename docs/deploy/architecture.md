# Chosen deployment architecture (Hope Human Books)

> **Migration state:** the isolated Vercel source has been prepared and tested locally.
> The approved cloud resources are being provisioned. Destination deployment, final data
> synchronization and domain cutover are still required; this document does not claim
> that production has moved. Keep the current Lovable deployment available until the
> destination and payment flow pass the activation checks in [vercel.md](./vercel.md).

```text
Donor on hopehumanfoundation.org
  └─ chooses campaign + amount, clicks Donate
       └─ POST https://hopehumanbooks.com/donations/start
            └─ Central Books /donations/pay/{publicToken}
                 └─ official Stripe-hosted Checkout

Central at hopehumanbooks.com (Vercel migration target)
  ├─ server-only PostgreSQL / Neon
  │    ├─ restricted central_runtime connection
  │    └─ separate central_owner + administrative migration connection
  ├─ private Vercel Blob / v1/ ebook files
  ├─ /admin  own password + encrypted secure session
  ├─ /api/public/v1/*  authenticated store API and donation endpoints
  ├─ /pay/{publicToken}  existing ebook payment flow
  ├─ /order/{publicToken}  receipt + PAID-gated ebook downloads
  └─ /api/public/webhooks/stripe/{integrationId}  verified payment confirmation
```

The separate `hopehumanfoundations.org` checkout remains outside the active donation
handoff. The Foundation browser posts the chosen amount directly to the Central; no
store API credential or Stripe secret is included in that form. The Central resolves
the store, checks the exact Origin allowlist, validates the amount and collection gates,
and reuses the existing donation service and idempotency rules.

The Books bridge immediately opens the persisted, validated Stripe Checkout URL. It
sets an origin-only referrer policy; verify actual browser behavior after deploying on
the final domain. This minimizes forwarded URL data, without guaranteeing that Stripe
cannot associate the sites. The transaction remains a donation to the disclosed
Foundation recipient. The storefront keeps its books and existing ebook commerce; no
ebook purchase is substituted for a donation. See
[donation-start-handoff.md](./donation-start-handoff.md) for the route contract.

## Backend and data boundaries

The destination runtime uses explicit parameterized PostgreSQL queries and the existing
financial functions. It needs no Supabase SDK, hosted Auth service, REST database API or
service-role credential. The active admin authentication belongs to the Central itself.

`central_owner` owns the schema and objects but cannot log in. The app uses only
`central_runtime`, without object ownership, role memberships, CREATE privileges or RLS
bypass. RLS remains enabled on all 35 tables; grants and server policies allow the
reviewed operations on 29 active tables and exactly nine RPCs. Six historical tables
are preserved without runtime access. Provider administrative credentials are used only
for migration, never by the deployed application.

Restore the authoritative schema and all historical rows, preserving IDs, tokens,
snapshots, integration ciphertext and financial state. Catalog seeds are not a migration
replacement. Keep backup/data exports and ebook files outside Git. The two removed
legacy Auth foreign keys are valid only for the reviewed empty-Auth snapshot; revalidate
that condition for the final import. See
[migrations/README.md](../../migrations/README.md) for the restore and ACL contract.

The ten ebook files keep their provenance hashes and `v1/` paths in a private Blob store.
Only a server route can read and stream a book after checking the order's webhook-set
`PAID` status and purchased SKU. Redirect flags and public Blob URLs never authorize
downloads. Donation state never unlocks ebook files or changes ebook stock.

## Central secrets (Vercel project settings)

| Name | Requirement |
| --- | --- |
| `DATABASE_URL` | TLS connection for `central_runtime`; replace any administrative Marketplace default before deploying. |
| `ADMIN_PANEL_PASSWORD` | Strong password for the Central's own admin login. |
| `ADMIN_SESSION_SECRET` | Random, at least 32 characters, for encrypted secure admin sessions. |
| `PAYMENTS_ENCRYPTION_KEY` | The same exact key as the source Central; required to decrypt imported integration secrets. |
| `BLOB_STORE_ID` | Approved private Blob store, with deployment OIDC access. |
| `BLOB_READ_WRITE_TOKEN` | Alternative approved server-only Blob access, including local book upload when needed. |

Never publish placeholder secrets, expose them through `VITE_*`, or store values in
Git/chat/logs. Stripe and webhook secrets are managed only in authenticated `/admin`
and stored encrypted in PostgreSQL. If the original encryption key is unavailable,
activation requires explicit secure reconfiguration of the affected integrations; a
new key cannot decrypt the old ciphertext. Migration credentials are separate and
excluded from the deployment.

## Activation order and limits

1. Provision the approved PostgreSQL and private Blob resources. Prepare restricted roles
   and restore the validated database in one transaction using the reviewed scripts.
2. Upload the ten private books and compare hashes. Configure the original encryption key,
   admin secrets and restricted runtime access without modifying the existing production
   deployment or connected Lovable branch.
3. Test the actual Vercel deployment: storefront, admin protection, API authorization,
   signed TEST webhooks, retries, receipts and paid-only downloads. Local verification
   passed 184 tests and restored a snapshot of 35 tables / 379 rows; it does not replace
   hosted verification or include later source writes.
4. Keep the existing TEST/LIVE values, named human approvals, kill switch and disabled
   release/onboarding gates. Hosting migration does not activate LIVE collection or
   transfers. Do not rewrite historical sessions or turn donations into ebook orders.
5. Coordinate final source writes and in-flight webhooks, import/reconcile the final
   consistent state, then connect `hopehumanbooks.com` after verification. Repeat the
   Foundation → Books → Stripe flow on that domain, including browser referrer, return
   URLs, webhook delivery and payment-confirmed state.
6. Retain the source deployment and backup for rollback. Reconcile any writes received
   by the new database before returning traffic to the old one.

Known source risks remain documented in the migration README: replaying stock commit or
release functions can duplicate stock movements, and donation-release functions have
different lock orders that can deadlock under concurrency. This migration preserves
those function bodies; the release flow stays disabled. Do not interpret preservation
or passing evidence tests as a claim that those source risks are resolved.
