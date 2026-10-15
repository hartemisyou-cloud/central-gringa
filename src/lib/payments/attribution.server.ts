import { sql, one, exec } from "@/lib/db/client.server";
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
  const url = clean(context?.eventSourceUrl, 2000);
  if (ip) row["client_ip"] = ip;
  if (ua) row["client_user_agent"] = ua;
  // Nunca persistir domínio interno da Central como página da conversão.
  if (url && isPublicPageUrl(url)) row["event_source_url"] = url;
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
    const row: Record<string, string> = { order_id: orderId, ...client };
    for (const key of ATTRIBUTION_KEYS) {
      const value = attribution[key];
      if (value !== undefined) row[key] = value;
    }
    const columns = Object.keys(row);
    await exec(sql`insert into public.order_attribution ${sql(row, ...columns)}
      on conflict (order_id) do update set ${sql(row, ...columns.filter((key) => key !== "order_id"))}`);


    // Liga a sessão de analytics existente ao pedido (sem criar sessões novas).
    const sessionId = attribution.checkout_session_id;
    const anonymousId = attribution.anonymous_session_id;
    if (sessionId || anonymousId) {
      await exec(sessionId
        ? sql`update public.checkout_sessions set order_id = ${orderId} where order_id is null and checkout_session_id = ${sessionId}`
        : sql`update public.checkout_sessions set order_id = ${orderId} where order_id is null and anonymous_session_id = ${anonymousId!}`);
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

    const { data: existing } = await one<Record<string, string | null>>(sql`
      select * from public.order_attribution where order_id = ${orderId}
    `, true);

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
    const columns = Object.keys(row);
    const { error } = await exec(sql`insert into public.order_attribution ${sql(row, ...columns)}
      on conflict (order_id) do update set ${sql(row, ...columns.filter((key) => key !== "order_id"))}`);
    if (error) console.error("[attribution] enrich failed", error.message);
  } catch (error) {
    console.error("[attribution] enrich threw", (error as Error).message);
  }
}

/** Recupera a atribuição persistida de um pedido. Retorna {} se não houver. */
export async function getOrderAttribution(orderId: string): Promise<Attribution> {
  const { data } = await one<Attribution>(sql`
    select ${sql([...ATTRIBUTION_KEYS])} from public.order_attribution where order_id = ${orderId}
  `, true);
  return normalizeAttribution(data as Attribution | null);
}

/** Atribuição + contexto de navegador (IP/UA/URL) persistidos do pedido. */
export async function getOrderAttributionRecord(
  orderId: string,
): Promise<OrderAttributionRecord> {
  const { data } = await one<Record<string, string | null>>(sql`
    select * from public.order_attribution where order_id = ${orderId}
  `, true);
  const row = (data ?? {}) as Record<string, string | null>;
  const record: OrderAttributionRecord = normalizeAttribution(data as Attribution | null);
  const ip = clean(row["client_ip"], 100);
  const ua = clean(row["client_user_agent"], 500);
  const url = clean(row["event_source_url"], 2000);
  if (ip) record.client_ip = ip;
  if (ua) record.client_user_agent = ua;
  if (url) record.event_source_url = url;
  return record;
}
