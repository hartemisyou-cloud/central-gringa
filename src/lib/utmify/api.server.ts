import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getOrderAttributionRecord } from "@/lib/payments/attribution.server";
import type { Attribution, OrderAttributionRecord } from "@/lib/payments/attribution";
import { getUtmifySettingsWithToken, recordUtmifyHealth } from "./config.server";

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
  paymentMethod: string | null;
  items: Array<{ id: string; name: string; quantity: number; priceInCents: number }>;
}

async function loadOrderContext(orderId: string): Promise<OrderContext | null> {
  const { data: order } = await supabaseAdmin
    .from("orders")
    .select(
      "id, store_id, order_number, currency, total_cents, status, created_at, paid_at, customers:customer_id(email, phone, first_name, last_name, document), addresses:shipping_address_id(country), order_items(product_id, product_name, quantity, unit_price_cents)",
    )
    .eq("id", orderId)
    .maybeSingle();
  if (!order) return null;

  const customer = order.customers as {
    email?: string | null;
    phone?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    document?: string | null;
  } | null;
  const address = order.addresses as { country?: string | null } | null;

  const { data: payment } = await supabaseAdmin
    .from("payments")
    .select("payment_method")
    .eq("order_id", order.id)
    .eq("status", "SUCCEEDED")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const name = [customer?.first_name, customer?.last_name].filter(Boolean).join(" ").trim();

  return {
    orderId: order.id,
    storeId: order.store_id,
    orderNumber: order.order_number,
    currency: order.currency.toUpperCase(),
    totalCents: order.total_cents,
    status: order.status,
    createdAt: order.created_at,
    paidAt: order.paid_at,
    customerName: name || null,
    email: customer?.email ?? null,
    phone: customer?.phone ?? null,
    document: customer?.document ?? null,
    country: address?.country ?? null,
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
  for (const key of ["gclid", "fbclid", "ttclid", "msclkid", "gbraid", "wbraid", "fbp", "fbc"] as const) {
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
      ip: options.clientIp ?? null,
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

async function postToUtmify(
  apiToken: string,
  body: unknown,
): Promise<UtmifySendResult> {
  let response: Response;
  try {
    response = await fetch(UTMIFY_ORDERS_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-token": apiToken },
      body: JSON.stringify(body),
    });
  } catch (error) {
    return { ok: false, error: sanitizeError((error as Error).message) };
  }
  const text = await response.text();
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
  clientIp?: string | null;
}): Promise<UtmifySendResult> {
  try {
    const settings = await getUtmifySettingsWithToken(input.storeId);
    if (!settings) return { ok: true, skipped: "utmify_disabled" };

    const context = await loadOrderContext(input.orderId);
    if (!context) return { ok: true, skipped: "order_not_found" };
    // Só venda efetivamente aprovada. Recusado/cancelado/criado nunca chega aqui.
    if (context.status !== "PAID") return { ok: true, skipped: "order_not_paid" };

    // Idempotência: uma linha por (store_id, order_id, event_status).
    const { data: existing } = await supabaseAdmin
      .from("utmify_events")
      .select("id, status, attempt_count")
      .eq("store_id", input.storeId)
      .eq("order_id", input.orderId)
      .eq("event_status", "paid")
      .maybeSingle();

    if (existing?.status === "SENT") return { ok: true, skipped: "already_sent" };
    if (existing?.status === "FAILED_PERMANENT" && existing.attempt_count >= MAX_ATTEMPTS) {
      return { ok: true, skipped: "permanent_failure" };
    }

    let rowId = existing?.id ?? null;
    if (!rowId) {
      const { data: inserted } = await supabaseAdmin
        .from("utmify_events")
        .insert({
          store_id: input.storeId,
          order_id: input.orderId,
          order_number: context.orderNumber,
          event_status: "paid",
          status: "PENDING",
        })
        .select("id")
        .maybeSingle();
      // Corrida entre workers: o índice único garante um único envio.
      if (!inserted) return { ok: true, skipped: "in_flight" };
      rowId = inserted.id;
    }

    // Atribuição + telemetria do navegador (IP real do comprador persistido em
    // order_attribution.client_ip). Nunca usamos o IP do worker/servidor.
    const attributionRecord = await getOrderAttributionRecord(input.orderId).catch(
      () => ({}) as OrderAttributionRecord,
    );
    const attribution: Attribution = attributionRecord;
    const payload = buildSalePayload(context, attribution, {
      isTest: settings.isTest,
      clientIp: input.clientIp ?? attributionRecord.client_ip ?? null,
    });
    const result = await postToUtmify(settings.apiToken, payload);
    const attempt = (existing?.attempt_count ?? 0) + 1;

    await supabaseAdmin
      .from("utmify_events")
      .update({
        status: result.ok
          ? "SENT"
          : result.permanent || attempt >= MAX_ATTEMPTS
            ? "FAILED_PERMANENT"
            : "FAILED",
        attempt_count: attempt,
        http_status: result.httpStatus ?? null,
        last_error: result.ok ? null : result.error,
      })
      .eq("id", rowId);

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
  const { data: rows } = await supabaseAdmin
    .from("utmify_events")
    .select("order_id, attempt_count")
    .eq("store_id", storeId)
    .in("status", ["PENDING", "FAILED"])
    .order("created_at", { ascending: true })
    .limit(20);

  let retried = 0;
  for (const row of rows ?? []) {
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
    return { ok: false, message: "Integração UTMify desativada ou sem token para esta loja." };
  }
  try {
    const response = await fetch(UTMIFY_ORDERS_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-token": settings.apiToken },
      body: JSON.stringify({}),
    });
    const text = await response.text();
    if (response.status === 401 || response.status === 403) {
      const message = "Token da UTMify recusado (401/403). Verifique a credencial.";
      await recordUtmifyHealth(storeId, { ok: false, error: message });
      return { ok: false, message };
    }
    if (response.status >= 500) {
      const message = `UTMify indisponível no momento (HTTP ${response.status}).`;
      await recordUtmifyHealth(storeId, { ok: false, error: message });
      return { ok: false, message };
    }
    await recordUtmifyHealth(storeId, { ok: true });
    return {
      ok: true,
      message: `Autenticação aceita pela UTMify (HTTP ${response.status}) — nenhuma venda foi criada.${
        text ? "" : ""
      }`,
    };
  } catch (error) {
    const message = sanitizeError((error as Error).message);
    await recordUtmifyHealth(storeId, { ok: false, error: message });
    return { ok: false, message };
  }
}
