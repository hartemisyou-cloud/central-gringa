import { sql, rows, one, exec } from "@/lib/db/client.server";
import type { Row } from "@/lib/db/types";
import {
  getOrderAttributionRecord,
  type OrderAttributionRecord,
} from "@/lib/payments/attribution.server";
import type { Attribution } from "@/lib/payments/attribution";
import { getUtmifySettingsWithToken, recordUtmifyHealth } from "./config.server";
import { normalizeCheckoutCustomerDetails } from "@/lib/payments/checkout-customer.server";

/**
 * Integração server-side com a API oficial da UTMify.
 *
 * Regras invioláveis:
 * - a venda só é enviada após `payment_intent.succeeded` (fonte de verdade);
 * - idempotente por (store_id, order_id, event_status): webhook reenviado da
 *   Stripe NUNCA gera venda duplicada;
 * - o API Token viaja apenas no header `x-api-token`, do servidor para a
 *   UTMify — nunca chega ao navegador nem aparece em log;
 * - qualquer falha aqui é isolada: não altera pagamento, pedido, Meta nem o
 *   webhook Stripe → UTMify já existente (que continua ativo em paralelo).
 */

const UTMIFY_ORDERS_URL = "https://api.utmify.com.br/api-credentials/orders";
const MAX_ATTEMPTS = 4;

export type UtmifySendResult =
  | { ok: true; skipped?: string; httpStatus?: number }
  | { ok: false; error: string; httpStatus?: number; permanent?: boolean };

/** Remove qualquer credencial de mensagens antes de persistir/logar. */
function sanitizeError(message: string): string {
  return message
    .replace(/x-api-token[^\s",}]*/gi, "x-api-token=[redacted]")
    .replace(/[A-Za-z0-9]{32,}/g, "[redacted]")
    .slice(0, 500);
}

/** UTMify espera datas UTC no formato `YYYY-MM-DD HH:MM:SS`. */
function utcDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 19).replace("T", " ");
}

/** Mapeamento estrito — nenhum tipo inventado. */
export function mapPaymentMethod(method: string | null): string {
  switch ((method ?? "").toLowerCase()) {
    case "card":
    case "apple_pay":
    case "google_pay":
    case "link":
      return "credit_card";
    case "pix":
      return "pix";
    case "boleto":
      return "boleto";
    default:
      // Card é o único método habilitado hoje (incl. Apple/Google Pay via card).
      return "credit_card";
  }
}

export interface OrderContext {
  orderId: string;
  storeId: string;
  orderNumber: string;
  currency: string;
  totalCents: number;
  status: string;
  createdAt: string;
  paidAt: string | null;
  customerName: string | null;
  email: string | null;
  phone: string | null;
  document: string | null;
  country: string | null;
  clientIp?: string | null;
  paymentMethod: string | null;
  items: Array<{ id: string; name: string; quantity: number; priceInCents: number }>;
}

type JoinedOrder = Row<"orders"> & {
  customers: Pick<
    Row<"customers">,
    "email" | "phone" | "first_name" | "last_name" | "document"
  > | null;
  order_items: Pick<
    Row<"order_items">,
    "product_id" | "product_name" | "quantity" | "unit_price_cents"
  >[];
};

async function loadOrderContext(orderId: string, storeId: string): Promise<OrderContext | null> {
  const { data: order } = await one<JoinedOrder>(
    sql`
    SELECT o.id, o.store_id, o.order_number, o.currency, o.total_cents, o.status, o.created_at, o.paid_at,
      o.client_ip, o.checkout_customer_details,
      CASE WHEN c.id IS NULL THEN NULL ELSE jsonb_build_object('email', c.email, 'phone', c.phone,
        'first_name', c.first_name, 'last_name', c.last_name, 'document', c.document) END AS customers,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('product_id', i.product_id, 'product_name', i.product_name,
        'quantity', i.quantity, 'unit_price_cents', i.unit_price_cents)) FROM order_items i
        WHERE i.order_id = o.id), '[]'::jsonb) AS order_items
    FROM orders o LEFT JOIN customers c ON c.id = o.customer_id
    WHERE o.id = ${orderId} AND o.store_id = ${storeId}`,
    true,
  );
  if (!order) return null;

  const customer = order.customers as {
    email?: string | null;
    phone?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    document?: string | null;
  } | null;

  const { data: payment } = await one<Row<"payments">>(
    sql`SELECT payment_method FROM payments WHERE order_id = ${order.id} AND status = ${"SUCCEEDED"} ORDER BY created_at DESC LIMIT 1`,
    true,
  );

  const name = [customer?.first_name, customer?.last_name].filter(Boolean).join(" ").trim();
  const checkout = normalizeCheckoutCustomerDetails(order.checkout_customer_details);

  return {
    orderId: order.id,
    storeId: order.store_id,
    orderNumber: order.order_number,
    currency: order.currency.toUpperCase(),
    totalCents: order.total_cents,
    status: order.status,
    createdAt: order.created_at,
    paidAt: order.paid_at,
    customerName: checkout ? checkout.name : name || null,
    email: checkout ? checkout.email : customer?.email ?? null,
    phone: customer?.phone ?? null,
    document: customer?.document ?? null,
    country: checkout?.address.country ?? null,
    clientIp: order.client_ip ?? null,
    paymentMethod: payment?.payment_method ?? null,
    items: (order.order_items ?? []).map((item) => ({
      id: item.product_id,
      name: item.product_name,
      quantity: item.quantity,
      priceInCents: item.unit_price_cents,
    })),
  };
}

