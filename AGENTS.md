<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Architecture rules
- Ebook downloads are authorized only by orders.status = PAID (set solely by the verified Stripe webhook); files live at `v1/` in a private Vercel Blob store and are streamed by `/api/public/v1/downloads/...`. Why: URL flags or client claims must never unlock paid files.
- Digital-only carts (all products weight 0) skip address, phone and shipping; physical carts still require address and phone. Why: no invented customer data for ebooks.
- SKU → file mapping lives in `src/lib/catalog/hhb.ts`, generated from the provenance manifest in `docs/catalog/`. Why: bundles must map to real, verifiable files.
- Webhook events are reprocessed when previously FAILED (or stuck RECEIVED); every succeeded-step is idempotent. Why: transient errors must never lose a payment confirmation.
- External checkouts call only this central's API; Stripe UI and keys stay in this project (`/pay/{publicToken}`). Why: card data and Stripe credentials stay in one place.
- This isolated migration copy targets Vercel through Nitro auto-detection (`VERCEL=1`) and `vercel.json` framework tanstack-start. Never hardcode serving origins; derive payment URLs from the request. The original published Lovable source stays separate during migration.
- Database access is server-only PostgreSQL through `src/lib/db/client.server.ts`, explicit parameterized SQL and the existing financial functions. `DATABASE_URL` belongs to `central_runtime`, which cannot own objects, create roles, bypass RLS or execute arbitrary financial functions. Migration uses a separate owner connection. Never restore Supabase SDK/Auth/REST access or put database/Blob/payment secrets in `VITE_*` variables.
- Exclude unused platform-generated `src/integrations/supabase/**` files from TypeScript root inputs; never import them into application code. Why: the PostgreSQL-only migration must not acquire a Supabase SDK dependency just to check regenerated, unused files.
- Schema restore order is `migrations/001_pre.sql`, private validated COPY data, `002_post.sql`, then `003_server_acl.sql` in one transaction. Preserve IDs, snapshots, ciphertext, tokens and all historical rows. Data exports and ebook files stay outside the repository. The two legacy auth foreign keys were explicitly removed only after confirming the source auth tables are empty; revalidate this before importing.
- Stripe keys and webhook secrets are entered only via /admin and stored encrypted (PAYMENTS_ENCRYPTION_KEY); never env vars in checkout projects. Why: card/payment credentials stay in the central.
- Donations live in `src/lib/donations/` with their own tables and Stripe SDK instance (dahlia API). The active flow is direct NGO collection with beneficiary NULL: known ACTIVE, unexpired campaigns accept automatically through a valid ACTIVE store/integration in the same mode; LIVE also requires the webhook signing secret. Manual campaign review and local financial self-attestations are not collection prerequisites. When no settings row exists, eligible collection defaults on in memory; an explicit saved `donations_enabled=false` always pauses it. The basic admin only exposes this collection switch and recent donations. Never fabricate reviewed/Stripe-approved fields. Transfer/onboarding/release code remains deferred and OFF. Donations never touch ebook orders/stock/downloads. Donation state, refund/dispute facts, ledger and release operations change only through the restricted PostgreSQL financial functions (`donation_apply_event`, `donation_release_reserve`, `donation_release_mark`); donation tests execute real SQL through Postgres.js and PGlite. Why: simple collection must retain signed payment confirmation, atomic records and separate histories.
- Foundation site starts donations via same-tab form POST `/donations/start` (exact Origin allowlist, store resolved server-side, reuses `createDonation`), 303 to `/donations/pay/<token>`, which serves a minimal Books document (meta referrer `origin`, immediate navigation to the persisted, re-validated Stripe URL) because the edge rewrites Referrer-Policy headers. Why: no store credential in the browser, one-click handoff, and Stripe receives only the Books origin (never the pay path/token) as Referer.
