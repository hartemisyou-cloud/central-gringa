# Hope Human Books — Central API contract for the external checkout

The external checkout talks **only** to this central, server-to-server. It never calls
Stripe, never loads Stripe.js, never handles card data. Payment happens on the central's
hosted page (`paymentUrl`), and the Stripe webhook is the only thing that marks an order PAID.

- Preview base (works before DNS): `https://project--e7d4afd7-096c-4f6f-89f5-7f9fd704f43c-dev.lovable.app`
- Published base (after publish): `https://project--e7d4afd7-096c-4f6f-89f5-7f9fd704f43c.lovable.app`
- Intended production base: `https://hopehumanbooks.com` (once the domain is connected)
- Checkout origin (Vercel): `https://hopehumanfoundations.org` — listed in the store's exact-match `allowed_origins`. Calls should still be server-to-server; the buyer is always redirected to the central `paymentUrl`, never to a checkout-hosted payment page.

`paymentUrl` / `receiptUrl` are always built from the origin that served the request, so they
follow whichever base you call.

## Authentication (server-side only)

```
x-store-api-key: <STORE_API_KEY>        # keyId.secret, issued in the central admin
x-store-slug: hope-human-books
content-type: application/json
```

Keep the key in the checkout's server secrets. Never put it in browser code.

## GET /api/public/v1/products

```json
{ "data": { "products": [ { "id": "uuid", "sku": "HHB-EB-005", "name": "...", "priceCents": 500, "currency": "USD", "available": 1000000, "category": "ebook" } ] } }
```

| SKU | Price | Product |
|---|---|---|
| HHB-EB-005 | $5 | The Yellow Wallpaper |
| HHB-EB-010 | $10 | The Call of the Wild |
| HHB-EB-015 | $15 | The Four Million |
| HHB-EB-020 | $20 | The Adventures of Tom Sawyer |
| HHB-EB-030 | $30 | Little Women |
| HHB-EB-050 | $50 | Adventures of Huckleberry Finn |
| HHB-EB-075 | $75 | Walden, and On the Duty of Civil Disobedience |
| HHB-EB-100 | $100 | Moby-Dick |
| HHB-EB-150 | $150 | The Wonderful Wizard of Oz |
| HHB-COL-250 | $250 | American Classics Collection (6 works) |
| HHB-LIB-500 | $500 | American Classics Library (10 works) |

## POST /api/public/v1/quote

```json
{ "items": [ { "productId": "uuid", "quantity": 1 } ] }
```
Returns server-computed totals; `shippingCents` is always 0 (one `no-shipping` option).

## POST /api/public/v1/orders  (digital path)

```json
{
  "items": [ { "productId": "uuid", "quantity": 1 } ],
  "customer": { "firstName": "Ada", "lastName": "Lovelace", "email": "ada@example.com" },
  "attribution": { "utm_source": "..." }
}
```
No `address`, no `phone`, no `shippingOptionId` for digital products. Prices come from the
database only. Response:

```json
{ "data": {
  "orderId": "uuid", "orderNumber": "ORD-20261014-XXXXXX", "publicToken": "32 chars",
  "paymentUrl": "<base>/pay/<publicToken>",
  "receiptUrl": "<base>/order/<publicToken>",
  "totals": { "currency": "USD", "subtotalCents": 500, "shippingCents": 0, "discountCents": 0, "totalCents": 500 }
} }
```
Redirect the buyer's browser to `paymentUrl`. After payment Stripe returns them to `receiptUrl`.

## GET /api/public/v1/orders/status/{publicToken}

Returns `order.status` (`PENDING_PAYMENT`, `PAYMENT_PROCESSING`, `PAID`, `PAYMENT_FAILED`,
`CANCELLED`, `REFUNDED`…), `receiptUrl` and `downloadsAvailable` (true only when PAID).

## Ebook delivery

`receiptUrl` lists downloads once the order is PAID. Each file is served by
`GET /api/public/v1/downloads/{publicToken}/{workId}`, which re-checks the database on every
request and returns 403 until the webhook has marked the order PAID. URL parameters or
redirect flags never unlock files.

## Errors

`{ "error": { "code": "INVALID_INPUT|UNAUTHORIZED|FORBIDDEN|NOT_FOUND|OUT_OF_STOCK|INVALID_STATE|RATE_LIMITED|PROVIDER_ERROR|CONFIG_ERROR", "message": "...", "details": null } }`