/**
 * Mapeia pedido + order_attribution para o formato da UTMify.
 * Campos ausentes ficam `null` — nada é inventado nem preenchido com falsos.
 */
export function buildSalePayload(
  context: OrderContext,
  attribution: Attribution,
  options: { isTest: boolean; clientIp?: string | null },
) {
  const tracking: Record<string, string | null> = {
    src: attribution.click_id ?? null,
    sck: attribution.checkout_session_id ?? null,
    utm_source: attribution.utm_source ?? null,
    utm_campaign: attribution.utm_campaign ?? null,
    utm_medium: attribution.utm_medium ?? null,
    utm_content: attribution.utm_content ?? null,
    utm_term: attribution.utm_term ?? null,
  };
  // Identificadores de clique já capturados internamente, quando existirem.
  for (const key of [
    "gclid",
    "fbclid",
    "ttclid",
    "msclkid",
    "gbraid",
    "wbraid",
    "fbp",
    "fbc",
  ] as const) {
    if (attribution[key]) tracking[key] = attribution[key] ?? null;
  }

  return {
    orderId: context.orderId,
    platform: "CentralSparkPay",
    paymentMethod: mapPaymentMethod(context.paymentMethod),
    status: "paid",
    createdAt: utcDate(context.createdAt),
    approvedDate: utcDate(context.paidAt ?? context.createdAt),
    refundedAt: null,
    customer: {
      name: context.customerName,
      email: context.email,
      phone: context.phone,
      document: context.document,
      country: context.country,
      ip: context.clientIp ?? options.clientIp ?? null,
    },
    products: context.items.map((item) => ({
      id: item.id,
      name: item.name,
      planId: null,
      planName: null,
      quantity: item.quantity,
      priceInCents: item.priceInCents,
    })),
    trackingParameters: tracking,
    commission: {
      totalPriceInCents: context.totalCents,
      gatewayFeeInCents: 0,
      userCommissionInCents: context.totalCents,
      currency: context.currency,
    },
    isTest: options.isTest,
  };
}

async function postToUtmify(apiToken: string, body: unknown): Promise<UtmifySendResult> {
  let response: Response;
  let text: string;
  try {
    response = await fetch(UTMIFY_ORDERS_URL, {
      method: "POST",
      signal: AbortSignal.timeout(10000),
      headers: { "content-type": "application/json", "x-api-token": apiToken },
      body: JSON.stringify(body),
    });
    text = await response.text();
  } catch (error) {
    return { ok: false, error: sanitizeError((error as Error).message) };
  }
  if (response.ok) return { ok: true, httpStatus: response.status };
  const permanent = response.status >= 400 && response.status < 500 && response.status !== 429;
  return {
    ok: false,
    error: sanitizeError(text || `HTTP ${response.status}`),
    httpStatus: response.status,
    permanent,
  };
}

