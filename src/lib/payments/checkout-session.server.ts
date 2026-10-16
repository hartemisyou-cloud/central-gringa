import { sql, one, rows } from "@/lib/db/client.server";
import type { Database } from "@/lib/db/types";
import type { StoreRow } from "./store-auth.server";
import { buildOrderPaymentMetadata, buildPaymentDescription, type OrderItemRow } from "./orders.server";
import { purchaseEntryProduct } from "./purchase-entry";
import { decryptSecret } from "./crypto.server";
import { CheckoutFailure, classifyCheckoutFailure, logCheckoutFailure, safeCheckoutError } from "./checkout-log.server";
import { PaymentError } from "./errors";
import { StripeService, type StripeCheckoutSession } from "./stripe.server";

type Order = Database["public"]["Tables"]["orders"]["Row"];
type Payment = Database["public"]["Tables"]["payments"]["Row"];
type Integration = Database["public"]["Tables"]["stripe_integrations"]["Row"];
export type EbookCheckoutOrder = Pick<Order, "id" | "store_id" | "order_number" | "public_token" | "environment" | "customer_id" | "total_cents" | "currency">;
export type EbookCheckoutItem = OrderItemRow & { unit_price_cents: number; total_cents: number };
export type EbookCheckoutProduct = { id: string; category: string | null; weight_grams: number };

export function checkoutIdempotencyKey(orderId: string, attempt: number): string {
  if (!orderId || !Number.isSafeInteger(attempt) || attempt < 1) throw new PaymentError("INVALID_INPUT", "Invalid checkout attempt.");
  return `checkout:create:${orderId}:${attempt}`;
}

/** Production and diagnostic use the same snapshots and operational metadata allowlist. */
export function buildEbookCheckoutSessionParams(input: {
  order: EbookCheckoutOrder;
  items: EbookCheckoutItem[];
  products: EbookCheckoutProduct[];
  slug: string;
  origin: string;
  createdAt: string | Date;
}) {
  const { order, items, products } = input;
  const expected = purchaseEntryProduct(input.slug);
  const item = items[0];
  const product = products.find(row => row.id === item?.product_id);
  if (!expected || items.length !== 1 || !item || item.product_id !== expected.id || item.sku !== expected.sku ||
      item.quantity !== 1 || product?.weight_grams !== 0 || order.currency !== "USD" ||
      !Number.isSafeInteger(item.unit_price_cents) || item.unit_price_cents < 1 ||
      item.total_cents !== item.unit_price_cents || order.total_cents !== item.total_cents) {
    throw new PaymentError("INVALID_INPUT", "Checkout requires one matching digital product in USD.");
  }
  const origin = new URL(input.origin);
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) {
    throw new PaymentError("INVALID_INPUT", "Invalid checkout origin.");
  }
  const createdSeconds = Math.floor(new Date(input.createdAt).getTime() / 1000);
  if (!Number.isSafeInteger(createdSeconds)) throw new PaymentError("INVALID_INPUT", "Invalid checkout creation time.");
  const metadata = buildOrderPaymentMetadata(order, items, products);
  return {
    mode: "payment" as const,
    // Stripe's wire value is "pay"; Checkout renders its localized purchase button.
    submit_type: "pay" as const,
    success_url: `${origin.origin}/order/${encodeURIComponent(order.public_token)}`,
    cancel_url: `${origin.origin}/comprar/${encodeURIComponent(input.slug)}`,
    // Stripe requires at least 30 minutes remaining when it receives the request.
    // A fixed 60-second transport margin keeps retries deterministic for this attempt.
    expires_at: createdSeconds + 31 * 60,
    metadata,
    payment_intent_data: { description: buildPaymentDescription(order, items), metadata: { ...metadata } },
    line_items: [{ quantity: 1, price_data: {
      currency: "usd",
      unit_amount: item.unit_price_cents,
      product_data: { name: item.product_name, description: `${buildPaymentDescription(order, items)} · Digital delivery, no shipping` },
    } }],
  };
}

