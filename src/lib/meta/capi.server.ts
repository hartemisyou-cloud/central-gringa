import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  getOrderAttributionRecord,
  type OrderAttributionRecord,
} from "@/lib/payments/attribution.server";
import type { Attribution } from "@/lib/payments/attribution";
import { getMetaSettingsWithToken, recordMetaHealth } from "./config.server";
import { hashCountry, hashEmail, hashName, hashPhone, hashZip } from "./hash";

/**
 * Meta Conversions API — Purchase server-side.
 *
 * Regras invioláveis:
 * - só é disparado após `payment_intent.succeeded` (fonte de verdade financeira);
 * - `event_id` = order_id, idêntico ao do Pixel do navegador (deduplicação);
 * - idempotente por (store_id, event_id, event_name): webhook reenviado não duplica;
 * - falha da Meta NUNCA altera o status do pagamento nem lança para o webhook.
 */

export const GRAPH_VERSION = "v21.0";
const MAX_ATTEMPTS = 4;

/**
 * event_id determinístico do Purchase: `purchase_{order_id}`.
 * O mesmo valor é reutilizado em TODOS os retries e seria o mesmo usado por um
 * eventual Purchase de navegador — é ele que garante a deduplicação na Meta.
 */
export function purchaseEventId(orderId: string): string {
  return `purchase_${orderId}`;
}

export type MetaSendResult =
  | { ok: true; skipped?: string; httpStatus?: number; metaEventId?: string | null }
  | { ok: false; error: string; httpStatus?: number; permanent?: boolean };