/** Envio idempotente da venda aprovada. Nunca lança. */
export async function sendSaleForOrder(input: {
  orderId: string;
  storeId: string;
}): Promise<UtmifySendResult> {
  try {
    const settings = await getUtmifySettingsWithToken(input.storeId);
    if (!settings) return { ok: true, skipped: "utmify_disabled" };

    const context = await loadOrderContext(input.orderId, input.storeId);
    if (!context) return { ok: true, skipped: "order_not_found" };
    // Só venda efetivamente aprovada. Recusado/cancelado/criado nunca chega aqui.
    if (context.status !== "PAID") return { ok: true, skipped: "order_not_paid" };

    // Idempotência: uma linha por (store_id, order_id, event_status).
    const { data: existing } = await one<Row<"utmify_events">>(
      sql`SELECT id, status, attempt_count FROM utmify_events WHERE store_id = ${input.storeId} AND order_id = ${input.orderId} AND event_status = ${"paid"}`,
      true,
    );

    if (existing?.status === "SENT") return { ok: true, skipped: "already_sent" };
    if (existing?.status === "FAILED_PERMANENT" && existing.attempt_count >= MAX_ATTEMPTS) {
      return { ok: true, skipped: "permanent_failure" };
    }

    let rowId = existing?.id ?? null;
    if (!rowId) {
      const { data: inserted } = await one<{ id: string }>(
        sql`INSERT INTO utmify_events (store_id, order_id, order_number, event_status, status) VALUES (${input.storeId}, ${input.orderId}, ${context.orderNumber}, ${"paid"}, ${"PENDING"}) RETURNING id`,
        true,
      );
      // Corrida entre workers: o índice único garante um único envio.
      if (!inserted) return { ok: true, skipped: "in_flight" };
      rowId = inserted.id;
    }

    // Marketing attribution stays separate; the order is the source of the
    // purchase-entry IP, including when attribution has no row.
    const attributionRecord = await getOrderAttributionRecord(input.orderId).catch(
      () => ({}) as OrderAttributionRecord,
    );
    const attribution: Attribution = attributionRecord;
    const payload = buildSalePayload(context, attribution, {
      isTest: settings.isTest,
      clientIp: context.clientIp ?? null,
    });
    const missing = (["name", "email", "ip", "country"] as const)
      .filter(field => payload.customer[field] === null);
    if (missing.length) {
      console.warn(`[utmify] order=${input.orderId} missing_customer_fields=${missing.join(",")} sending_nulls=true`);
    }
    const result = await postToUtmify(settings.apiToken, payload);
    const attempt = (existing?.attempt_count ?? 0) + 1;

    const status = result.ok
      ? "SENT"
      : result.permanent || attempt >= MAX_ATTEMPTS
        ? "FAILED_PERMANENT"
        : "FAILED";
    await exec(
      sql`UPDATE utmify_events SET status = ${status}, attempt_count = ${attempt}, http_status = ${result.httpStatus ?? null}, last_error = ${result.ok ? null : result.error} WHERE id = ${rowId}`,
    );

    await recordUtmifyHealth(input.storeId, {
      ok: result.ok,
      error: result.ok ? null : result.error,
      orderNumber: context.orderNumber,
    });

    // Log sem credenciais: apenas identificadores e resultado.
    console.log(
      `[utmify] store=${input.storeId} order=${input.orderId} order_number=${context.orderNumber} event=paid status=${result.ok ? "SENT" : "FAILED"} http=${result.httpStatus ?? "n/a"} attempt=${attempt} at=${new Date().toISOString()}`,
    );

    return result;
  } catch (error) {
    return { ok: false, error: sanitizeError((error as Error).message) };
  }
}

/** Reenvio manual dos envios pendentes/falhos (nunca duplica: reusa a mesma linha). */
export async function retryFailedUtmifyEvents(storeId: string): Promise<{ retried: number }> {
  const { data: pendingRows } = await rows<Row<"utmify_events">>(
    sql`SELECT order_id, attempt_count FROM utmify_events WHERE store_id = ${storeId} AND status IN (${"PENDING"}, ${"FAILED"}) ORDER BY created_at ASC LIMIT 20`,
  );

  let retried = 0;
  for (const row of pendingRows ?? []) {
    if (!row.order_id) continue;
    await new Promise((resolve) => setTimeout(resolve, Math.min(row.attempt_count, 3) * 300));
    await sendSaleForOrder({ orderId: row.order_id, storeId });
    retried += 1;
  }
  return { retried };
}

/**
 * Teste de conexão: valida credencial/endpoint SEM criar venda.
 * Envia um corpo vazio: token inválido → 401/403; token válido → erro de
 * validação (nenhum pedido é registrado na UTMify).
 */
export async function testUtmifyConnection(
  storeId: string,
): Promise<{ ok: boolean; message: string }> {
  const settings = await getUtmifySettingsWithToken(storeId);
  if (!settings) {
    return { ok: false, message: "UTMify integration disabled or missing token for this store." };
  }
  try {
    const response = await fetch(UTMIFY_ORDERS_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-token": settings.apiToken },
      body: JSON.stringify({}),
    });
    const text = await response.text();
    if (response.status === 401 || response.status === 403) {
      const message = "UTMify token rejected (401/403). Check credentials.";
      await recordUtmifyHealth(storeId, { ok: false, error: message });
      return { ok: false, message };
    }
    if (response.status >= 500) {
      const message = `UTMify currently unavailable (HTTP ${response.status}).`;
      await recordUtmifyHealth(storeId, { ok: false, error: message });
      return { ok: false, message };
    }
    await recordUtmifyHealth(storeId, { ok: true });
    return {
      ok: true,
      message: `Authentication accepted by UTMify (HTTP ${response.status}) — no sale was created.${
        text ? "" : ""
      }`,
    };
  } catch (error) {
    const message = sanitizeError((error as Error).message);
    await recordUtmifyHealth(storeId, { ok: false, error: message });
    return { ok: false, message };
  }
}

