import { sql, one, rows, exec, count as rowCount } from "@/lib/db/client.server";
import { PaymentError } from "./errors";
import { buildTotals, priceItems, type PriceableProduct, type RequestedItem } from "./pricing";
import { normalizePostalCode, resolveShippingService } from "./shipping";
import { mapProviderStatus, providerFromIntegration } from "./provider.server";
import { randomToken } from "./crypto.server";
import type { StoreRow } from "./store-auth.server";
import type { Database } from "@/lib/db/types";
import { type Attribution } from "./attribution";
import { CheckoutFailure, classifyCheckoutFailure, logCheckoutFailure } from "./checkout-log.server";
import { HHB_STORE_ID } from "@/lib/catalog/hhb";
import { PURCHASE_ENTRY_SLUGS, purchaseEntryProduct } from "./purchase-entry";


type IntegrationRow = Database["public"]["Tables"]["stripe_integrations"]["Row"];
type OrderRow = Database["public"]["Tables"]["orders"]["Row"];
type PaymentRow = Database["public"]["Tables"]["payments"]["Row"];

function checkoutFailure(
  stage: ConstructorParameters<typeof CheckoutFailure>[0],
  operation: string,
  error: unknown,
  code: PaymentError["code"],
  message: string,
): CheckoutFailure {
  const failure = new CheckoutFailure(stage, operation, error, { code, message });
  logCheckoutFailure(failure, operation);
  return failure;
}

/** Preserve existing best-effort writes, while making server-side DB failures observable. */
async function orderWrite(query: Parameters<typeof exec>[0], operation: string) {
  const result = await exec(query);
  if (result.error) logCheckoutFailure(result.error, operation, "db_unreachable");
  return result;
}

export interface CustomerInput {
  firstName: string;
  lastName: string;
  email: string;
  /** Required for physical goods only; digital orders never ask for it. */
  phone?: string | undefined;
}

export interface AddressInput {
  postalCode: string;
  street: string;
  number?: string | undefined;
  complement?: string | undefined;
  district?: string | undefined;
  city: string;
  state?: string | undefined;
  country?: string | undefined;
}

async function loadProducts(storeId: string, productIds: string[]): Promise<PriceableProduct[]> {
  const { data, error } = await rows<PriceableProduct>(sql`
    select id, name, sku, price_cents, currency, stock, reserved_stock, active, weight_grams
    from public.products where store_id = ${storeId} and id in ${sql(productIds)}
  `);
  if (error) throw checkoutFailure("db_unreachable", "orders.load-products", error, "INVALID_INPUT", "Failed to load products.");
  return data ?? [];
}

/** Opção usada quando não há entrega física (doações, itens digitais). */
export function isDigitalOnly(totalWeightGrams: number): boolean {
  return totalWeightGrams === 0;
}

const NO_SHIPPING_OPTION = {
  id: "no-shipping",
  label: "Digital delivery (no shipping)",
  amountCents: 0,
  estimatedDays: 0,
  provider: "NONE",
};

function uniqueIds(items: RequestedItem[]): string[] {
  return [...new Set(items.map((item) => item.productId))];
}

/** Cotação server-side: preços, frete e total. O frontend nunca decide valores. */
export async function quoteCart(input: {
  store: StoreRow;
  items: RequestedItem[];
  postalCode?: string;
  /** Fluxo externo isento de frete (ex.: checkout parceiro). Não altera o produto. */
  noShipping?: boolean | undefined;
}) {
  const products = await loadProducts(input.store.id, uniqueIds(input.items));
  const priced = priceItems(input.items, products);

  let shippingOptions: Awaited<ReturnType<ReturnType<typeof resolveShippingService>["quote"]>> = [];
  if (input.noShipping || priced.totalWeightGrams === 0) {
    // Pedido sem entrega física (doações/itens digitais) ou fluxo isento de frete.
    shippingOptions = [NO_SHIPPING_OPTION];
  } else if (input.postalCode) {
    shippingOptions = await resolveShippingService().quote({
      postalCode: normalizePostalCode(input.postalCode),
      totalWeightGrams: priced.totalWeightGrams,
      subtotalCents: priced.subtotalCents,
      currency: priced.currency,
    });
  }

  const totals = buildTotals({ ...priced, shippingCents: shippingOptions[0]?.amountCents ?? 0 });
  return { ...totals, shippingOptions };
}

