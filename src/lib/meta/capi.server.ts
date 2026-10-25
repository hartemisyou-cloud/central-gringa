import { sql, rows, one, exec } from "@/lib/db/client.server";
import type { Row } from "@/lib/db/types";
import {
  getOrderAttributionRecord,
  type OrderAttributionRecord,
} from "@/lib/payments/attribution.server";
import { isPublicPageUrl, type Attribution } from "@/lib/payments/attribution";
import { getMetaSettingsWithToken, recordMetaHealth } from "./config.server";
import { hashCountry, hashEmail, hashName, hashPhone, hashZip } from "./hash";
import { normalizeCheckoutCustomerDetails } from "@/lib/payments/checkout-customer.server";
import { decryptSecret, encryptSecret } from "@/lib/payments/crypto.server";

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

/** Settle crashed final claims without implying that the remote event was rejected. */
async function settleExpiredFinalLeases(storeId: string, orderId?: string): Promise<boolean> {
  const result = await exec(sql`
    UPDATE meta_conversion_events SET status = 'FAILED_EXHAUSTED', updated_at = now(), remote_acceptance_unknown = true,
      last_error = 'Final delivery lease expired; remote acceptance is unknown. Reconcile before any resend.'
    WHERE store_id = ${storeId} ${orderId ? sql`AND order_id = ${orderId}` : sql``}
      AND status = 'SENDING' AND attempt_count >= ${MAX_ATTEMPTS}
      AND updated_at < now() - interval '2 minutes'`);
  return !result.error;
}

/**
 * event_id determinístico do Purchase: `purchase_{order_id}`.
 * O mesmo valor é reutilizado em TODOS os retries e seria o mesmo usado por um
 * eventual Purchase de navegador — é ele que garante a deduplicação na Meta.
 */
export function purchaseEventId(orderId: string): string {
  return `purchase_${orderId}`;
}

export type MetaSendResult =
  | { ok: true; skipped?: string; httpStatus?: number | undefined; metaEventId?: string | null; eventsReceived?: number | undefined; messages?: string | undefined }
  | { ok: false; error: string; httpStatus?: number | undefined; permanent?: boolean; metaEventId?: string | null; eventsReceived?: number | undefined; messages?: string | undefined };

/** HTTP success is not an acknowledgement: Meta must accept the full batch. */
export function validateMetaResponse(httpStatus: number, text: string, expectedEvents = 1): MetaSendResult {
  let parsed: Record<string, unknown>;
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid response");
    parsed = value as Record<string, unknown>;
  } catch {
    return { ok: false, httpStatus, error: "Meta returned an invalid acknowledgement.", permanent: httpStatus >= 400 && httpStatus < 500 && httpStatus !== 429 };
  }
  const error = parsed["error"] as { is_transient?: boolean } | undefined;
  const evidence = {
    httpStatus,
    metaEventId: typeof parsed["fbtrace_id"] === "string" ? parsed["fbtrace_id"] : null,
    eventsReceived: typeof parsed["events_received"] === "number" ? parsed["events_received"] : undefined,
    messages: parsed["messages"] === undefined ? undefined : sanitizeError(JSON.stringify(parsed["messages"])),
  };
  if (httpStatus >= 200 && httpStatus < 300 && !error && evidence.eventsReceived === expectedEvents) {
    return { ok: true, ...evidence };
  }
  return {
    ok: false, ...evidence,
    error: sanitizeError(JSON.stringify(parsed)),
    permanent: Boolean(error) && error?.is_transient !== true && httpStatus !== 429 && httpStatus < 500
      || httpStatus >= 400 && httpStatus < 500 && httpStatus !== 429 && error?.is_transient !== true,
  };
}

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
  environment: Row<"orders">["environment"];
  currency: string;
  valueCents: number;
  paidAt: string | null;
  status: string;
  publicToken: string;
  clientIp: string | null;
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

type JoinedOrder = Row<"orders"> & {
  customers: Pick<Row<"customers">, "email" | "phone" | "first_name" | "last_name"> | null;
  addresses: Pick<Row<"addresses">, "city" | "state" | "postal_code" | "country"> | null;
  stores: Pick<Row<"stores">, "domain"> | null;
  order_items: Pick<Row<"order_items">, "product_id" | "quantity" | "total_cents">[];
};