export function sanitizeError(message: string): string {
  return message
    .replace(/EAA[A-Za-z0-9_-]{10,}/g, "[token]")
    .replace(/access_token=[^&\s"]+/gi, "access_token=[redacted]")
    .slice(0, 500);
}

export interface OrderContext {
  orderId: string;
  storeId: string;
  orderNumber: string;
  currency: string;
  valueCents: number;
  paidAt: string | null;
  status: string;
  publicToken: string;
  email: string | null;
  phone: string | null;
  firstName: string | null;
  lastName: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  items: Array<{ productId: string; quantity: number; totalCents: number }>;
  storeDomain: string | null;
}

export async function loadOrderContext(orderId: string): Promise<OrderContext | null> {
  const { data: order } = await supabaseAdmin
    .from("orders")
    .select(
      "id, store_id, order_number, currency, total_cents, paid_at, status, public_token, customers:customer_id(email, phone, first_name, last_name), addresses:shipping_address_id(city, state, postal_code, country), order_items(product_id, quantity, total_cents), stores:store_id(domain)",
    )
    .eq("id", orderId)
    .maybeSingle();
  if (!order) return null;
  const customer = order.customers as {
    email?: string | null;
    phone?: string | null;
    first_name?: string | null;
    last_name?: string | null;
  } | null;
  const address = order.addresses as {
    city?: string | null;
    state?: string | null;
    postal_code?: string | null;
    country?: string | null;
  } | null;
  const store = order.stores as { domain?: string | null } | null;

  return {
    orderId: order.id,
    storeId: order.store_id,
    orderNumber: order.order_number,
    currency: order.currency,
    valueCents: order.total_cents,
    paidAt: order.paid_at,
    status: order.status,
    publicToken: order.public_token,
    email: customer?.email ?? null,
    phone: customer?.phone ?? null,
    firstName: customer?.first_name ?? null,
    lastName: customer?.last_name ?? null,
    city: address?.city ?? null,
    state: address?.state ?? null,
    postalCode: address?.postal_code ?? null,
    country: address?.country ?? null,
    items: (order.order_items ?? []).map((item) => ({
      productId: item.product_id,
      quantity: item.quantity,
      totalCents: item.total_cents,
    })),
    storeDomain: store?.domain ?? null,
  };
}

/**
 * URL real da conversão. Prioridade:
 * 1) URL da página de checkout onde a compra aconteceu (capturada no navegador);
 * 2) landing page da atribuição;
 * 3) domínio público cadastrado da loja.
 *
 * Domínios internos da Central (central-spark-pay.lovable.app e
 * stripe-hub.lovable.app) NUNCA são usados, nem como fallback.
 */
function eventSourceUrl(
  context: OrderContext,
  attribution: OrderAttributionRecord,
): string | undefined {
  const captured = attribution.event_source_url;
  if (isPublicPageUrl(captured)) return captured!;
  const landing = attribution.landing_page;
  if (isPublicPageUrl(landing)) return landing!;
  if (context.storeDomain) {
    const base = context.storeDomain.startsWith("http")
      ? context.storeDomain
      : `https://${context.storeDomain}`;
    const normalized = `${base.replace(/\/$/, "")}/`;
    if (isPublicPageUrl(normalized)) return normalized;
  }
  return undefined;
}


export async function buildPayload(
  context: OrderContext,
  extra: {
    clientIp?: string | null;
    userAgent?: string | null;
    /** Só usado pelo modo de teste do painel; produção nunca passa isto. */
    eventIdOverride?: string;
    /** Só usado pelo modo de teste do painel; produção nunca passa isto. */
    testEventCode?: string | null;
  } = {},
) {
  const record: OrderAttributionRecord = await getOrderAttributionRecord(context.orderId).catch(
    () => ({}) as OrderAttributionRecord,
  );
  const attribution: Attribution = record;


  const userData: Record<string, unknown> = {};
  const em = await hashEmail(context.email);
  const ph = await hashPhone(context.phone);
  const fn = await hashName(context.firstName);
  const ln = await hashName(context.lastName);
  if (em) userData["em"] = [em];
  if (ph) userData["ph"] = [ph];
  if (fn) userData["fn"] = [fn];
  if (ln) userData["ln"] = [ln];
  const ct = await hashName(context.city);
  if (ct) userData["ct"] = [ct];
  const st = await hashName(context.state);
  if (st) userData["st"] = [st];
  const country = await hashName(context.country);
  if (country) userData["country"] = [country];
  const zp = await hashZip(context.postalCode);
  if (zp) userData["zp"] = [zp];
  if (attribution.fbc) userData["fbc"] = attribution.fbc;
  if (attribution.fbp) userData["fbp"] = attribution.fbp;
  // IP e User-Agent do contexto real da compra: o webhook da Stripe não os
  // possui, então usamos o que foi capturado no checkout e persistido.
  const clientIp = extra.clientIp ?? record.client_ip ?? null;
  const userAgent = extra.userAgent ?? record.client_user_agent ?? null;
  if (clientIp) userData["client_ip_address"] = clientIp;
  if (userAgent) userData["client_user_agent"] = userAgent;

  const customData: Record<string, unknown> = {
    currency: context.currency.toUpperCase(),
    value: Number((context.valueCents / 100).toFixed(2)),
    order_id: context.orderNumber,
  };
  if (context.items.length > 0) {
    customData["contents"] = context.items.map((item) => ({
      id: item.productId,
      quantity: item.quantity,
      item_price: Number((item.totalCents / item.quantity / 100).toFixed(2)),
    }));
    customData["content_type"] = "product";
    customData["content_ids"] = context.items.map((item) => item.productId);
    customData["num_items"] = context.items.reduce((total, item) => total + item.quantity, 0);
  }
  for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const) {
    const value = attribution[key];
    if (value) customData[key] = value;
  }

  const url = eventSourceUrl(context, record);

  const event: Record<string, unknown> = {
    event_name: "Purchase",
    event_time: Math.floor(new Date(context.paidAt ?? Date.now()).getTime() / 1000),
    event_id: extra.eventIdOverride ?? purchaseEventId(context.orderId),
    action_source: "website",
    user_data: userData,
    custom_data: customData,
  };
  if (url) event["event_source_url"] = url;

  // PRODUÇÃO: nunca enviar test_event_code. `extra.testEventCode` só é
  // preenchido pelos botões de teste do painel admin — o caminho do webhook
  // (sendPurchaseForOrder) nunca passa esse campo.
  const body: Record<string, unknown> = { data: [event] };
  if (extra.testEventCode) body["test_event_code"] = extra.testEventCode;
  return body;
}

async function postToMeta(
  pixelId: string,
  accessToken: string,
  body: Record<string, unknown>,
): Promise<MetaSendResult> {
  let response: Response;
  try {
    response = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${pixelId}/events`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    return { ok: false, error: sanitizeError((error as Error).message) };
  }

  const text = await response.text();
  if (response.ok) {
    let metaEventId: string | null = null;
    try {
      metaEventId = (JSON.parse(text) as { fbtrace_id?: string }).fbtrace_id ?? null;
    } catch {
      metaEventId = null;
    }
    return { ok: true, httpStatus: response.status, metaEventId };
  }
  // 4xx (exceto 429) = erro permanente: configuração/payload inválido.
  const permanent = response.status >= 400 && response.status < 500 && response.status !== 429;
  return {
    ok: false,
    error: sanitizeError(text || `HTTP ${response.status}`),
    httpStatus: response.status,
    permanent,
  };
}

/** Purchase server-side idempotente. Nunca lança. */
export async function sendPurchaseForOrder(input: {
  orderId: string;
  storeId: string;
  clientIp?: string | null;
  userAgent?: string | null;
}): Promise<MetaSendResult> {
  try {
    const settings = await getMetaSettingsWithToken(input.storeId);
    if (!settings) return { ok: true, skipped: "meta_disabled" };

    const context = await loadOrderContext(input.orderId);
    if (!context) return { ok: true, skipped: "order_not_found" };
    // PAID é a única fonte de verdade para Purchase.
    if (context.status !== "PAID") return { ok: true, skipped: "order_not_paid" };

    // Idempotência: uma linha por (store_id, order_id, event_name = Purchase).
    const { data: existing } = await supabaseAdmin
      .from("meta_conversion_events")
      .select("id, status, attempt_count")
      .eq("store_id", input.storeId)
      .eq("order_id", input.orderId)
      .eq("event_name", "Purchase")
      .maybeSingle();

    if (existing?.status === "SENT") return { ok: true, skipped: "already_sent" };
    if (existing && existing.attempt_count >= MAX_ATTEMPTS && existing.status === "FAILED_PERMANENT") {
      return { ok: true, skipped: "permanent_failure" };
    }

    let rowId = existing?.id ?? null;
    if (!rowId) {
      const { data: inserted, error } = await supabaseAdmin
        .from("meta_conversion_events")
        .insert({
          store_id: input.storeId,
          order_id: input.orderId,
          event_name: "Purchase",
          event_id: purchaseEventId(input.orderId),
          status: "PENDING",
        })
        .select("id")
        .maybeSingle();
      if (error || !inserted) {
        // corrida com outro worker: outro processo já está enviando.
        return { ok: true, skipped: "in_flight" };
      }
      rowId = inserted.id;
    }


    const payload = await buildPayload(context, {
      clientIp: input.clientIp ?? null,
      userAgent: input.userAgent ?? null,
    });
    const result = await postToMeta(settings.pixelId!, settings.accessToken, payload);

    const attempt = (existing?.attempt_count ?? 0) + 1;
    await supabaseAdmin
      .from("meta_conversion_events")
      .update({
        status: result.ok
          ? "SENT"
          : result.permanent || attempt >= MAX_ATTEMPTS
            ? "FAILED_PERMANENT"
            : "FAILED",
        attempt_count: attempt,
        http_status: result.httpStatus ?? null,
        meta_event_id: result.ok ? (result.metaEventId ?? null) : null,
        last_error: result.ok ? null : result.error,
      })
      .eq("id", rowId);

    await recordMetaHealth(input.storeId, {
      ok: result.ok,
      error: result.ok ? null : result.error,
    });

    // Espelha no analytics interno (sem contar como venda adicional).
    const { recordServerEvent } = await import("@/lib/analytics/ingest.server");
    await recordServerEvent({
      eventId: `meta-capi:${input.orderId}:${attempt}`,
      type: result.ok ? "meta_capi_succeeded" : "meta_capi_failed",
      storeId: input.storeId,
      orderId: input.orderId,
      currency: context.currency,
      amountCents: context.valueCents,
      metadata: { attempt, http_status: result.httpStatus ?? 0 },
    }).catch(() => undefined);

    console.log(
      `[meta-capi] store=${input.storeId} order=${input.orderId} event=Purchase event_id=${purchaseEventId(input.orderId)} status=${result.ok ? "SENT" : "FAILED"} http=${result.httpStatus ?? "n/a"} at=${new Date().toISOString()}`,
    );

    return result;
  } catch (error) {
    return { ok: false, error: sanitizeError((error as Error).message) };
  }
}

/**
 * Purchase de TESTE (somente painel admin).
 * Não cria pedido, PaymentIntent, cobrança, UTMify nem registro de venda:
 * apenas envia um evento isolado à Meta com o Test Event Code da loja.
 */
export async function sendTestPurchase(storeId: string): Promise<{
  ok: boolean;
  httpStatus: number | null;
  eventId: string;
  testEventCode: string | null;
  message: string;
}> {
  const settings = await getMetaSettingsWithToken(storeId);
  const eventId = `test_purchase_${crypto.randomUUID()}`;
  if (!settings) {
    return {
      ok: false,
      httpStatus: null,
      eventId,
      testEventCode: null,
      message: "Integração Meta desativada ou incompleta para esta loja.",
    };
  }

  // Dados 100% sintéticos — nenhum cliente real é usado neste evento de teste.
  const userData: Record<string, unknown> = {
    em: [await hashEmail("teste.capi@example.com")],
    ph: [await hashPhone("+5511999999999")],
    fn: [await hashName("teste")],
    ln: [await hashName("central")],
    ct: [await hashName("saopaulo")],
    st: [await hashName("sp")],
    country: [await hashCountry("br")],
    zp: [await hashZip("01001-000")],
    client_ip_address: "203.0.113.10",
    client_user_agent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    fbp: `fb.1.${Date.now()}.1234567890`,
    fbc: `fb.1.${Date.now()}.TESTCLICKID${Math.floor(Math.random() * 1e6)}`,
  };

  const body: Record<string, unknown> = {
    data: [
      {
        event_name: "Purchase",
        event_time: Math.floor(Date.now() / 1000),
        event_id: eventId,
        action_source: "website",
        event_source_url: "https://stripe-hub.lovable.app/",
        user_data: userData,
        custom_data: {
          currency: "USD",
          value: 20.0,
          content_type: "product",
          content_ids: ["test-sku-001"],
          num_items: 1,
        },
      },
    ],
  };
  const testEventCode = settings.testEventCode ?? "TEST2904";
  body["test_event_code"] = testEventCode;

  const result = await postToMeta(settings.pixelId!, settings.accessToken, body);
  console.log(
    `[meta-capi-test] store=${storeId} event_id=${eventId} status=${result.ok ? "SENT" : "FAILED"} http=${result.httpStatus ?? "n/a"}`,
  );
  return {
    ok: result.ok,
    httpStatus: result.httpStatus ?? null,
    eventId,
    testEventCode,
    message: result.ok
      ? `Evento de teste aceito pela Meta (HTTP ${result.httpStatus}).`
      : sanitizeError(result.error),
  };
}

/**
 * TESTE DE FLUXO COMPLETO (somente painel admin).
 *
 * Reproduz exatamente o Purchase que a produção enviaria para um pedido real
 * existente (mesmo payload, mesma atribuição: fbp/fbc/UTMs/IP/User-Agent/
 * event_source_url/e-mail e telefone hashados), porém:
 * - adiciona `test_event_code` (só aqui);
 * - usa um `event_id` de teste, para não consumir a deduplicação do pedido;
 * - NÃO grava em meta_conversion_events, NÃO toca Stripe/PaymentIntent/UTMify
 *   e NÃO altera o status do pedido — nenhuma cobrança é criada.
 *
 * `orderRef` aceita order_number, public_token ou o id do pedido.
 */
export async function sendTestPurchaseFromOrder(input: {
  storeId: string;
  orderRef: string;
}): Promise<{
  ok: boolean;
  httpStatus: number | null;
  eventId: string;
  testEventCode: string | null;
  orderNumber: string | null;
  orderStatus: string | null;
  message: string;
  fields: Record<string, boolean | string | number>;
}> {
  const empty = {
    ok: false,
    httpStatus: null,
    eventId: "",
    testEventCode: null,
    orderNumber: null,
    orderStatus: null,
    fields: {},
  };
  const settings = await getMetaSettingsWithToken(input.storeId);
  if (!settings) {
    return { ...empty, message: "Integração Meta desativada ou incompleta para esta loja." };
  }
  const testEventCode = settings.testEventCode;
  if (!testEventCode) {
    return {
      ...empty,
      message: "Defina um Test Event Code na loja antes de rodar o teste de fluxo.",
    };
  }

  const ref = input.orderRef.trim();
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ref);
  const { data: found } = await supabaseAdmin
    .from("orders")
    .select("id")
    .eq("store_id", input.storeId)
    .or(
      isUuid
        ? `id.eq.${ref},public_token.eq.${ref}`
        : `order_number.eq.${ref},public_token.eq.${ref}`,
    )
    .limit(1)
    .maybeSingle();
  if (!found) {
    return { ...empty, message: "Pedido não encontrado nesta loja." };
  }

  const context = await loadOrderContext(found.id);
  if (!context) return { ...empty, message: "Pedido não encontrado nesta loja." };

  const eventId = `test_${purchaseEventId(context.orderId)}_${Date.now()}`;
  const payload = await buildPayload(context, { eventIdOverride: eventId, testEventCode });
  const event = (payload["data"] as Array<Record<string, unknown>>)[0]!;
  const userData = event["user_data"] as Record<string, unknown>;
  const customData = event["custom_data"] as Record<string, unknown>;

  const result = await postToMeta(settings.pixelId!, settings.accessToken, payload);
  console.log(
    `[meta-capi-test-order] store=${input.storeId} order=${context.orderId} event_id=${eventId} status=${result.ok ? "SENT" : "FAILED"} http=${result.httpStatus ?? "n/a"}`,
  );

  return {
    ok: result.ok,
    httpStatus: result.httpStatus ?? null,
    eventId,
    testEventCode,
    orderNumber: context.orderNumber,
    orderStatus: context.status,
    message: result.ok
      ? `Purchase de teste aceito pela Meta (HTTP ${result.httpStatus}).`
      : sanitizeError(result.error),
    fields: {
      value: Number(customData["value"] ?? 0),
      currency: String(customData["currency"] ?? ""),
      em: Boolean(userData["em"]),
      ph: Boolean(userData["ph"]),
      fbp: Boolean(userData["fbp"]),
      fbc: Boolean(userData["fbc"]),
      client_ip_address: Boolean(userData["client_ip_address"]),
      client_user_agent: Boolean(userData["client_user_agent"]),
      event_source_url: String(event["event_source_url"] ?? "—"),
      utm_source: String(customData["utm_source"] ?? "—"),
      utm_campaign: String(customData["utm_campaign"] ?? "—"),
    },
  };
}

/**
 * Busca (somente leitura) um pedido da loja para servir de referência ao teste
 * CAPI: prioriza o PAID mais recente e, quando a loja ainda não tem nenhum
 * pedido PAID, cai para o pedido mais recente utilizável (ex.:
 * PAYMENT_PROCESSING), devolvendo o status real. Não altera nada e o token
 * completo nunca é enviado ao navegador (apenas mascarado).
 */
export async function findLatestPaidOrder(storeId: string): Promise<{
  found: boolean;
  orderId: string | null;
  orderNumber: string | null;
  status: string | null;
  maskedToken: string | null;
  paidAt: string | null;
}> {
  const select = "id, order_number, status, public_token, paid_at, created_at";

  const { data: paid } = await supabaseAdmin
    .from("orders")
    .select(select)
    .eq("store_id", storeId)
    .eq("status", "PAID")
    .order("paid_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const data = paid;


  if (!data) {
    return { found: false, orderId: null, orderNumber: null, status: null, maskedToken: null, paidAt: null };
  }

  const token = data.public_token ?? "";
  const masked = token ? `${token.slice(0, 4)}••••${token.slice(-4)}` : null;
  return {
    found: true,
    orderId: data.id,
    orderNumber: data.order_number,
    status: data.status,
    maskedToken: masked,
    paidAt: data.paid_at ?? null,
  };
}

/** Reenvio manual dos eventos pendentes/falhos de uma loja (backoff administrativo). */
export async function retryFailedMetaEvents(storeId: string): Promise<{ retried: number }> {
  const { data: rows } = await supabaseAdmin
    .from("meta_conversion_events")
    .select("order_id, attempt_count")
    .eq("store_id", storeId)
    .in("status", ["PENDING", "FAILED"])
    .order("created_at", { ascending: true })
    .limit(20);

  let retried = 0;
  for (const row of rows ?? []) {
    if (!row.order_id) continue;
    // backoff simples: espera crescente entre tentativas do mesmo lote.
    await new Promise((resolve) => setTimeout(resolve, Math.min(row.attempt_count, 3) * 300));
    await sendPurchaseForOrder({ orderId: row.order_id, storeId });
    retried += 1;
  }
  return { retried };
}

/**
 * Teste de conexão: valida credencial/pixel na Meta SEM criar compra.
 * Usa o endpoint de leitura do dataset — nenhum evento é gerado.
 */
export async function testMetaConnection(
  storeId: string,
): Promise<{ ok: boolean; message: string }> {
  const settings = await getMetaSettingsWithToken(storeId);
  if (!settings) {
    return { ok: false, message: "Integração Meta desativada ou incompleta para esta loja." };
  }
  try {
    const response = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${settings.pixelId}?fields=id,name`,
      { headers: { authorization: `Bearer ${settings.accessToken}` } },
    );
    const text = await response.text();
    if (response.ok) {
      await recordMetaHealth(storeId, { ok: true });
      return { ok: true, message: "Conexão validada com a Meta (nenhum evento foi enviado)." };
    }
    const message = sanitizeError(text);
    await recordMetaHealth(storeId, { ok: false, error: message });
    return { ok: false, message };
  } catch (error) {
    const message = sanitizeError((error as Error).message);
    await recordMetaHealth(storeId, { ok: false, error: message });
    return { ok: false, message };
  }
}

