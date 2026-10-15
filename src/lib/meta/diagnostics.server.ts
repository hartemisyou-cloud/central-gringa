import { sql, rows, one } from "@/lib/db/client.server";
import type { Row } from "@/lib/db/types";
import { getMetaSettingsWithToken } from "./config.server";
import { GRAPH_VERSION, buildPayload, loadOrderContext, sanitizeError } from "./capi.server";

/**
 * Ferramenta ADMIN de diagnóstico (somente leitura).
 *
 * Nada aqui altera produção: não muda status, não cria PaymentIntent nem
 * cobrança, não envia UTMify e não grava em meta_conversion_events.
 * O único efeito externo possível é um Purchase enviado à Meta SOMENTE como
 * Test Event, com event_id exclusivo de teste (nunca `purchase_<order_id>`).
 */

const DIAG_TEST_EVENT_CODE = "TEST2904";

export type DiagOrderSummary = {
  orderId: string;
  orderNumber: string;
  status: string;
  totalCents: number;
  currency: string;
  createdAt: string;
  paidAt: string | null;
  hasAttribution: boolean;
};

/** Lista os pedidos recentes da loja (qualquer status) para escolha no painel. */
export async function listOrdersForDiagnostics(
  storeId: string,
  limit = 25,
): Promise<DiagOrderSummary[]> {
  const { data: orders } = await rows<Row<"orders">>(
    sql`SELECT id, order_number, status, total_cents, currency, created_at, paid_at FROM orders WHERE store_id = ${storeId} ORDER BY created_at DESC LIMIT ${limit}`,
  );
  if (!orders || orders.length === 0) return [];

  const { data: attributionRows } = await rows<Row<"order_attribution">>(
    sql`SELECT order_id FROM order_attribution WHERE order_id IN ${sql(orders.map((order) => order.id))}`,
  );
  const withAttribution = new Set((attributionRows ?? []).map((row) => row.order_id));

  return orders.map((order) => ({
    orderId: order.id,
    orderNumber: order.order_number,
    status: order.status,
    totalCents: order.total_cents,
    currency: order.currency,
    createdAt: order.created_at,
    paidAt: order.paid_at,
    hasAttribution: withAttribution.has(order.id),
  }));
}

export type DiagOrderDetail = {
  found: boolean;
  orderId: string | null;
  orderNumber: string | null;
  status: string | null;
  paidAt: string | null;
  value: number | null;
  currency: string | null;
  hasAttribution: boolean;
  attribution: {
    fbc: string | null;
    fbp: string | null;
    client_ip: string | null;
    client_user_agent: string | null;
    event_source_url: string | null;
    utm_source: string | null;
    utm_medium: string | null;
    utm_campaign: string | null;
    utm_content: string | null;
    utm_term: string | null;
  };
};

const EMPTY_ATTRIBUTION: DiagOrderDetail["attribution"] = {
  fbc: null,
  fbp: null,
  client_ip: null,
  client_user_agent: null,
  event_source_url: null,
  utm_source: null,
  utm_medium: null,
  utm_campaign: null,
  utm_content: null,
  utm_term: null,
};

/** Preview completo (somente leitura) dos dados armazenados no pedido. */
export async function inspectOrderForDiagnostics(input: {
  storeId: string;
  orderId: string;
}): Promise<DiagOrderDetail> {
  const empty: DiagOrderDetail = {
    found: false,
    orderId: null,
    orderNumber: null,
    status: null,
    paidAt: null,
    value: null,
    currency: null,
    hasAttribution: false,
    attribution: EMPTY_ATTRIBUTION,
  };

  const { data: order } = await one<Row<"orders">>(
    sql`SELECT id, order_number, status, paid_at, total_cents, currency FROM orders WHERE id = ${input.orderId} AND store_id = ${input.storeId}`,
    true,
  );
  if (!order) return empty;

  const { data: row } = await one<Row<"order_attribution">>(
    sql`SELECT fbc, fbp, client_ip, client_user_agent, event_source_url, utm_source, utm_medium, utm_campaign, utm_content, utm_term FROM order_attribution WHERE order_id = ${order.id}`,
    true,
  );

  return {
    found: true,
    orderId: order.id,
    orderNumber: order.order_number,
    status: order.status,
    paidAt: order.paid_at,
    value: order.total_cents / 100,
    currency: order.currency,
    hasAttribution: Boolean(row),
    attribution: row
      ? {
          fbc: row.fbc ?? null,
          fbp: row.fbp ?? null,
          client_ip: row.client_ip ?? null,
          client_user_agent: row.client_user_agent ?? null,
          event_source_url: row.event_source_url ?? null,
          utm_source: row.utm_source ?? null,
          utm_medium: row.utm_medium ?? null,
          utm_campaign: row.utm_campaign ?? null,
          utm_content: row.utm_content ?? null,
          utm_term: row.utm_term ?? null,
        }
      : EMPTY_ATTRIBUTION,
  };
}

