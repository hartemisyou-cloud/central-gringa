import { sql, rows, one, exec } from "@/lib/db/client.server";
import type { Row } from "@/lib/db/types";

/**
 * Presença em tempo real (servidor). Grava/expira sessões vivas e conta os
 * cards do painel. Não interfere em `analytics_events` nem em
 * `checkout_sessions` — o histórico permanece intacto.
 */

export type PresenceEvent =
  | "SESSION_ACTIVE"
  | "CART_OPENED"
  | "CART_CLOSED"
  | "CHECKOUT_VIEWED"
  | "PAYMENT_SUCCEEDED"
  | "SESSION_ENDED";

type PresenceState = "ACTIVE" | "CART" | "CHECKOUT" | "PAID" | "ENDED";

const STATE_BY_EVENT: Record<PresenceEvent, PresenceState> = {
  SESSION_ACTIVE: "ACTIVE",
  CART_OPENED: "CART",
  // Drawer fechado sem avançar: volta a navegar no site principal.
  CART_CLOSED: "ACTIVE",
  CHECKOUT_VIEWED: "CHECKOUT",
  PAYMENT_SUCCEEDED: "PAID",
  SESSION_ENDED: "ENDED",
};

/**
 * O estado reflete SEMPRE a página atual do visitante (home → ACTIVE,
 * carrinho → CART, checkout → CHECKOUT, pago → PAID). `ENDED` é apenas um
 * sinal temporário: qualquer heartbeat posterior de página ativa reativa a
 * sessão. `last_seen_at` continua sendo a fonte principal de expiração.
 */

const BOT_PATTERN =
  /(bot|crawl|spider|slurp|preview|monitor|uptime|health|pingdom|lighthouse|headless|phantom|puppeteer|playwright|curl|wget|python-requests|axios|node-fetch|okhttp|java\/|go-http|libwww|facebookexternalhit|whatsapp|telegram|discord|semrush|ahrefs|dataprovider)/i;

/** Requests sem UA de navegador (server-side, health checks) não são usuários. */
export function isBotUserAgent(ua: string | null): boolean {
  if (!ua || ua.trim().length < 12) return true;
  if (BOT_PATTERN.test(ua)) return true;
  return !/mozilla|applewebkit|gecko|opera/i.test(ua);
}

export interface PresenceHeartbeat {
  sessionId: string;
  event: PresenceEvent;
  storeSlug?: string | undefined;
  page?: string | undefined;
}

export async function recordPresence(input: PresenceHeartbeat, userAgent: string | null) {
  const isBot = isBotUserAgent(userAgent);
  const incoming = STATE_BY_EVENT[input.event];
  const now = new Date().toISOString();

  // Marcos já registrados para esta sessão (drawer / checkout) e loja associada.
  const { data: existing } = await one<Row<"presence_sessions">>(
    sql`SELECT store_id, cart_opened_at, cart_closed_at, checkout_viewed_at FROM presence_sessions WHERE session_id = ${input.sessionId}`,
    true,
  );

  let storeId: string | null = existing?.store_id ?? null;
  if (input.storeSlug) {
    const slug = input.storeSlug.trim().toLowerCase();
    // Resolução tolerante: slug exato, e como fallback o domínio da loja
    // (o site pode enviar "livrariadacultura.shop" em vez do slug).
    const { data } = await one<Row<"stores">>(
      sql`SELECT id FROM stores WHERE slug = ${slug}`,
      true,
    );
    let resolved = data?.id ?? null;
    if (!resolved) {
      const host = slug.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
      const { data: byDomain } = await one<Row<"stores">>(
        sql`SELECT id FROM stores WHERE domain = ${host}`,
        true,
      );
      resolved = byDomain?.id ?? null;
    }
    if (!resolved) console.warn("[presence] store not resolved for slug", slug);
    storeId = resolved ?? storeId;
  }

  // Estado da página atual, sem trava: ENDED é substituído pelo próximo
  // heartbeat válido e CHECKOUT pode voltar para ACTIVE/CART.
  const state: PresenceState = incoming;

  const row = existing as {
    cart_opened_at: string | null;
    cart_closed_at: string | null;
    checkout_viewed_at: string | null;
  } | null;

  // Marcos são cumulativos dentro da sessão: fechar e reabrir o drawer não
  // apaga nada, e chegar ao checkout marca a conversão definitivamente.
  const cartOpenedAt =
    input.event === "CART_OPENED" ? (row?.cart_opened_at ?? now) : (row?.cart_opened_at ?? null);
  const cartClosedAt = input.event === "CART_CLOSED" ? now : (row?.cart_closed_at ?? null);
  const checkoutViewedAt =
    input.event === "CHECKOUT_VIEWED" || input.event === "PAYMENT_SUCCEEDED"
      ? (row?.checkout_viewed_at ?? now)
      : (row?.checkout_viewed_at ?? null);

  const heartbeatRow = {
    session_id: input.sessionId,
    store_id: storeId,
    state,
    page: input.page ?? null,
    user_agent: userAgent ? userAgent.slice(0, 400) : null,
    is_bot: isBot,
    last_seen_at: now,
    cart_opened_at: cartOpenedAt,
    cart_closed_at: cartClosedAt,
    checkout_viewed_at: checkoutViewedAt,
  };
  const columns = [
    "session_id",
    "store_id",
    "state",
    "page",
    "user_agent",
    "is_bot",
    "last_seen_at",
    "cart_opened_at",
    "cart_closed_at",
    "checkout_viewed_at",
  ] as const;
  const { error } = await exec(sql`INSERT INTO presence_sessions ${sql(heartbeatRow, ...columns)}
    ON CONFLICT (session_id) DO UPDATE SET ${sql(heartbeatRow, ...columns)}`);
  if (error) console.error("[presence] upsert failed", error.message);

  return { ok: true, counted: !isBot };
}

