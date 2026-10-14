# Deploying the Hope Human Books central on Vercel (optional path)

> **Chosen architecture:** the central is hosted on Lovable at `hopehumanbooks.com`; only the
> external checkout runs on Vercel. See `docs/deploy/architecture.md`. This guide is kept as a
> tested alternative and is not required.

## Build configuration

No plugin changes are needed. `@lovable.dev/vite-tanstack-config` already runs Nitro on
production builds; outside the Lovable sandbox Nitro auto-detects Vercel (`VERCEL=1`) and
uses the `vercel` preset. Inside Lovable it keeps building for its own hosting, so the
Lovable preview is unaffected.

`vercel.json` (repo root):

```json
{ "framework": "tanstack-start", "buildCommand": "vite build", "installCommand": "bun install" }
```

Verified locally with a Vercel-style build (`VERCEL=1 vite build`, outside the sandbox
environment): Nitro reported `preset: vercel` and produced `.vercel/output/` with
`config.json`, `static/` and `functions/__server.func`.

To force the preset from your own CI instead of auto-detection, set `NITRO_PRESET=vercel`.

## Environment variables (names read by the code)

Server-only (Vercel → Project → Settings → Environment Variables):

| Name | Used by | Notes |
|---|---|---|
| `SUPABASE_URL` | server database client | database API URL |
| `SUPABASE_SERVICE_ROLE_KEY` | server database client (`client.server.ts`) | privileged; server only |
| `SUPABASE_PUBLISHABLE_KEY` | SSR fallback for the public client | publishable |
| `ADMIN_PANEL_PASSWORD` | `/admin` login | choose a strong password |
| `ADMIN_SESSION_SECRET` | encrypted admin session cookie | random, at least 32 chars |
| `PAYMENTS_ENCRYPTION_KEY` | encrypts Stripe keys / store keys in the database | random, at least 32 chars; must be the SAME value everywhere the same database is used, or saved Stripe keys cannot be decrypted |

Build-time public (exposed to the browser):

| Name | Notes |
|---|---|
| `VITE_SUPABASE_URL` | same URL as above |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | publishable key |
| `VITE_SUPABASE_PROJECT_ID` | project id |

Base URL: none required. `paymentUrl`, `receiptUrl`, webhook URLs and admin examples are
built from the origin serving the request, so the deployment works on its `*.vercel.app`
URL before DNS and on `https://hopehumanbooks.com` after. Canonical metadata already points
to `https://hopehumanbooks.com`.

Not environment variables: Stripe keys and the webhook signing secret. They are entered in
`/admin → Stripe integration`, validated with Stripe and stored encrypted in the database.
The external checkout project never receives any Stripe value; it only gets `STORE_API_KEY`
(created in `/admin`) and `STORE_SLUG=hope-human-books`.

## Database access limitation

This project's database runs on Lovable Cloud, which does not hand out the
`SUPABASE_SERVICE_ROLE_KEY`. A Vercel deployment therefore cannot use this database as-is.
Choose one before activating on Vercel:

1. Host the central on Lovable (publish) and connect `hopehumanbooks.com` there; the external
   checkout can still live on Vercel and call the central's API. No code change needed.
2. Run the central on Vercel with your own database project: apply the schema, run
   `docs/catalog/hope-human-books-seed.sql`, create a private `ebooks` bucket and upload the
   10 files listed in `docs/catalog/hope-human-books-provenance.json` under `v1/`.

## Activation checklist

1. Set the environment variables above (never commit values).
2. Sign in to `/admin`, open Stripe integration, save test keys for `hope-human-books`.
3. In Stripe → Developers → Webhooks, add the webhook URL shown in admin with events
   `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.canceled`,
   `charge.refunded`, `charge.dispute.created`; paste its `whsec_` secret back in admin.
4. Create a store credential in `/admin` and save it as `STORE_API_KEY` in the checkout project.
5. Test with Stripe test cards, then repeat steps 2–3 with live keys.
6. Connect the domain `hopehumanbooks.com`.