/* ------------------------------------------------------------------ */
/* Ação administrativa temporária: reenvio de UMA única ordem           */
/* ------------------------------------------------------------------ */

function maskIp(ip: string | null): string | null {
  if (!ip) return null;
  if (ip.includes(":")) return `${ip.split(":").slice(0, 2).join(":")}:***`;
  const parts = ip.split(".");
  return parts.length === 4 ? `${parts[0]}.${parts[1]}.${parts[2]}.***` : "***";
}

/**
 * Reenvia à UTMify SOMENTE o pedido informado (por order_number).
 * Não cria pedido/PaymentIntent, não altera status financeiro, não dispara
 * Meta. Reutiliza a linha existente em utmify_events (nunca duplica).
 */
export async function resendUtmifySaleForOrderNumber(orderNumber: string): Promise<{
  ok: boolean;
  message: string;
  orderNumber: string;
  orderStatus?: string;
  clientIpMasked?: string | null;
  httpStatus?: number | null;
  responseBody?: string | null;
  eventStatus?: string | null;
  attemptCount?: number | null;
}> {
  const { data: order } = await one<Row<"orders">>(
    sql`SELECT id, store_id, status FROM orders WHERE order_number = ${orderNumber}`,
    true,
  );
  if (!order) return { ok: false, message: "Order not found.", orderNumber };
  if (order.status !== "PAID") {
    return {
      ok: false,
      message: "Only paid orders can be sent to UTMify.",
      orderNumber,
      orderStatus: order.status,
    };
  }

  const settings = await getUtmifySettingsWithToken(order.store_id);
  if (!settings) {
    return {
      ok: false,
      message: "UTMify disabled or missing token for the order's store.",
      orderNumber,
    };
  }

  const context = await loadOrderContext(order.id, order.store_id);
  if (!context) return { ok: false, message: "Order context unavailable.", orderNumber };
  if (context.status !== "PAID") {
    return {
      ok: false,
      message: "Only paid orders can be sent to UTMify.",
      orderNumber,
      orderStatus: context.status,
    };
  }

  const attributionRecord = await getOrderAttributionRecord(order.id).catch(
    () => ({}) as OrderAttributionRecord,
  );
  const clientIp = context.clientIp ?? null;
  const payload = buildSalePayload(context, attributionRecord as Attribution, {
    isTest: settings.isTest,
    clientIp,
  });

  let httpStatus: number | null = null;
  let responseBody: string | null = null;
  let ok = false;
  try {
    const response = await fetch(UTMIFY_ORDERS_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-token": settings.apiToken },
      body: JSON.stringify(payload),
    });
    httpStatus = response.status;
    responseBody = sanitizeError((await response.text()).slice(0, 800));
    ok = response.ok;
  } catch (error) {
    responseBody = sanitizeError((error as Error).message);
  }

  const { data: existing } = await one<Row<"utmify_events">>(
    sql`SELECT id, attempt_count FROM utmify_events WHERE store_id = ${order.store_id} AND order_id = ${order.id} AND event_status = ${"paid"}`,
    true,
  );

  const attempt = (existing?.attempt_count ?? 0) + 1;
  const permanent =
    httpStatus !== null && httpStatus >= 400 && httpStatus < 500 && httpStatus !== 429;
  const eventStatus = ok ? "SENT" : permanent ? "FAILED_PERMANENT" : "FAILED";

  if (existing?.id) {
    await exec(
      sql`UPDATE utmify_events SET status = ${eventStatus}, attempt_count = ${attempt}, http_status = ${httpStatus}, last_error = ${ok ? null : responseBody} WHERE id = ${existing.id}`,
    );
  } else {
    await exec(
      sql`INSERT INTO utmify_events (store_id, order_id, order_number, event_status, status, attempt_count, http_status, last_error) VALUES (${order.store_id}, ${order.id}, ${context.orderNumber}, ${"paid"}, ${eventStatus}, ${attempt}, ${httpStatus}, ${ok ? null : responseBody})`,
    );
  }

  await recordUtmifyHealth(order.store_id, {
    ok,
    error: ok ? null : responseBody,
    orderNumber: context.orderNumber,
  });

  return {
    ok,
    message: ok
      ? `Sale accepted by UTMify (HTTP ${httpStatus}).`
      : `UTMify rejected the shipment (HTTP ${httpStatus ?? "n/a"}).`,
    orderNumber: context.orderNumber,
    orderStatus: context.status,
    clientIpMasked: maskIp(clientIp),
    httpStatus,
    responseBody,
    eventStatus,
    attemptCount: attempt,
  };
}