/* ------------------------------------------------------------------ */
/* Diagnóstico: Purchase de teste com pedido PAID + atribuição real     */
/* ------------------------------------------------------------------ */

export type AttributedPaidOrder = {
  found: boolean;
  orderId: string | null;
  orderNumber: string | null;
  status: string | null;
  paidAt: string | null;
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
  } | null;
};

/**
 * Somente leitura: pedido PAID mais recente da loja que POSSUI registro em
 * order_attribution. Sem fallback e sem dados inventados.
 */
export async function findLatestPaidOrderWithAttribution(
  storeId: string,
): Promise<AttributedPaidOrder> {
  const empty: AttributedPaidOrder = {
    found: false,
    orderId: null,
    orderNumber: null,
    status: null,
    paidAt: null,
    attribution: null,
  };

  const { data: orders } = await supabaseAdmin
    .from("orders")
    .select("id, order_number, status, paid_at, created_at")
    .eq("store_id", storeId)
    .eq("status", "PAID")
    .order("paid_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(50);
  if (!orders || orders.length === 0) return empty;

  const { data: rows } = await supabaseAdmin
    .from("order_attribution")
    .select(
      "order_id, fbc, fbp, client_ip, client_user_agent, event_source_url, utm_source, utm_medium, utm_campaign, utm_content, utm_term",
    )
    .in(
      "order_id",
      orders.map((order) => order.id),
    );
  if (!rows || rows.length === 0) return empty;

  const byOrder = new Map(rows.map((row) => [row.order_id, row]));
  const match = orders.find((order) => byOrder.has(order.id));
  if (!match) return empty;
  const row = byOrder.get(match.id)!;

  return {
    found: true,
    orderId: match.id,
    orderNumber: match.order_number,
    status: match.status,
    paidAt: match.paid_at,
    attribution: {
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
    },
  };
}

export type AttributedTestResult = {
  ok: boolean;
  message: string;
  httpStatus: number | null;
  eventId: string | null;
  value: number | null;
  currency: string | null;
  order: AttributedPaidOrder | null;
  sentAttribution: Record<string, string | null>;
  metaResponse: string | null;
};

/**
 * Envia um Purchase SOMENTE como Test Event (test_event_code da loja) usando
 * exatamente os dados armazenados do pedido PAID mais recente com atribuição.
 * Nada é criado ou alterado: sem PaymentIntent, cobrança, webhook, UTMify,
 * mudança de status/paid_at nem gravação em meta_conversion_events.
 */
export async function sendTestPurchaseFromAttributedOrder(
  storeId: string,
): Promise<AttributedTestResult> {
  const base: AttributedTestResult = {
    ok: false,
    message: "",
    httpStatus: null,
    eventId: null,
    value: null,
    currency: null,
    order: null,
    sentAttribution: {},
    metaResponse: null,
  };

  const settings = await getMetaSettingsWithToken(storeId);
  if (!settings) {
    return { ...base, message: "Integração Meta desativada ou incompleta para esta loja." };
  }
  const testEventCode = settings.testEventCode;
  if (!testEventCode) {
    return { ...base, message: "Defina um Test Event Code na loja antes de rodar o teste." };
  }

  const order = await findLatestPaidOrderWithAttribution(storeId);
  if (!order.found || !order.orderId) {
    return {
      ...base,
      message: "Nenhum pedido PAID com dados de atribuição disponível para teste.",
    };
  }

  const context = await loadOrderContext(order.orderId);
  if (!context) {
    return {
      ...base,
      order,
      message: "Nenhum pedido PAID com dados de atribuição disponível para teste.",
    };
  }

  const eventId = `test_purchase_${context.orderId}_${Date.now()}`;
  const payload = await buildPayload(context, { eventIdOverride: eventId, testEventCode });
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
    `[meta-capi-test-attributed] store=${storeId} order=${context.orderId} event_id=${eventId} http=${httpStatus ?? "n/a"} ok=${ok}`,
  );

  return {
    ok,
    message: ok
      ? `Test Event aceito pela Meta (HTTP ${httpStatus}).`
      : `Falha ao enviar o Test Event${httpStatus ? ` (HTTP ${httpStatus})` : ""}.`,
    httpStatus,
    eventId,
    value: Number(customData["value"] ?? 0),
    currency: String(customData["currency"] ?? context.currency).toUpperCase(),
    order,
    sentAttribution,
    metaResponse,
  };
}
