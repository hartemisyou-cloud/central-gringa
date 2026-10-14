# Roadmap

- [x] Fix storefront crash from placeholder PAYMENTS_API_BASE_URL
- [x] Remove literal store credential from docs
- [x] Store `hope-human-books` (USD) + 11 HHB products (idempotent script)
- [x] Digital-goods order path (name/email only)
- [x] paymentUrl/receiptUrl from current origin; /pay owns Stripe UI
- [x] Ebook files (10) in private storage + provenance manifest; PAID-gated downloads
- [x] Webhook retry/idempotency
- [x] English storefront, checkout, pay, receipt, 5 policies, metadata
- [x] API contract doc
- [x] Tests + typecheck
- [x] Admin panel in English + Stripe integration section
- [x] Vercel build config + deployment doc (docs/deploy/vercel.md)
- [ ] Stripe integration for the store (enter keys + webhook secret in /admin) — blocked on user
- [ ] Admin secrets (ADMIN_PANEL_PASSWORD, ADMIN_SESSION_SECRET, PAYMENTS_ENCRYPTION_KEY) — blocked on user
- [ ] Revoke the historical exposed store key at the old central — blocked on user
- [ ] Decide Vercel database access: Lovable Cloud does not expose the service role key — blocked on user choice
