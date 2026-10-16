# Hope Human Books — Central

Payment central and storefront for Hope Human Books (curated public-domain ebooks, USD).

- Storefront: `/`, `/checkout`, receipt + downloads at `/order/{publicToken}`
- Ebook Stripe payment page: `/pay/{publicToken}`
- Donation handoff: Foundation → `/donations/start` → Stripe Checkout → donation receipt
- Public API for external checkouts: see `docs/api/hope-human-books-checkout-api.md`
- Stripe webhook: `/api/public/webhooks/stripe/{integrationId}` — sole source of PAID
- Catalog manifest: `src/lib/catalog/hhb.ts`; source provenance: `docs/catalog/hope-human-books-provenance.json`
- Idempotent store/catalog setup script: `docs/catalog/hope-human-books-seed.sql`

Secrets live only in the project's secret store. Never commit keys to docs or code.
# Vercel deployment

Central Gringa is deployed on Vercel at `hopehumanbooks.com`, with PostgreSQL and private Vercel Blob. The original Lovable deployment is retained separately as a migration backup.

Use Node22 and the committed Bun lockfile. Run `bun install --frozen-lockfile`, `bun run typecheck`, `bun run test` and `VERCEL=1 bun run build`. The build produces Nitro's Vercel output; do not add a second Nitro plugin or a static SPA rewrite.

Only server settings from `.env.example` are used. Preserve the current `PAYMENTS_ENCRYPTION_KEY` so saved integrations remain readable. `DATABASE_URL` must use the restricted runtime role; the separate migration connection and role password are never deployed to the web application.

The reviewed schema, access controls and import order are in `migrations/README.md`. The import script refuses nonempty destination schemas and validates every table, column, count and COPY digest before committing. Private database exports and ebook files are deliberately absent from this repository.

The public book catalog and donation purpose are preserved. Donation payment navigation remains Foundation → Books → Stripe; storefront pages do not gain donation prompts. Known active campaigns accept donations without manual campaign review or financial self-attestation. The basic admin shows collection status, one pause/resume setting and recent donations; deferred Connect/beneficiary/transfer controls stay inactive. Preserve the existing TEST/LIVE mode, Stripe webhook identity, signed payment confirmation and encrypted integration data.