function orderNumber(): string {
  const now = new Date();
  const stamp = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}${String(now.getUTCDate()).padStart(2, "0")}`;
  return `ORD-${stamp}-${randomToken(6).toUpperCase()}`;
}

export async function createOrder(input: {
  store: StoreRow;
  items: RequestedItem[];
  /** Omit only for a server-side digital entry; never invent customer details. */
  customer?: CustomerInput | undefined;
  /** Opcional: pedidos 100% digitais (eBooks) não exigem endereço de entrega. */
  address?: AddressInput | undefined;
  shippingOptionId: string;
  attribution?: Attribution | undefined;
  /** Fluxo externo isento de frete (ex.: checkout parceiro). Não altera o produto. */
  noShipping?: boolean | undefined;
  /** IP/User-Agent/URL reais do comprador (opcional, telemetria). */
  clientContext?:
    | { clientIp?: string | null; clientUserAgent?: string | null; eventSourceUrl?: string | null }
    | undefined;
  /** Persisted HHF origin; a return also requires the explicit marker and PAID. */
  originHhf?: boolean | undefined;
  /** Server-captured address retained in the order, never sent to Stripe. */
  clientIp?: string | null | undefined;
}) {


  const products = await loadProducts(input.store.id, uniqueIds(input.items));
  const priced = priceItems(input.items, products);

  // Digital-only carts (all products weight 0) never ship and never need an
  // address or phone. Physical carts keep the full validation.
  const allDigital = isDigitalOnly(priced.totalWeightGrams);
  const noShipping = input.noShipping === true || allDigital;
  if (!allDigital && !input.customer) {
    throw new PaymentError("INVALID_INPUT", "Customer details are required for physical items.");
  }
  if (!noShipping && !input.address) {
    throw new PaymentError("INVALID_INPUT", "A shipping address is required for physical items.");
  }
  if (!allDigital && !input.customer?.phone) {
    throw new PaymentError("INVALID_INPUT", "A phone number is required for physical items.");
  }
  const options = noShipping
    ? [NO_SHIPPING_OPTION]
    : await resolveShippingService().quote({
        postalCode: normalizePostalCode(input.address!.postalCode),
        totalWeightGrams: priced.totalWeightGrams,
        subtotalCents: priced.subtotalCents,
        currency: priced.currency,
      });
  // No fluxo isento, o id enviado pelo checkout externo é ignorado: frete sempre zero.
  const option = noShipping
    ? NO_SHIPPING_OPTION
    : options.find((entry) => entry.id === input.shippingOptionId);
  if (!option) throw new PaymentError("INVALID_INPUT", "Invalid shipping option.");

  const totals = buildTotals({ ...priced, shippingCents: option.amountCents });

  let customerId: string | null = null;
  if (input.customer) {
    const { data: customer, error: customerError } = await one<{ id: string }>(sql`
      insert into public.customers (store_id, email, first_name, last_name, phone)
      values (${input.store.id}, ${input.customer.email.toLowerCase()}, ${input.customer.firstName},
        ${input.customer.lastName}, ${input.customer.phone ?? null})
      on conflict (store_id, email) do update set first_name = excluded.first_name,
        last_name = excluded.last_name, phone = excluded.phone returning id
    `);
    if (customerError || !customer) {
      throw checkoutFailure("db_unreachable", "orders.save-customer", customerError, "INVALID_INPUT", "Could not save customer details.");
    }
    customerId = customer.id;
  }

  // Pedido digital (eBook) sem endereço informado: não cria registro de entrega.
  let addressId: string | null = null;
  if (input.address && !allDigital && input.customer) {
    const addr = input.address;
    const { data: address, error: addressError } = await one<{ id: string }>(sql`
      insert into public.addresses (store_id, customer_id, recipient_name, phone, postal_code,
        street, number, complement, district, city, state, country)
      values (${input.store.id}, ${customerId}, ${`${input.customer.firstName} ${input.customer.lastName}`.trim()},
        ${input.customer.phone ?? null}, ${noShipping ? addr.postalCode.trim() : normalizePostalCode(addr.postalCode)},
        ${addr.street}, ${addr.number ?? ""}, ${addr.complement ?? null}, ${addr.district ?? ""},
        ${addr.city}, ${addr.state ?? ""}, ${addr.country ?? "US"}) returning id
    `);
    if (addressError || !address) {
      throw checkoutFailure("db_unreachable", "orders.save-address", addressError, "INVALID_INPUT", "Invalid shipping address.");
    }
    addressId = address.id;
  }

  const { data: order, error: orderError } = await one<OrderRow>(sql`
    insert into public.orders (store_id, order_number, customer_id, shipping_address_id, environment,
      currency, subtotal_cents, shipping_cents, discount_cents, total_cents, shipping_method, public_token, origin_hhf, client_ip)
    values (${input.store.id}, ${orderNumber()}, ${customerId}, ${addressId}, ${input.store.environment},
      ${totals.currency}, ${totals.subtotalCents}, ${totals.shippingCents}, ${totals.discountCents},
      ${totals.totalCents}, ${option.label}, ${randomToken(32)}, ${input.originHhf === true}, ${input.clientIp ?? null}) returning *
  `);
  if (orderError || !order) {
    throw checkoutFailure("db_unreachable", "orders.create", orderError, "INVALID_INPUT", "Could not create the order.");
  }

  const itemRecords = totals.items.map((item) => ({
    order_id: order.id, product_id: item.productId, product_name: item.productName,
    sku: item.sku, unit_price_cents: item.unitPriceCents, quantity: item.quantity, total_cents: item.totalCents,
  }));
  const { error: itemsError } = await exec(sql`insert into public.order_items
    ${sql(itemRecords, "order_id", "product_id", "product_name", "sku", "unit_price_cents", "quantity", "total_cents")}`);
  if (itemsError) {
    await orderWrite(sql`delete from public.orders where id = ${order.id}`, "orders.rollback-items");
    throw checkoutFailure("db_unreachable", "orders.save-items", itemsError, "INVALID_INPUT", "Could not save order items.");
  }

  // Reserva de estoque atômica (evita condição de corrida / oversell).
  for (const item of totals.items) {
    const { data: result, error: reserveError } = await one<{ reserved: boolean }>(sql`
      select public.reserve_stock(${item.productId}, ${item.quantity}) as reserved
    `);
    const reserved = result?.reserved;
    if (reserveError) logCheckoutFailure(reserveError, "orders.reserve-stock", "db_unreachable");
    if (reserved !== true) {
      await orderWrite(sql`select public.release_order_stock(${order.id})`, "orders.release-stock");
      await orderWrite(sql`delete from public.orders where id = ${order.id}`, "orders.rollback-stock");
      throw new PaymentError("OUT_OF_STOCK", `Insufficient stock for "${item.productName}".`);
    }
  }
  await orderWrite(sql`update public.orders set stock_reserved = true where id = ${order.id}`, "orders.mark-reserved");
  await orderWrite(sql`insert into public.payment_events (order_id, type, message, metadata)
    values (${order.id}, 'ORDER_CREATED', 'Order created', ${sql.json({ total_cents: totals.totalCents })})`, "orders.record-created");

  const { saveOrderAttribution } = await import("./attribution.server");
  const attribution = await saveOrderAttribution(order.id, input.attribution, input.clientContext);


  return { order, totals, publicToken: order.public_token, attribution };

}

/** Leitura pura da integração da loja (sem validação) — permite paralelizar. */
function fetchIntegrationForStore(store: StoreRow) {
  if (!store.stripe_integration_id) return Promise.resolve({ data: null, error: null });
  return one<IntegrationRow>(sql`select * from public.stripe_integrations where id = ${store.stripe_integration_id}`, true);
}

/** Validações da integração — ordem e mensagens idênticas às anteriores. */
function validateIntegration(store: StoreRow, data: IntegrationRow | null): IntegrationRow {
  if (!store.stripe_integration_id) {
    throw checkoutFailure("no_stripe_integration", "payment.resolve-integration", null, "CONFIG_ERROR", "Store has no payment integration configured.");
  }
  if (!data) throw checkoutFailure("no_stripe_integration", "payment.resolve-integration", null, "CONFIG_ERROR", "Payment integration not found.");
  if (data.status !== "ACTIVE") {
    throw checkoutFailure("no_stripe_integration", "payment.resolve-integration", null, "CONFIG_ERROR", "Payment integration inactive.");
  }
  if (data.environment !== store.environment) {
    throw checkoutFailure("no_stripe_integration", "payment.resolve-integration", null, "CONFIG_ERROR",
      "Store and integration environments differ (test/live cannot be mixed).");
  }
  return data;
}

async function integrationForStore(store: StoreRow): Promise<IntegrationRow> {
  const { data } = await fetchIntegrationForStore(store);
  return validateIntegration(store, data as IntegrationRow | null);
}


/** Limites de metadata da Stripe: 50 chaves, valor <= 500 chars. */
const META_VALUE_MAX = 480;

export interface OrderItemRow {
  product_id: string;
  product_name: string;
  sku: string;
  quantity: number;
}

/** PaymentIntent description: always the store order number (purchases, never donations). */
export function buildPaymentDescription(order: { order_number: string }, _items: OrderItemRow[] = []): string {
  return `Order ${order.order_number}`;
}

/**
 * Resume os itens do pedido para o metadata do PaymentIntent, identificando
 * explicitamente produtos digitais (eBooks) sem expor dados internos.
 */

/**
 * Allowlist explícita do metadata enviado à Stripe. Qualquer chave fora desta
 * lista é descartada — inclusive dados de atribuição/marketing.
 */
const STRIPE_METADATA_ALLOWLIST = [
  "environment",
  "store_id",
  "order_id",
  "order_number",
  "item_count",
  "product_type",
  "delivery_type",
  "sku",
  "product_name",
  "quantity",
  "category",
] as const;

function pickOperationalMetadata(input: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of STRIPE_METADATA_ALLOWLIST) {
    const value = input[key];
    if (typeof value === "string" && value.length > 0) out[key] = value;
  }
  return out;
}

function buildItemsMetadata(

  items: OrderItemRow[],
  products: { id: string; category: string | null; weight_grams: number }[],
): Record<string, string> {
  if (items.length === 0) return {};
  const byId = new Map(products.map((p) => [p.id, p]));
  const digitalCount = items.filter((i) => (byId.get(i.product_id)?.weight_grams ?? 1) === 0).length;
  const productType =
    digitalCount === items.length ? "ebook" : digitalCount === 0 ? "physical" : "mixed";

  const meta: Record<string, string> = {
    item_count: String(items.length),
    product_type: productType,
    delivery_type: digitalCount === items.length ? "digital" : digitalCount === 0 ? "physical" : "mixed",
  };

  if (items.length === 1) {
    const item = items[0]!;
    meta["sku"] = item.sku.slice(0, META_VALUE_MAX);
    meta["product_name"] = item.product_name.slice(0, META_VALUE_MAX);
    meta["quantity"] = String(item.quantity);
    const category = byId.get(item.product_id)?.category;
    if (category) meta["category"] = category.slice(0, META_VALUE_MAX);
  } else {
    // Múltiplos itens: representação resumida dentro dos limites da Stripe.
    meta["sku"] = items.map((i) => i.sku).join(",").slice(0, META_VALUE_MAX);
    meta["product_name"] = `${items[0]!.product_name} +${items.length - 1} item(ns)`.slice(0, META_VALUE_MAX);
    meta["quantity"] = String(items.reduce((sum, i) => sum + i.quantity, 0));
    const categories = [...new Set(items.map((i) => byId.get(i.product_id)?.category).filter(Boolean))];
    if (categories.length > 0) meta["category"] = categories.join(",").slice(0, META_VALUE_MAX);
  }
  return meta;
}

/** The normal provider and the protected diagnostic share this operational allowlist. */
export function buildOrderPaymentMetadata(
  order: { store_id: string; id: string; order_number: string; environment: string; customer_id?: string | null },
  items: OrderItemRow[],
  products: { id: string; category: string | null; weight_grams: number }[],
): Record<string, string> {
  const itemsMetadata = buildItemsMetadata(items, products);
  const entrySkus = new Set(PURCHASE_ENTRY_SLUGS.map((slug) => purchaseEntryProduct(slug)!.sku));
  // The new anonymous /comprar entry sells one digital product, including an ebook bundle.
  // Existing customer-backed V1/V2 and storefront purchases retain their category metadata.
  if (order.customer_id === null && order.store_id === HHB_STORE_ID && items.length === 1 &&
      items[0]!.quantity === 1 && entrySkus.has(items[0]!.sku) && itemsMetadata["product_type"] === "ebook") {
    itemsMetadata["category"] = "ebook";
  }
  return pickOperationalMetadata({
    store_id: order.store_id,
    order_id: order.id,
    order_number: order.order_number,
    environment: order.environment,
    ...itemsMetadata,
  });
}

/**
 * Cria (ou reaproveita) o pagamento de um pedido.
 * Idempotente: chave estável `payment:create:{order_id}:{attempt}` na Stripe e
 * índice único no banco impedem cobranças duplicadas.
 */
export async function createOrderPayment(input: {
  store: StoreRow;
  orderId: string;
  /**
   * Aditivo e opcional. Ausente (padrão V1) => comportamento idêntico ao atual.
   * "order-number" (usado só pelo Checkout V2) força `Pedido {order_number}`.
   */
  descriptionMode?: "auto" | "order-number" | undefined;
}) {
  // As leituras abaixo são independentes entre si (todas dependem apenas
  // de `store` e `orderId`, já conhecidos) e nenhuma escreve. Rodam em paralelo;
  // a ORDEM DAS VALIDAÇÕES e as mensagens de erro permanecem exatamente as mesmas.
  // A atribuição NÃO é lida aqui: ela nunca vai para o metadata da Stripe.
  const [orderResult, integrationResult, existingResult, itemsResult] = await Promise.all([
    one<OrderRow>(sql`select * from public.orders where id = ${input.orderId} and store_id = ${input.store.id}`, true),
    fetchIntegrationForStore(input.store),
    one<PaymentRow>(sql`select * from public.payments where order_id = ${input.orderId}
      and status in ('REQUIRES_PAYMENT', 'PROCESSING')`, true),
    rows<OrderItemRow>(sql`select product_id, product_name, sku, quantity from public.order_items where order_id = ${input.orderId}`),
  ]);

  if (orderResult.error) throw checkoutFailure("db_unreachable", "payment.load-order", orderResult.error, "NOT_FOUND", "Order not found.");
  if (existingResult.error) logCheckoutFailure(existingResult.error, "payment.load-existing", "db_unreachable");
  if (itemsResult.error) logCheckoutFailure(itemsResult.error, "payment.load-items", "db_unreachable");

  const order = orderResult.data;
  if (!order) throw new PaymentError("NOT_FOUND", "Order not found.");
  if (!["PENDING_PAYMENT", "PAYMENT_PROCESSING"].includes(order.status)) {
    throw new PaymentError("INVALID_STATE", "This order no longer accepts payments.");
  }

  if (integrationResult.error) throw checkoutFailure("db_unreachable", "payment.load-integration", integrationResult.error, "CONFIG_ERROR", "Payment integration not found.");
  const integration = validateIntegration(
    input.store,
    integrationResult.data as IntegrationRow | null,
  );
  let provider: Awaited<ReturnType<typeof providerFromIntegration>>;
  try {
    provider = await providerFromIntegration(integration);
  } catch (error) {
    const stage = !integration.secret_key_ciphertext ? "no_stripe_integration"
      : classifyCheckoutFailure(error, "decrypt_failed");
    logCheckoutFailure(error, "payment.decrypt-key", stage);
    throw error;
  }

  const existing = existingResult.data;


  if (existing?.provider_payment_id) {
    let remote;
    try {
      remote = await provider.retrievePayment(existing.provider_payment_id);
    } catch (error) {
      logCheckoutFailure(error, "payment.retrieve-intent", "stripe_error");
      throw error;
    }
    if (remote.amountCents === order.total_cents && remote.clientSecret) {
      return {
        paymentId: existing.id,
        clientSecret: remote.clientSecret,
        publishableKey: integration.publishable_key,
        environment: order.environment,
        amountCents: order.total_cents,
        currency: order.currency,
        orderId: order.id,
      };
    }
    // Valor divergente: cancela e recria numa nova tentativa.
    await provider.cancelPayment(existing.provider_payment_id).catch((error) => logCheckoutFailure(error, "payment.cancel-intent", "stripe_error"));
    await orderWrite(sql`update public.payments set status = 'CANCELLED' where id = ${existing.id}`, "payment.mark-cancelled");
  }

  const { count, error: countError } = await rowCount(sql`select count(*) as count from public.payments where order_id = ${order.id}`);
  if (countError) logCheckoutFailure(countError, "payment.count-attempts", "db_unreachable");
  const attempt = (count ?? 0) + 1;
  const idempotencyKey = `payment:create:${order.id}:${attempt}`;

  const { data: payment, error: paymentError } = await one<PaymentRow>(sql`
    insert into public.payments (store_id, order_id, integration_id, amount_cents, currency, environment, attempt, idempotency_key)
    values (${order.store_id}, ${order.id}, ${integration.id}, ${order.total_cents}, ${order.currency},
      ${order.environment}, ${attempt}, ${idempotencyKey}) returning *
  `);
  if (paymentError || !payment) {
    throw checkoutFailure("db_unreachable", "payment.create-attempt", paymentError, "INVALID_STATE", "A payment is already in progress for this order.");
  }

  let created;
  // Enriquecimento: identifica os itens (SKU, nome, tipo digital/eBook) na Stripe.
  const itemRows = (itemsResult.data ?? []) as OrderItemRow[];
  const productIds = [...new Set(itemRows.map((i) => i.product_id))];
  const { data: productRows, error: productsError } = productIds.length
    ? await rows<{ id: string; category: string | null; weight_grams: number }>(sql`
        select id, category, weight_grams from public.products where id in ${sql(productIds)}
      `)
    : { data: [], error: null };
  if (productsError) logCheckoutFailure(productsError, "payment.load-product-metadata", "db_unreachable");
  // Allowlist final: SOMENTE metadata operacional vai para a Stripe.
  // Atribuição de marketing (UTMs, fbp/fbc/fbclid, referrer, landing_page,
  // IDs de sessão) e contexto do navegador (IP/UA/event_source_url) ficam
  // exclusivamente em `order_attribution`, para Meta CAPI, UTMify e analytics.
  const paymentIntentMetadata = buildOrderPaymentMetadata(order, itemRows, productRows ?? []);





  try {
    created = await provider.createPayment({
      amountCents: order.total_cents,
      currency: order.currency,
      idempotencyKey,
      description:
        input.descriptionMode === "order-number"
          ? `Order ${order.order_number}`
          : buildPaymentDescription(order, itemRows),
      metadata: paymentIntentMetadata,
      ...(integration.payment_method_configuration_id
        ? { paymentMethodConfiguration: integration.payment_method_configuration_id }
        : {}),
    });
  } catch (error) {
    await orderWrite(sql`update public.payments set status = 'FAILED', last_error = ${(error as Error).message} where id = ${payment.id}`, "payment.mark-failed");
    logCheckoutFailure(error, "payment.create-intent", "stripe_error");
    throw error;
  }

  await orderWrite(sql`update public.payments set provider_payment_id = ${created.providerPaymentId},
    status = ${mapProviderStatus(created.status)} where id = ${payment.id}`, "payment.save-intent");

  // Pós-processamento não bloqueante: nada abaixo é pré-requisito do
  // clientSecret devolvido ao checkout. Vai para ctx.waitUntil (com await de
  // fallback fora do Worker), preservando o mesmo trabalho e a mesma ordem.
  const { runInBackground } = await import("./background.server");
  await runInBackground(async () => {
    await orderWrite(sql`update public.orders set status = 'PAYMENT_PROCESSING' where id = ${order.id}`, "payment.mark-processing");
    await orderWrite(sql`insert into public.payment_events (order_id, payment_id, type, message, metadata)
      values (${order.id}, ${payment.id}, 'PAYMENT_CREATED', 'Payment created at provider', ${sql.json({ attempt })})`, "payment.record-created");

    const { recordServerEvent } = await import("@/lib/analytics/ingest.server");
    await recordServerEvent({
      eventId: `pi-created:${created.providerPaymentId}`,
      type: "payment_intent_created",
      storeId: order.store_id,
      integrationId: integration.id,
      orderId: order.id,
      publicToken: order.public_token,
      paymentIntentId: created.providerPaymentId,
      currency: order.currency,
      amountCents: order.total_cents,
      metadata: { attempt },
    });
  }, "payment.post-create");



  return {
    paymentId: payment.id,
    clientSecret: created.clientSecret,
    publishableKey: integration.publishable_key,
    environment: order.environment,
    amountCents: order.total_cents,
    currency: order.currency,
    orderId: order.id,
  };
}

/** Status público do pedido — sem dados internos da Stripe. */
export async function getOrderPublicStatus(input: { store: StoreRow; publicToken: string }) {
  const { data: order } = await one<Pick<OrderRow, "id" | "order_number" | "status" | "currency" | "subtotal_cents" | "shipping_cents" | "discount_cents" | "total_cents" | "shipping_method" | "created_at" | "paid_at"> & {
    order_items: Array<{ product_name: string; quantity: number; unit_price_cents: number; total_cents: number }>;
    addresses: { recipient_name: string; street: string; number: string; complement: string | null; district: string; city: string; state: string; postal_code: string } | null;
  }>(sql`
    select o.id, o.order_number, o.status, o.currency, o.subtotal_cents, o.shipping_cents, o.discount_cents,
      o.total_cents, o.shipping_method, o.created_at, o.paid_at,
      coalesce((select jsonb_agg(jsonb_build_object('product_name', i.product_name, 'quantity', i.quantity,
        'unit_price_cents', i.unit_price_cents, 'total_cents', i.total_cents))
        from public.order_items i where i.order_id = o.id), '[]'::jsonb) as order_items,
      case when a.id is null then null else jsonb_build_object('recipient_name', a.recipient_name,
        'street', a.street, 'number', a.number, 'complement', a.complement, 'district', a.district,
        'city', a.city, 'state', a.state, 'postal_code', a.postal_code) end as addresses
    from public.orders o left join public.addresses a on a.id = o.shipping_address_id
    where o.public_token = ${input.publicToken} and o.store_id = ${input.store.id}
  `, true);
  if (!order) throw new PaymentError("NOT_FOUND", "Order not found.");

  const { data: payment } = await one<Pick<PaymentRow, "status" | "payment_method" | "updated_at">>(sql`
    select status, payment_method, updated_at from public.payments where order_id = ${order.id} order by created_at desc limit 1
  `, true);

  return { order, paymentStatus: payment?.status ?? null };
}