export type DiagTestResult = {
  ok: boolean;
  message: string;
  isTest: true;
  testEventCode: string;
  httpStatus: number | null;
  eventId: string | null;
  value: number | null;
  currency: string | null;
  orderNumber: string | null;
  orderStatus: string | null;
  sentAttribution: Record<string, string | null>;
  metaResponse: string | null;
};

/**
 * Envia o Purchase do pedido escolhido SOMENTE como Test Event (TEST2904),
 * mesmo que o pedido não esteja PAID. Usa exclusivamente os dados já
 * armazenados — nada é inventado — e não grava nada no banco.
 */
export async function sendDiagnosticTestPurchase(input: {
  storeId: string;
  orderId: string;
}): Promise<DiagTestResult> {
  const base: DiagTestResult = {
    ok: false,
    message: "",
    isTest: true,
    testEventCode: DIAG_TEST_EVENT_CODE,
    httpStatus: null,
    eventId: null,
    value: null,
    currency: null,
    orderNumber: null,
    orderStatus: null,
    sentAttribution: {},
    metaResponse: null,
  };

  const settings = await getMetaSettingsWithToken(input.storeId);
  if (!settings) {
    return { ...base, message: "Meta integration disabled or incomplete for this store." };
  }

  const { data: owned } = await one<Row<"orders">>(
    sql`SELECT id FROM orders WHERE id = ${input.orderId} AND store_id = ${input.storeId}`,
    true,
  );
  if (!owned) return { ...base, message: "Order not found in this store." };

  const context = await loadOrderContext(input.orderId, input.storeId);
  if (!context) return { ...base, message: "Order not found in this store." };

  const eventId = `diag_test_purchase_${context.orderId}_${Date.now()}`;
  const payload = await buildPayload(context, {
    eventIdOverride: eventId,
    testEventCode: DIAG_TEST_EVENT_CODE,
  });
  const event = (payload["data"] as Array<Record<string, unknown>>)[0]!;
  const userData = event["user_data"] as Record<string, unknown>;
  const customData = event["custom_data"] as Record<string, unknown>;

  const asText = (value: unknown) => (value == null ? null : String(value));
  const sentAttribution: Record<string, string | null> = {
    fbc: asText(userData["fbc"]),
    fbp: asText(userData["fbp"]),
    client_ip_address: asText(userData["client_ip_address"]),
    client_user_agent: asText(userData["client_user_agent"]),
    event_source_url: asText(event["event_source_url"]),
    utm_source: asText(customData["utm_source"]),
    utm_medium: asText(customData["utm_medium"]),
    utm_campaign: asText(customData["utm_campaign"]),
    utm_content: asText(customData["utm_content"]),
    utm_term: asText(customData["utm_term"]),
  };

  let httpStatus: number | null = null;
  let metaResponse: string | null = null;
  let ok = false;
  try {
    const response = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${settings.pixelId}/events`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${settings.accessToken}`,
        },
        body: JSON.stringify(payload),
      },
    );
    httpStatus = response.status;
    metaResponse = sanitizeError(await response.text());
    ok = response.ok;
  } catch (error) {
    metaResponse = sanitizeError((error as Error).message);
  }

  console.log(
    `[meta-capi-diagnostic] store=${input.storeId} order=${context.orderId} event_id=${eventId} http=${httpStatus ?? "n/a"} ok=${ok}`,
  );

  return {
    ...base,
    ok,
    message: ok
      ? `TEST EVENT accepted by Meta (HTTP ${httpStatus}). Not a real sale.`
      : `Failed to send TEST EVENT${httpStatus ? ` (HTTP ${httpStatus})` : ""}.`,
    httpStatus,
    eventId,
    value: Number(customData["value"] ?? context.valueCents / 100),
    currency: String(customData["currency"] ?? context.currency).toUpperCase(),
    orderNumber: context.orderNumber,
    orderStatus: context.status,
    sentAttribution,
    metaResponse,
  };
}