export async function loadOrderContext(
  orderId: string,
  storeId?: string,
): Promise<OrderContext | null> {
  const { data: order } = await one<JoinedOrder>(
    sql`
    SELECT o.id, o.store_id, o.order_number, o.currency, o.total_cents, o.paid_at,
      o.status, o.environment, o.public_token, o.client_ip, o.checkout_customer_details,
      CASE WHEN c.id IS NULL THEN NULL ELSE jsonb_build_object(
        'email', c.email, 'phone', c.phone, 'first_name', c.first_name, 'last_name', c.last_name) END AS customers,
      CASE WHEN a.id IS NULL THEN NULL ELSE jsonb_build_object(
        'city', a.city, 'state', a.state, 'postal_code', a.postal_code, 'country', a.country) END AS addresses,
      CASE WHEN s.id IS NULL THEN NULL ELSE jsonb_build_object('domain', s.domain) END AS stores,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('product_id', i.product_id,
        'quantity', i.quantity, 'total_cents', i.total_cents)) FROM order_items i
        WHERE i.order_id = o.id), '[]'::jsonb) AS order_items
    FROM orders o LEFT JOIN customers c ON c.id = o.customer_id
      LEFT JOIN addresses a ON a.id = o.shipping_address_id LEFT JOIN stores s ON s.id = o.store_id
    WHERE o.id = ${orderId} ${storeId ? sql`AND o.store_id = ${storeId}` : sql``}`,
    true,
  );
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
  const checkout = normalizeCheckoutCustomerDetails(order.checkout_customer_details);

  return {
    orderId: order.id,
    storeId: order.store_id,
    orderNumber: order.order_number,
    environment: order.environment,
    currency: order.currency,
    valueCents: order.total_cents,
    paidAt: order.paid_at,
    status: order.status,
    publicToken: order.public_token,
    clientIp: order.client_ip ?? null,
    email: checkout ? checkout.email : customer?.email ?? null,
    phone: customer?.phone ?? null,
    firstName: customer?.first_name ?? null,
    lastName: customer?.last_name ?? null,
    // ct is emitted only for a city actually supplied by Stripe Checkout.
    city: checkout?.address.city ?? null,
    state: address?.state ?? null,
    postalCode: address?.postal_code ?? null,
    country: checkout?.address.country ?? null,
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
  if (captured && isPublicPageUrl(captured)) return captured;
  const landing = attribution.landing_page;
  if (landing && isPublicPageUrl(landing)) return landing;
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
    userAgent?: string | null;
    /** Só usado pelo modo de teste do painel; produção nunca passa isto. */
    eventIdOverride?: string;
    /** Pedidos TEST e testes explícitos do painel; LIVE automático omite isto. */
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
  // Meta PII contract: normalize ISO-2 to lowercase and SHA-256 hash, like email.
  if (context.country && /^[a-z]{2}$/i.test(context.country)) {
    userData["country"] = [await hashCountry(context.country)];
  }
  const zp = await hashZip(context.postalCode);
  if (zp) userData["zp"] = [zp];
  if (attribution.fbc) userData["fbc"] = attribution.fbc;
  if (attribution.fbp) userData["fbp"] = attribution.fbp;
  // The purchase-entry IP is persisted on the order; never use the webhook IP
  // or a later attribution write as the source for this financial conversion.
  const clientIp = context.clientIp;
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
  for (const key of [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_content",
    "utm_term",
  ] as const) {
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

  // O envio automático só passa test_event_code para pedidos TEST.
  // Os testes explícitos do painel também podem fornecê-lo.
  const body: Record<string, unknown> = { data: [event] };
  if (extra.testEventCode) body["test_event_code"] = extra.testEventCode;
  return body;
}

async function postToMeta(
  pixelId: string,
  accessToken: string,
  body: Record<string, unknown>,
  graphVersion = GRAPH_VERSION,
): Promise<MetaSendResult> {
  let response: Response;
  let text: string;
  try {
    response = await fetch(`https://graph.facebook.com/${graphVersion}/${pixelId}/events`, {
      method: "POST",
      signal: AbortSignal.timeout(10000),
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
    });
    text = await response.text();
  } catch (error) {
    return { ok: false, error: sanitizeError((error as Error).message), remoteAcceptanceUnknown: true };
  }

  const events = body["data"];
  return validateMetaResponse(response.status, text, Array.isArray(events) ? events.length : 1);
}

/** Purchase server-side idempotente. Nunca lança. */
export async function sendPurchaseForOrder(input: {
  orderId: string;
  storeId: string;
  userAgent?: string | null;
  occurredAt?: number;
}): Promise<MetaSendResult> {
  try {
    const settings = await getMetaSettingsWithToken(input.storeId);
    if (!settings) return { ok: true, skipped: "meta_disabled" };

    const context = await loadOrderContext(input.orderId, input.storeId);
    if (!context) return { ok: false, error: "Order not found in the selected store.", permanent: true };
    // PAID é a única fonte de verdade para Purchase.
    if (context.status !== "PAID") return { ok: true, skipped: "order_not_paid" };
    const testEventCode =
      context.environment === "test" ? settings.testEventCode?.trim() || null : null;
    if (context.environment === "test" && !testEventCode) {
      return { ok: true, skipped: "test_event_code_missing" };
    }

    if (!await settleExpiredFinalLeases(input.storeId, input.orderId)) {
      return { ok: false, error: "Expired delivery lease could not be settled." };
    }

    // Idempotência: uma linha por (store_id, order_id, event_name = Purchase).
    const { data: existing } = await one<Row<"meta_conversion_events">>(
      sql`SELECT id, status, attempt_count, event_id FROM meta_conversion_events WHERE store_id = ${input.storeId} AND order_id = ${input.orderId} AND event_name = ${"Purchase"}`,
      true,
    );

    if (existing?.status === "SENT") return { ok: true, skipped: "already_sent" };
    if (
      existing &&
      (existing.status === "FAILED_PERMANENT" || existing.attempt_count >= MAX_ATTEMPTS)
    ) {
      return { ok: true, skipped: "permanent_failure" };
    }

    let rowId = existing?.id ?? null;
    if (!rowId) {
      const snapshotEnabled = process.env["META_PURCHASE_RECOVERY_ENABLED"] === "true";
      let encryptedSnapshot: string | null = null;
      if (snapshotEnabled) {
        const occurrence = input.occurredAt ?? (context.paidAt ? Math.floor(new Date(context.paidAt).getTime() / 1000) : NaN);
        if (!Number.isSafeInteger(occurrence) || occurrence <= 0 || occurrence > Math.floor(Date.now() / 1000)) {
          return { ok: false, error: "Original Purchase occurrence is unavailable." };
        }
        const payload = await buildPayload({ ...context, paidAt: new Date(occurrence * 1000).toISOString() }, {
          userAgent: input.userAgent, testEventCode,
        });
        encryptedSnapshot = await encryptSecret(JSON.stringify(payload));
      }
      const { data: inserted, error } = await one<{ id: string }>(
        sql`
        INSERT INTO meta_conversion_events (store_id, order_id, event_name, event_id, status,
          purchase_snapshot_ciphertext, destination_pixel_id, destination_graph_version, automatic_recovery)
        VALUES (${input.storeId}, ${input.orderId}, ${"Purchase"}, ${purchaseEventId(input.orderId)}, ${"PENDING"},
          ${encryptedSnapshot}, ${snapshotEnabled ? settings.pixelId : null}, ${snapshotEnabled ? GRAPH_VERSION : null}, ${snapshotEnabled}) RETURNING id`,
        true,
      );
      if (error || !inserted) {
        if (error?.code === "23505") return { ok: true, skipped: "in_flight" };
        return { ok: false, error: "Purchase delivery could not be persisted." };
      }
      rowId = inserted.id;
    }

    // Atomic lease and attempt fencing use the existing durable delivery row.
    // A crashed claimant is recoverable after two minutes; stale completion
    // cannot overwrite a newer attempt or a SENT acknowledgement.
    const { data: claim, error: claimError } = await one<{ attempt_count: number; event_id: string; purchase_snapshot_ciphertext: string | null; destination_pixel_id: string | null; destination_graph_version: string | null }>(sql`
      UPDATE meta_conversion_events SET remote_acceptance_unknown = remote_acceptance_unknown OR status = 'SENDING',
        status = 'SENDING', attempt_count = attempt_count + 1, updated_at = now()
      WHERE id = ${rowId} AND attempt_count < ${MAX_ATTEMPTS}
        AND (status IN ('PENDING', 'FAILED') OR (status = 'SENDING' AND updated_at < now() - interval '2 minutes'))
        AND (attempt_count = 0 OR updated_at <= now() - interval '30 seconds')
      RETURNING attempt_count, event_id, purchase_snapshot_ciphertext, destination_pixel_id, destination_graph_version`, true);
    if (claimError) return { ok: false, error: "Purchase delivery claim failed." };
    if (!claim) return { ok: true, skipped: "in_flight_or_backoff" };
    const attempt = claim.attempt_count;
    let result: MetaSendResult;
    try {
      const payload = claim.purchase_snapshot_ciphertext
        ? JSON.parse(await decryptSecret(claim.purchase_snapshot_ciphertext)) as Record<string, unknown>
        : await buildPayload(context, {
      userAgent: input.userAgent ?? null,
      eventIdOverride: claim.event_id,
      testEventCode,
      });
      if (!settings.pixelId) throw new Error("Pixel destination missing.");
      if (claim.destination_pixel_id && claim.destination_pixel_id !== settings.pixelId) {
        result = { ok: false, permanent: true, error: "Original Purchase dataset no longer matches the enabled store destination." };
      } else {
        result = await postToMeta(claim.destination_pixel_id ?? settings.pixelId, settings.accessToken, payload,
          claim.destination_graph_version ?? GRAPH_VERSION);
      }
    } catch (error) {
      result = { ok: false, error: sanitizeError((error as Error).message) };
    }

    const status = result.ok
      ? "SENT"
      : result.permanent
        ? "FAILED_PERMANENT"
        : attempt >= MAX_ATTEMPTS ? "FAILED_EXHAUSTED" : "FAILED";
    const saved = await one<{ id: string }>(sql`UPDATE meta_conversion_events SET status = ${status}, updated_at = now(),
      http_status = ${result.httpStatus ?? null}, meta_event_id = ${result.metaEventId ?? null},
      remote_acceptance_unknown = CASE WHEN ${result.ok} THEN false ELSE remote_acceptance_unknown OR ${!result.ok && result.remoteAcceptanceUnknown === true} END,
      last_error = ${result.ok ? null : result.error} WHERE id = ${rowId} AND status = 'SENDING' AND attempt_count = ${attempt}
      RETURNING id`, true);
    if (saved.error) return { ok: false, error: "Meta response received but delivery acknowledgement could not be persisted.", httpStatus: result.httpStatus };
    if (!saved.data) return { ok: false, error: "Meta response received but delivery lease is no longer owned by this attempt.", httpStatus: result.httpStatus };

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
      metadata: { attempt, http_status: result.httpStatus ?? 0, events_received: result.eventsReceived ?? null,
        messages: result.messages ?? null, fbtrace_id: result.metaEventId ?? null },
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
      message: "Meta integration disabled or incomplete for this store.",
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

  // Domínio público da loja — nunca um domínio interno da Central.
  const { data: testStore } = await one<Row<"stores">>(
    sql`SELECT domain FROM stores WHERE id = ${storeId}`,
    true,
  );
  const testSourceUrl = testStore?.domain
    ? `https://${testStore.domain.replace(/^https?:\/\//, "").replace(/\/$/, "")}/`
    : undefined;
  const body: Record<string, unknown> = {
    data: [
      {
        event_name: "Purchase",
        event_time: Math.floor(Date.now() / 1000),
        event_id: eventId,
        action_source: "website",
        ...(testSourceUrl ? { event_source_url: testSourceUrl } : {}),
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
      ? `Test event accepted by Meta (HTTP ${result.httpStatus}).`
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
    return { ...empty, message: "Meta integration disabled or incomplete for this store." };
  }
  const testEventCode = settings.testEventCode;
  if (!testEventCode) {
    return {
      ...empty,
      message: "Set a Test Event Code in the store before running the flow test.",
    };
  }

  const ref = input.orderRef.trim();
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ref);
  const { data: found } = await one<Row<"orders">>(
    sql`SELECT id FROM orders WHERE store_id = ${input.storeId}
    AND (${isUuid ? sql`id = ${ref}` : sql`order_number = ${ref}`} OR public_token = ${ref}) LIMIT 1`,
    true,
  );
  if (!found) {
    return { ...empty, message: "Order not found in this store." };
  }

  const context = await loadOrderContext(found.id, input.storeId);
  if (!context) return { ...empty, message: "Order not found in this store." };

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
      ? `Test Purchase accepted by Meta (HTTP ${result.httpStatus}).`
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
  const { data: paid } = await one<Row<"orders">>(
    sql`SELECT id, order_number, status, public_token, paid_at, created_at FROM orders WHERE store_id = ${storeId} AND status = ${"PAID"} ORDER BY paid_at DESC NULLS LAST, created_at DESC LIMIT 1`,
    true,
  );

  const data = paid;

  if (!data) {
    return {
      found: false,
      orderId: null,
      orderNumber: null,
      status: null,
      maskedToken: null,
      paidAt: null,
    };
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
  if (!await settleExpiredFinalLeases(storeId)) throw new Error("Expired delivery leases could not be settled.");
  const { data: pendingRows } = await rows<Row<"meta_conversion_events">>(
    sql`SELECT order_id, attempt_count FROM meta_conversion_events WHERE store_id = ${storeId}
      AND (status IN ('PENDING', 'FAILED') OR (status = 'SENDING' AND updated_at < now() - interval '2 minutes'))
      AND attempt_count < ${MAX_ATTEMPTS} ORDER BY created_at ASC LIMIT 20`,
  );

  let retried = 0;
  for (const row of pendingRows ?? []) {
    if (!row.order_id) continue;
    // backoff simples: espera crescente entre tentativas do mesmo lote.
    await new Promise((resolve) => setTimeout(resolve, Math.min(row.attempt_count, 3) * 300));
    await sendPurchaseForOrder({ orderId: row.order_id, storeId });
    retried += 1;
  }
  return { retried };
}

/** Bounded Vercel tick: only explicitly enrolled new snapshots, never historical rows. */
export async function recoverNewMetaPurchases(): Promise<{ processed: number }> {
  const settled = await exec(sql`UPDATE meta_conversion_events SET status = 'FAILED_EXHAUSTED',
    remote_acceptance_unknown = true, updated_at = now(),
    last_error = 'Final delivery lease expired; remote acceptance is unknown. Reconcile before any resend.'
    WHERE automatic_recovery AND status = 'SENDING' AND attempt_count >= ${MAX_ATTEMPTS}
      AND updated_at < now() - interval '2 minutes'`);
  if (settled.error) throw new Error("Purchase recovery settlement failed.");
  const pending = await rows<{ order_id: string; store_id: string }>(sql`
    SELECT order_id, store_id FROM meta_conversion_events WHERE automatic_recovery
      AND purchase_snapshot_ciphertext IS NOT NULL AND order_id IS NOT NULL AND attempt_count < ${MAX_ATTEMPTS}
      AND (status IN ('PENDING','FAILED') OR (status = 'SENDING' AND updated_at < now() - interval '2 minutes'))
      AND (attempt_count = 0 OR updated_at < now() - interval '30 seconds')
    ORDER BY created_at LIMIT 5`);
  if (pending.error) throw new Error("Purchase recovery selection failed.");
  let processed = 0;
  for (const row of pending.data ?? []) {
    await sendPurchaseForOrder({ orderId: row.order_id, storeId: row.store_id });
    processed += 1;
  }
  return { processed };
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
    return { ok: false, message: "Meta integration disabled or incomplete for this store." };
  }
  try {
    const response = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${settings.pixelId}?fields=id,name`,
      { headers: { authorization: `Bearer ${settings.accessToken}` } },
    );
    const text = await response.text();
    if (response.ok) {
      await recordMetaHealth(storeId, { ok: true });
      return { ok: true, message: "Connection validated with Meta (no event was sent)." };
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

  const { data: orders } = await rows<Row<"orders">>(
    sql`SELECT id, order_number, status, paid_at, created_at FROM orders WHERE store_id = ${storeId} AND status = ${"PAID"} ORDER BY paid_at DESC NULLS LAST, created_at DESC LIMIT 50`,
  );
  if (!orders || orders.length === 0) return empty;

  const { data: attributionRows } = await rows<Row<"order_attribution">>(
    sql`SELECT order_id, fbc, fbp, client_ip, client_user_agent, event_source_url, utm_source, utm_medium, utm_campaign, utm_content, utm_term FROM order_attribution WHERE order_id IN ${sql(orders.map((order) => order.id))}`,
  );
  if (!attributionRows || attributionRows.length === 0) return empty;

  const byOrder = new Map(attributionRows.map((row) => [row.order_id, row]));
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
    return { ...base, message: "Meta integration disabled or incomplete for this store." };
  }
  const testEventCode = settings.testEventCode;
  if (!testEventCode) {
    return { ...base, message: "Set a Test Event Code in the store before running the test." };
  }

  const order = await findLatestPaidOrderWithAttribution(storeId);
  if (!order.found || !order.orderId) {
    return {
      ...base,
      message: "No PAID order with attribution data available for testing.",
    };
  }

  const context = await loadOrderContext(order.orderId, storeId);
  if (!context) {
    return {
      ...base,
      order,
      message: "No PAID order with attribution data available for testing.",
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
    ok = validateMetaResponse(response.status, metaResponse).ok;
  } catch (error) {
    metaResponse = sanitizeError((error as Error).message);
  }

  console.log(
    `[meta-capi-test-attributed] store=${storeId} order=${context.orderId} event_id=${eventId} http=${httpStatus ?? "n/a"} ok=${ok}`,
  );

  return {
    ok,
    message: ok
      ? `Test Event accepted by Meta (HTTP ${httpStatus}).`
      : `Failed to send Test Event${httpStatus ? ` (HTTP ${httpStatus})` : ""}.`,
    httpStatus,
    eventId,
    value: Number(customData["value"] ?? 0),
    currency: String(customData["currency"] ?? context.currency).toUpperCase(),
    order,
    sentAttribution,
    metaResponse,
  };
}
