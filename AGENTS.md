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
- Ebook downloads are authorized only by orders.status = PAID (set solely by the verified Stripe webhook); files live in the private `ebooks` bucket and are streamed by `/api/public/v1/downloads/...`. Why: URL flags or client claims must never unlock paid files.
- Digital-only carts (all products weight 0) skip address, phone and shipping; physical carts still require address and phone. Why: no invented customer data for ebooks.
- SKU → file mapping lives in `src/lib/catalog/hhb.ts`, generated from the provenance manifest in `docs/catalog/`. Why: bundles must map to real, verifiable files.
- Webhook events are reprocessed when previously FAILED (or stuck RECEIVED); every succeeded-step is idempotent. Why: transient errors must never lose a payment confirmation.
- External checkouts call only this central's API; Stripe UI and keys stay in this project (`/pay/{publicToken}`). Why: card data and Stripe credentials stay in one place.
- Hosting target is chosen by Nitro auto-detection (Lovable build env → Lovable hosting; `VERCEL=1` → vercel preset) with `vercel.json` framework tanstack-start; never hardcode deployment origins — derive URLs from the serving request. Why: one codebase must work on preview, Lovable and Vercel without stale domains.
- Stripe keys and webhook secrets are entered only via /admin and stored encrypted (PAYMENTS_ENCRYPTION_KEY); never env vars in checkout projects. Why: card/payment credentials stay in the central.
- Donations live in `src/lib/donations/` with their own tables; the only active flow is direct NGO collection (`collectionGaps`: store/integration/mode, ACTIVE campaign, kill switch; LIVE also needs whsec + human approvals) with beneficiary NULL, while transfer/onboarding code stays deferred and OFF, ledger and Stripe SDK instance (dahlia API); they never touch ebook orders/stock/downloads, and every gate defaults off. Donation state, refund/dispute facts, ledger and release operations change only through service-role RPCs (`donation_apply_event`, `donation_release_reserve`, `donation_release_mark`); donation tests run the real migrations in PGlite (`src/lib/donations/test-db.ts`). Why: donor funds must stay separate, atomic and fail closed.
- Foundation site starts donations via same-tab form POST `/donations/start` (exact Origin allowlist, store resolved server-side, reuses `createDonation`), 303 to `/donations/pay/<token>`, which serves a minimal Books document (meta no-referrer, immediate navigation to the persisted, re-validated Stripe URL) because the edge rewrites Referrer-Policy headers. Why: no store credential in the browser, one-click handoff, and no referrer forwarded to Stripe.
