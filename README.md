# Hope Human Books — Central

Payment central and storefront for Hope Human Books (curated public-domain ebooks, USD).

- Storefront: `/`, `/checkout`, receipt + downloads at `/order/{publicToken}`
- Hosted Stripe payment page: `/pay/{publicToken}` (the only place Stripe UI runs)
- Public API for external checkouts: see `docs/api/hope-human-books-checkout-api.md`
- Stripe webhook: `/api/public/webhooks/stripe/{integrationId}` — sole source of PAID
- Catalog manifest: `src/lib/catalog/hhb.ts`; source provenance: `docs/catalog/hope-human-books-provenance.json`
- Idempotent store/catalog setup script: `docs/catalog/hope-human-books-seed.sql`

Secrets live only in the project's secret store. Never commit keys to docs or code.
