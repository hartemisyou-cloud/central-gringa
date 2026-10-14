# Chosen deployment architecture (Hope Human Books)

```text
Customer ──> Checkout (Vercel, https://hopehumanfoundations.org)
               │  server-to-server only: STORE_API_KEY + STORE_SLUG=hope-human-books
               ▼
            Central (Lovable hosting, hopehumanbooks.com, Lovable Cloud database)
               ├─ /api/public/v1/*  products, quote, orders, status
               ├─ /pay/{publicToken}  Stripe Elements (only place Stripe runs)
               ├─ /order/{publicToken} receipt + PAID-gated ebook downloads
               └─ /api/public/webhooks/stripe/{integrationId}  sole payment confirmation
```

- The central is published on Lovable and served at `https://hopehumanbooks.com`. Its database
  stays on Lovable Cloud — no migration, no service-role key needed anywhere else.
- The checkout on Vercel never talks to Stripe. It only calls the central API and redirects the
  buyer to the `paymentUrl` returned by `POST /orders`.
- `vercel.json` and `docs/deploy/vercel.md` remain as a tested **optional** path for hosting the
  central itself on Vercel (requires its own database); they are not used by this architecture.

## Central secrets (Lovable Project Settings → Secrets)

| Name | Requirement |
| --- | --- |
| `ADMIN_PANEL_PASSWORD` | Strong password typed by a human (password manager) |
| `ADMIN_SESSION_SECRET` | Random, at least 32 characters (64 recommended) |
| `PAYMENTS_ENCRYPTION_KEY` | Random, at least 32 characters (64 recommended). Set once before saving Stripe keys; changing it later makes saved Stripe/integration secrets unreadable |

Never publish while these hold placeholder values.

## Activation order

1. Replace the three secrets above with real values.
2. Sign in to `/admin` → Stripe integration → save **test** keys for `hope-human-books`.
3. Stripe → Webhooks: add the URL shown in admin with `payment_intent.succeeded`,
   `payment_intent.payment_failed`, `payment_intent.canceled`, `charge.refunded`,
   `charge.dispute.created`; paste the `whsec_` secret back in admin.
4. `/admin` → create a store credential (allowed_origins already includes `https://hopehumanfoundations.org`; CORS is exact-match, no wildcard) for `hope-human-books`; save it in the Vercel checkout
   project as `STORE_API_KEY` (plus `STORE_SLUG=hope-human-books`, central base
   `https://hopehumanbooks.com`).
5. Publish the central on Lovable and connect `hopehumanbooks.com`.
6. Test with Stripe test cards end to end; then switch to live keys + live webhook.
7. Revoke the historically exposed key at the old central that issued it.