/** Reject a mismatched provider response before sending a customer to its URL. */
export function validateEbookCheckoutSession(
  session: StripeCheckoutSession,
  order: EbookCheckoutOrder,
  metadata: Record<string, string>,
): string {
  let destination: URL;
  try { destination = new URL(session.url ?? ""); }
  catch { throw new PaymentError("PROVIDER_ERROR", "Stripe returned an invalid checkout destination."); }
  const keys = Object.keys(metadata);
  if (!session.id.startsWith("cs_") || session.status !== "open" || session.mode !== "payment" ||
      session.livemode !== (order.environment === "live") || session.amount_total !== order.total_cents ||
      session.currency !== "usd" || !session.metadata || Object.keys(session.metadata).length !== keys.length ||
      keys.some(key => session.metadata?.[key] !== metadata[key]) || destination.protocol !== "https:" ||
      destination.hostname !== "checkout.stripe.com" || destination.username || destination.password || destination.port) {
    throw new PaymentError("PROVIDER_ERROR", "Stripe returned an unexpected checkout binding, amount or destination.");
  }
  return destination.href;
}

function failure(stage: ConstructorParameters<typeof CheckoutFailure>[0], operation: string, error: unknown): never {
  const wrapped = new CheckoutFailure(stage, operation, error);
  logCheckoutFailure(wrapped, operation);
  throw wrapped;
}

