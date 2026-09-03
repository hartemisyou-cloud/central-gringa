import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  ATTRIBUTION_KEYS,
  hasAttribution,
  isPublicPageUrl,
  normalizeAttribution,
  type Attribution,
} from "./attribution";

/** Contexto real do navegador da compra (não é atribuição de marketing). */
export interface AttributionClientContext {
  clientIp?: string | null;
  clientUserAgent?: string | null;
  eventSourceUrl?: string | null;
}

export interface OrderAttributionRecord extends Attribution {
  client_ip?: string | undefined;
  client_user_agent?: string | undefined;
  event_source_url?: string | undefined;
}

function clean(value: string | null | undefined, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  // eslint-disable-next-line no-control-regex
  const out = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
  return out || undefined;
}

function clientColumns(context: AttributionClientContext | undefined) {
  const row: Record<string, string> = {};
  const ip = clean(context?.clientIp, 100);
  const ua = clean(context?.clientUserAgent, 500);
  const url = clean(context?.eventSourceUrl, 500);
  if (ip) row["client_ip"] = ip;
  if (ua) row["client_user_agent"] = ua;
  if (url) row["event_source_url"] = url;
  return row;
}

/**
 * Persiste a atribuição de um pedido (1 pedido -> 1 linha).
 * Idempotente: reprocessar o mesmo order_id atualiza a linha existente,
 * nunca cria uma segunda. Sem atribuição, nenhuma linha é criada.
 * Nunca lança: atribuição é telemetria e não pode derrubar um pedido.
 */
export async function saveOrderAttribution(
  orderId: string,
  input: Attribution | undefined | null,
  context?: AttributionClientContext,
): Promise<Attribution> {
  const attribution = normalizeAttribution(input);
  const client = clientColumns(context);
  if (!hasAttribution(attribution) && Object.keys(client).length === 0) return attribution;

  try {
    const row = { order_id: orderId, ...attribution, ...client };
    await supabaseAdmin.from("order_attribution").upsert(row as never, { onConflict: "order_id" });


    // Liga a sessão de analytics existente ao pedido (sem criar sessões novas).
    const sessionId = attribution.checkout_session_id;
    const anonymousId = attribution.anonymous_session_id;
    if (sessionId || anonymousId) {
      const query = supabaseAdmin
        .from("checkout_sessions")
        .update({ order_id: orderId })
        .is("order_id", null);
      await (sessionId
        ? query.eq("checkout_session_id", sessionId)
        : query.eq("anonymous_session_id", anonymousId!));
    }
  } catch {
    // silencioso por design
  }
  return attribution;
}

/**
 * Completa a atribuição de um pedido já existente sem destruir nada.
 * Só grava campos que ainda estão vazios (a primeira origem sempre vence);
 * `client_ip`, `client_user_agent` e `event_source_url` são atualizados quando
 * chega um contexto real de navegador mais recente. Nunca lança.
 */
export async function enrichOrderAttribution(
  orderId: string,
  input: Attribution | undefined | null,
  context?: AttributionClientContext,
): Promise<void> {
  try {
    const incoming = normalizeAttribution(input);
    const client = clientColumns(context);
    if (!hasAttribution(incoming) && Object.keys(client).length === 0) return;

    const { data: existing } = await supabaseAdmin
      .from("order_attribution")
      .select("*")
      .eq("order_id", orderId)
      .maybeSingle();

    const row: Record<string, string> = { order_id: orderId };
    const current = (existing ?? {}) as Record<string, string | null>;
    for (const key of ATTRIBUTION_KEYS) {
      const value = incoming[key];
      if (value && !current[key]) row[key] = value;
    }
    // fbp/fbc do navegador da compra são sempre os mais confiáveis.
    if (incoming.fbp) row["fbp"] = incoming.fbp;
    if (incoming.fbc) row["fbc"] = incoming.fbc;
    Object.assign(row, client);

    if (Object.keys(row).length <= 1) return;
    const { error } = await supabaseAdmin
      .from("order_attribution")
      .upsert(row as never, { onConflict: "order_id" });
    if (error) console.error("[attribution] enrich failed", error.message);
  } catch (error) {
    console.error("[attribution] enrich threw", (error as Error).message);
  }
}

/** Recupera a atribuição persistida de um pedido. Retorna {} se não houver. */
export async function getOrderAttribution(orderId: string): Promise<Attribution> {
  const { data } = await supabaseAdmin
    .from("order_attribution")
    .select(ATTRIBUTION_KEYS.join(", "))
    .eq("order_id", orderId)
    .maybeSingle();
  return normalizeAttribution(data as Attribution | null);
}

/** Atribuição + contexto de navegador (IP/UA/URL) persistidos do pedido. */
export async function getOrderAttributionRecord(
  orderId: string,
): Promise<OrderAttributionRecord> {
  const { data } = await supabaseAdmin
    .from("order_attribution")
    .select("*")
    .eq("order_id", orderId)
    .maybeSingle();
  const row = (data ?? {}) as Record<string, string | null>;
  const record: OrderAttributionRecord = normalizeAttribution(data as Attribution | null);
  const ip = clean(row["client_ip"], 100);
  const ua = clean(row["client_user_agent"], 500);
  const url = clean(row["event_source_url"], 500);
  if (ip) record.client_ip = ip;
  if (ua) record.client_user_agent = ua;
  if (url) record.event_source_url = url;
  return record;
}