export interface RealtimeSnapshot {
  online: number;
  /** Drawer de doação aberto agora (site principal). */
  cart: number;
  checkout: number;
  /** Abriram o drawer, não chegaram ao checkout e estão inativos há 5+ min. */
  drawerAbandoned: number;
  /** Sessões que abriram o drawer na janela de análise. */
  drawerOpened: number;
  /** Sessões que abriram o drawer e chegaram ao checkout. */
  drawerToCheckout: number;
  /** drawerToCheckout / drawerOpened (0–100) ou null sem amostra. */
  drawerToCheckoutRate: number | null;
  /** drawerAbandoned / drawerOpened (0–100) ou null sem amostra. */
  drawerAbandonRate: number | null;
  generatedAt: string;
}

/** Inatividade mínima para considerar o drawer abandonado. */
const ABANDON_AFTER_MS = 5 * 60_000;
/** Janela de análise das taxas do drawer. */
const FUNNEL_WINDOW_MS = 24 * 60 * 60_000;

/**
 * Contagens ao vivo, deduplicadas por `session_id` (chave primária da tabela).
 * Sem qualquer threshold: o número aparece na primeira sessão.
 *
 * Abandono do drawer = a sessão abriu o drawer (`CART_OPENED`), nunca registrou
 * `CHECKOUT_VIEWED` e está sem atividade há pelo menos 5 minutos. Fechar e
 * reabrir o drawer não conta como abandono se depois houver checkout na mesma
 * sessão, porque o marco `checkout_viewed_at` é cumulativo.
 */
export async function realtimeSnapshot(storeId?: string | null): Promise<RealtimeSnapshot> {
  const now = Date.now();
  const online = new Date(now - 60_000).toISOString();
  const window5 = new Date(now - ABANDON_AFTER_MS).toISOString();
  const funnelWindow = new Date(now - FUNNEL_WINDOW_MS).toISOString();

  const { data, error } = await rows<Row<"presence_sessions">>(sql`
    SELECT session_id, state, last_seen_at, cart_opened_at, checkout_viewed_at
    FROM presence_sessions WHERE is_bot = false AND last_seen_at >= ${funnelWindow}
      ${storeId ? sql`AND store_id = ${storeId}` : sql``} LIMIT 20000`);
  if (error) console.error("[presence] snapshot failed", error.message);

  const sessionRows = (data ?? []) as Array<{
    session_id: string;
    state: string;
    last_seen_at: string;
    cart_opened_at: string | null;
    checkout_viewed_at: string | null;
  }>;

  const onlineSet = new Set<string>();
  const cartSet = new Set<string>();
  const checkoutSet = new Set<string>();
  const openedSet = new Set<string>();
  const convertedSet = new Set<string>();
  const abandonedSet = new Set<string>();

  for (const row of sessionRows) {
    if (row.cart_opened_at) {
      openedSet.add(row.session_id);
      if (row.checkout_viewed_at) convertedSet.add(row.session_id);
      else if (row.last_seen_at < window5) abandonedSet.add(row.session_id);
    }

    if (row.state === "ENDED") continue;
    if (row.last_seen_at < window5) continue;
    if (row.last_seen_at >= online) onlineSet.add(row.session_id);
    if (row.state === "CART") cartSet.add(row.session_id);
    if (row.state === "CHECKOUT") checkoutSet.add(row.session_id);
  }

  const opened = openedSet.size;
  const pct = (part: number) => (opened === 0 ? null : Number(((part / opened) * 100).toFixed(1)));

  return {
    online: onlineSet.size,
    cart: cartSet.size,
    checkout: checkoutSet.size,
    drawerAbandoned: abandonedSet.size,
    drawerOpened: opened,
    drawerToCheckout: convertedSet.size,
    drawerToCheckoutRate: pct(convertedSet.size),
    drawerAbandonRate: pct(abandonedSet.size),
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Retenção das linhas de presença. Mantida em 24h (e não em 30 min) porque as
 * taxas do drawer e o abandono são calculados sobre a janela de 24h; a presença
 * "agora" continua sendo decidida por `last_seen_at` (60s / 5 min).
 */
const PRUNE_AFTER_MS = 24 * 60 * 60_000;
/** Janela determinística: no máximo uma limpeza a cada 5 minutos. */
const PRUNE_WINDOW_SECONDS = 300;

/**
 * Limpeza determinística das sessões inativas.
 *
 * Em vez de sortear 5% das requisições, usa o contador `bump_rate_limit` como
 * relógio compartilhado: a primeira chamada de cada janela de 5 minutos executa
 * o DELETE e as demais retornam sem trabalho. Previsível e idempotente.
 */
export async function prunePresence(force = false): Promise<{ pruned: boolean }> {
  try {
    if (!force) {
      const { data, error } = await one<{ value: number }>(sql`
        SELECT public.bump_rate_limit(${"presence_prune"}, ${PRUNE_WINDOW_SECONDS}) AS value`);
      if (error) return { pruned: false };
      if ((data?.value ?? 0) !== 1) return { pruned: false };
    }

    await exec(
      sql`DELETE FROM presence_sessions WHERE last_seen_at < ${new Date(Date.now() - PRUNE_AFTER_MS).toISOString()}`,
    );
    return { pruned: true };
  } catch (error) {
    console.error("[presence] prune failed", (error as Error).message);
    return { pruned: false };
  }
}