/** Creates only an unpaid Session; the signed webhook remains the sole source of PAID. */
export async function createEbookCheckoutSession(input: { store: StoreRow; orderId: string; slug: string; origin: string }) {
  const [orderResult, itemResult, integrationResult, pendingResult] = await Promise.all([
    one<Order>(sql`select * from public.orders where id = ${input.orderId} and store_id = ${input.store.id}`, true),
    rows<EbookCheckoutItem>(sql`select product_id, product_name, sku, quantity, unit_price_cents, total_cents from public.order_items where order_id = ${input.orderId}`),
    input.store.stripe_integration_id
      ? one<Integration>(sql`select * from public.stripe_integrations where id = ${input.store.stripe_integration_id}`, true)
      : Promise.resolve({ data: null, error: null }),
    one<Payment>(sql`select * from public.payments where order_id = ${input.orderId} and status in ('REQUIRES_PAYMENT', 'PROCESSING')`, true),
  ]);
  for (const result of [orderResult, itemResult, integrationResult, pendingResult]) {
    if (result.error) failure("db_unreachable", "checkout.load-order", result.error);
  }
  const order = orderResult.data;
  if (!order) throw new PaymentError("NOT_FOUND", "Order not found.");
  if (!["PENDING_PAYMENT", "PAYMENT_PROCESSING"].includes(order.status)) throw new PaymentError("INVALID_STATE", "This order no longer accepts payments.");
  const integration = integrationResult.data;
  if (!integration || integration.status !== "ACTIVE" || integration.environment !== order.environment ||
      input.store.environment !== order.environment || !integration.secret_key_ciphertext) {
    failure("no_stripe_integration", "checkout.resolve-integration", new Error("An active matching database payment integration is required."));
  }
  let secret: string;
  try { secret = await decryptSecret(integration.secret_key_ciphertext!); }
  catch (error) { failure(classifyCheckoutFailure(error, "decrypt_failed"), "checkout.decrypt-key", error); }
  if (!new RegExp(`^(sk|rk)_${order.environment}_[A-Za-z0-9]+$`).test(secret)) {
    failure("no_stripe_integration", "checkout.resolve-integration", new Error("The database credential has an invalid format or mode."));
  }
  const items = itemResult.data ?? [];
  const productIds = [...new Set(items.map(item => item.product_id))];
  const productsResult = productIds.length
    ? await rows<EbookCheckoutProduct>(sql`select id, category, weight_grams from public.products where store_id = ${order.store_id} and id in ${sql(productIds)}`)
    : { data: [], error: null };
  if (productsResult.error) failure("db_unreachable", "checkout.load-products", productsResult.error);

  let payment = pendingResult.data;
  if (payment && (payment.integration_id !== integration.id || (payment.provider_payment_id && !payment.provider_payment_id.startsWith("cs_")) ||
      payment.idempotency_key !== checkoutIdempotencyKey(order.id, payment.attempt) ||
      payment.amount_cents !== order.total_cents || payment.currency !== order.currency || payment.environment !== order.environment)) {
    throw new PaymentError("INVALID_STATE", "A different payment is already in progress for this order.");
  }
  if (!payment) {
    const attemptResult = await one<{ attempt: number }>(sql`select coalesce(max(attempt), 0)::integer + 1 as attempt from public.payments where order_id = ${order.id}`);
    if (attemptResult.error || !attemptResult.data) failure("db_unreachable", "checkout.next-attempt", attemptResult.error);
    const attempt = attemptResult.data.attempt;
    const idempotencyKey = checkoutIdempotencyKey(order.id, attempt);
    const created = await one<Payment>(sql`insert into public.payments
      (store_id, order_id, integration_id, amount_cents, currency, environment, attempt, idempotency_key)
      values (${order.store_id}, ${order.id}, ${integration.id}, ${order.total_cents}, ${order.currency}, ${order.environment}, ${attempt}, ${idempotencyKey}) returning *`);
    if (created.error || !created.data) failure("db_unreachable", "checkout.create-attempt", created.error);
    payment = created.data;
  }
  const params = buildEbookCheckoutSessionParams({ order, items, products: productsResult.data ?? [], slug: input.slug, origin: input.origin, createdAt: payment.created_at });
  let session: StripeCheckoutSession;
  let url: string;
  try {
    const stripe = new StripeService(secret);
    if (!payment.provider_payment_id && params.expires_at <= Math.floor(Date.now() / 1000) + 30 * 60) {
      throw new PaymentError("INVALID_STATE", "The unpaid checkout attempt is too old to create safely.");
    }
    session = payment.provider_payment_id
      ? await stripe.retrieveCheckoutSession(payment.provider_payment_id)
      : await stripe.createCheckoutSession(params, checkoutIdempotencyKey(order.id, payment.attempt));
    url = validateEbookCheckoutSession(session, order, params.metadata);
    if (payment.provider_payment_id && payment.provider_payment_id !== session.id) throw new PaymentError("PROVIDER_ERROR", "Stripe returned a different Session for this checkout attempt.");
  } catch (error) {
    const saved = await one(sql`update public.payments set last_error = ${safeCheckoutError(error)} where id = ${payment.id} returning id`);
    if (saved.error) logCheckoutFailure(saved.error, "checkout.save-provider-failure", "db_unreachable");
    failure("stripe_error", "checkout.create-session", error);
  }
  // Persist the binding before exposing the Session. No new table/column is required.
  // One PostgreSQL statement atomically binds the provider object and appends its audit.
  // payment_events is INSERT-only for central_runtime; never query the audit table.
  const persisted = await one<{ id: string }>(sql`with bound as (
      update public.payments set provider_payment_id = ${session.id}, last_error = null
      where id = ${payment.id} and status in ('REQUIRES_PAYMENT', 'PROCESSING')
        and (provider_payment_id is null or provider_payment_id = ${session.id}) returning id
    ), recorded as (
      insert into public.payment_events (order_id, payment_id, type, message, metadata)
      select ${order.id}, id, 'CHECKOUT_SESSION_CREATED', 'Hosted checkout created at provider',
        ${sql.json({ checkout_session_id: session.id, attempt: payment.attempt })}
      from bound where ${!payment.provider_payment_id}
    ), processing as (
      update public.orders set status = 'PAYMENT_PROCESSING'
      where id = ${order.id} and status = 'PENDING_PAYMENT' and exists (select 1 from bound)
    ) select id from bound`);
  if (persisted.error || !persisted.data) failure("db_unreachable", "checkout.persist-session", persisted.error);
  return { sessionId: session.id, url, paymentId: payment.id };
}
