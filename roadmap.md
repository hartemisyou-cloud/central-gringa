# Roadmap

- [x] Fix storefront crash from placeholder PAYMENTS_API_BASE_URL
- [ ] Hope Human Books central (English UI, brand, canonical https://hopehumanbooks.com)
  - [ ] Remove literal store credential from docs (placeholders)
  - [ ] Provision store `hope-human-books` (USD) + 11 HHB ebook products (idempotent)
  - [ ] Digital-goods order path (name/email only, no address/phone, no shipping)
  - [ ] paymentUrl from current deployment origin; /pay/{publicToken} owns Stripe UI
  - [ ] Ebook files + provenance manifest; downloads gated on PAID via webhook
  - [ ] Webhook retry/idempotency review
  - [ ] English storefront, policies, metadata; remove donation/nonprofit claims
  - [ ] API contract doc for external checkout
  - [ ] Tests (digital pricing, paid fulfillment) + build
  - [ ] Secrets needed from user (Stripe keys, admin password etc.) — blocked on user
