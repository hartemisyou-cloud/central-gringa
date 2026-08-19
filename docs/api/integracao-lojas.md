# API Central de Pagamentos — Documentação de Integração

Base URL (produção): `https://central-spark-pay.lovable.app`
Base URL (preview): `https://id-preview--dfc262d1-6dc6-458b-a321-06bc42199114.lovable.app`

Todos os endpoints ficam sob `/api/public/v1`.

## Autenticação

A chave só pode ser usada **no backend/BFF da loja**. Nunca no navegador.

```
x-store-api-key: sk_live_b9DHfFufCHbB.LHK3KNXKZPXER8oRUK1L1Fkqj1PYPSR4h2fyKT2MWdpEcQ7e
x-store-slug: livraria-crista (padrão) | coracoes-unidos | loja-2 | loja-3 | loja-4
content-type: application/json
```

- Sem chave → `401`
- Loja fora do escopo da chave (ex.: `loja-1`) → `403`
- O banco guarda apenas o hash SHA-256 da chave.

## Tickets de doação (SKUs)

| Valor | SKU |
| --- | --- |
| US$ 20 | `CU-DON-020` |
| US$ 30 | `CU-DON-030` |
| US$ 50 | `CU-DON-050` |
| US$ 100 | `CU-DON-100` |
| US$ 250 | `CU-DON-250` |
| US$ 500 | `CU-DON-500` |

O valor cobrado é sempre o preço do SKU no servidor — o cliente nunca define o valor.

## 1. Listar produtos/tickets

`GET /api/public/v1/products`

```json
{"data":{"products":[{"id":"uuid","name":"Doação US$ 20","sku":"CU-DON-020","priceCents":2000,"currency":"USD","available":1000000}]}}
```

Use o `id` retornado para montar o pedido.

## 2. Cotação (opcional)

`POST /api/public/v1/quote`

```json
{ "items": [{ "productId": "uuid", "quantity": 1 }], "postalCode": "01310100" }
```

Resposta traz `subtotalCents`, `shippingCents`, `totalCents` e `shippingOptions`.
Para doações (sem entrega física) a única opção é `no-shipping` com valor 0.

## 3. Criar pedido

`POST /api/public/v1/orders`

```json
{
  "items": [{ "productId": "uuid", "quantity": 1 }],
  "customer": { "firstName": "Maria", "lastName": "Silva", "email": "maria@ex.com", "phone": "11999998888" },
  "address": { "postalCode": "01310100", "street": "Av Paulista", "number": "1000", "district": "Bela Vista", "city": "Sao Paulo", "state": "SP" },
  "shippingOptionId": "no-shipping"
}
```

Resposta: `orderId`, `orderNumber`, `publicToken`, `totals`.

## 4. Iniciar pagamento

`POST /api/public/v1/orders/{orderId}/payment`

```json
{"data":{"clientSecret":"pi_..._secret_...","publishableKey":"pk_live_...","amountCents":2000,"currency":"USD"}}
```

No frontend, use `clientSecret` + `publishableKey` com Stripe Elements (`confirmPayment`).
A chave secreta da Stripe nunca sai da central (armazenada cifrada AES-256-GCM).

## 5. Consultar status

`GET /api/public/v1/orders/status/{publicToken}`

Status possíveis: `PENDING_PAYMENT`, `PAYMENT_PROCESSING`, `PAID`, `PAYMENT_FAILED`, `CANCELLED`, `REFUNDED`, `PARTIALLY_REFUNDED`.
A confirmação definitiva vem do webhook da Stripe recebido pela central.

## Exemplo (Node/BFF)

```ts
const API = "https://central-spark-pay.lovable.app/api/public/v1";
const headers = {
  "content-type": "application/json",
  "x-store-api-key": process.env.STORE_API_KEY!,
  "x-store-slug": "loja-2",
};

const order = await fetch(`${API}/orders`, {
  method: "POST",
  headers,
  body: JSON.stringify({ items, customer, address, shippingOptionId: "no-shipping" }),
}).then((r) => r.json());

const pay = await fetch(`${API}/orders/${order.data.orderId}/payment`, {
  method: "POST",
  headers,
}).then((r) => r.json());
```

## Erros

| HTTP | code | significado |
| --- | --- | --- |
| 400 | `INVALID_INPUT` | payload inválido |
| 401 | `UNAUTHORIZED` | chave ausente/inválida |
| 403 | `FORBIDDEN` | loja fora do escopo ou inativa |
| 404 | `NOT_FOUND` | pedido/loja inexistente |
| 409 | `OUT_OF_STOCK` | estoque insuficiente |
| 429 | `RATE_LIMITED` | limite por minuto excedido |
| 500 | `CONFIG_ERROR` | loja sem provedor de pagamento |

Limites: produtos/quote 60/min, pedidos 20/min, pagamento 20/min, status 120/min.
