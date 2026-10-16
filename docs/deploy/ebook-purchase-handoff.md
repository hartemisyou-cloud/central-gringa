# Ebook purchase handoff

This additive purchase flow does not rewrite donation records, Sessions, campaign metadata, or ebook catalog prices. Nothing has been published.

## Foundation changes still required in the Foundation project

This Central chat can only read the Foundation snapshot. Its files cannot be changed from here.
In the Foundation project's own chat, add the exact visible disclosure below every Donate button:

> Contribuição processada como compra de um ebook na Hope Human Books.

Use the site's existing secondary-text style and a smaller legible font. Preserve amount selection; buttons without a selected amount still go to the amount chooser. Once an amount is selected, replace the current form POST to `/donations/start` with a same-tab `window.location.replace()` to the matching URL below. Do not send campaign identifiers, credentials, or call Stripe from the Foundation browser.

| USD | Books URL |
| --- | --- |
| 20 | https://hopehumanbooks.com/comprar/the-adventures-of-tom-sawyer |
| 30 | https://hopehumanbooks.com/comprar/little-women |
| 50 | https://hopehumanbooks.com/comprar/adventures-of-huckleberry-finn |
| 100 | https://hopehumanbooks.com/comprar/moby-dick |
| 250 | https://hopehumanbooks.com/comprar/american-classics-collection |
| 500 | https://hopehumanbooks.com/comprar/american-classics-library |

Observed source files requiring changes: `src/lib/checkout.ts`, `src/routes/donate.tsx`, `src/routes/index.tsx`, `src/routes/campaign-detail.tsx`, `src/components/campaign-detail-sections.tsx`; scan other Donate controls and update actual navigation tests in that project.

## Central behavior

`/comprar/<slug>` displays Hope Human Books, the actual book, and “Preparando seu pedido...” before a POST server function prepares checkout. GET/SSR never creates an order. The browser sends only the allowlisted slug and, on resume, an existing random order token. Prices and items are checked against the existing database catalog. Stripe collects email at its hosted Checkout; no invented customer/address is inserted. Metadata uses the same ebook operational allowlist. This is an ebook purchase (`submit_type=pay`), not a relabeled donation Session.

The server resolves the Books store, enforces active integration and matching TEST/LIVE environment, and requires signed-webhook configuration before creation. There is no switch to LIVE or new credentials. The persisted Checkout Session is re-used on resume; Stripe calls use an order-scoped stable idempotency key. A network failure before the token reaches the browser is not guaranteed to resume automatically; do not claim global exactly-once order creation.

Only the existing verified `payment_intent.succeeded` webhook can mark the order PAID. For new hosted purchases, it verifies the persisted Session's PaymentIntent, integration, mode, amount and order binding first. Download authorization remains PAID-only. Returning from Stripe does not grant downloads. Unpaid/failed/cancelled/expired purchases remain locked.

The Books document requests referrer policy `origin`, with immediate navigation to a validated `https://checkout.stripe.com` URL. This does not promise invisibility to Stripe or control over browsers/extensions that remove referrers.

End-to-end production verification is pending the Foundation edits, publishing authorization, and configured test checkout. No real Stripe requests were made during development tests.