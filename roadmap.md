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
- [ ] Admin panel still in Portuguese — translate to English
- [ ] Stripe integration for the store (needs Stripe keys + webhook secret via admin) — blocked on user
- [ ] Admin secrets (ADMIN_PANEL_PASSWORD, ADMIN_SESSION_SECRET, PAYMENTS_ENCRYPTION_KEY) — blocked on user
- [ ] Revoke the historical exposed store key at the old central — blocked on user
