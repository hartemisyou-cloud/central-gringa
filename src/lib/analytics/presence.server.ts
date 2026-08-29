import { supabaseAdmin } from "@/integrations/supabase/client.server";

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

  let storeId: string | null = null;
  if (input.storeSlug) {
    const { data } = await supabaseAdmin
      .from("stores")
      .select("id")
      .eq("slug", input.storeSlug.toLowerCase())
      .maybeSingle();
    storeId = data?.id ?? null;
  } else {
    // Sem slug nesta página: preserva a loja já associada à sessão.
    const { data: existing } = await supabaseAdmin
      .from("presence_sessions")
      .select("store_id")
      .eq("session_id", input.sessionId)
      .maybeSingle();
    storeId = existing?.store_id ?? null;
  }

  // Estado da página atual, sem trava: ENDED é substituído pelo próximo
  // heartbeat válido e CHECKOUT pode voltar para ACTIVE/CART.
  const state: PresenceState = incoming;

  const { error } = await supabaseAdmin.from("presence_sessions").upsert(
    {
      session_id: input.sessionId,
      store_id: storeId,
      state,
      page: input.page ?? null,
      user_agent: userAgent ? userAgent.slice(0, 400) : null,
      is_bot: isBot,
      last_seen_at: now,
    } as never,
    { onConflict: "session_id" },
  );
  if (error) console.error("[presence] upsert failed", error.message);

  return { ok: true, counted: !isBot };
}

export interface RealtimeSnapshot {
  online: number;
  cart: number;
  checkout: number;
  generatedAt: string;
}

/**
 * Contagens ao vivo, deduplicadas por `session_id` (chave primária da tabela).
 * Sem qualquer threshold: o número aparece na primeira sessão.
 */
export async function realtimeSnapshot(storeId?: string | null): Promise<RealtimeSnapshot> {
  const now = Date.now();
  const online = new Date(now - 60_000).toISOString();
  const window5 = new Date(now - 5 * 60_000).toISOString();

  let query = supabaseAdmin
    .from("presence_sessions")
    .select("session_id, state, last_seen_at")
    .eq("is_bot", false)
    .gte("last_seen_at", window5)
    .limit(20000);
  if (storeId) query = query.eq("store_id", storeId);

  const { data, error } = await query;
  if (error) console.error("[presence] snapshot failed", error.message);

  const rows = data ?? [];
  const onlineSet = new Set<string>();
  const cartSet = new Set<string>();
  const checkoutSet = new Set<string>();

  for (const row of rows) {
    if (row.state === "ENDED") continue;
    if (row.last_seen_at >= online) onlineSet.add(row.session_id);
    if (row.state === "CART") cartSet.add(row.session_id);
    if (row.state === "CHECKOUT") checkoutSet.add(row.session_id);
  }

  return {
    online: onlineSet.size,
    cart: cartSet.size,
    checkout: checkoutSet.size,
    generatedAt: new Date().toISOString(),
  };
}

/** Sessões inativas por mais tempo que isto são removidas (= TTL do cliente). */
const PRUNE_AFTER_MS = 30 * 60_000;
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
      const { data, error } = await supabaseAdmin.rpc("bump_rate_limit", {
        _bucket: "presence_prune",
        _window_seconds: PRUNE_WINDOW_SECONDS,
      });
      if (error) return { pruned: false };
      if ((data ?? 0) !== 1) return { pruned: false };
    }

    await supabaseAdmin
      .from("presence_sessions")
      .delete()
      .lt("last_seen_at", new Date(Date.now() - PRUNE_AFTER_MS).toISOString());
    return { pruned: true };
  } catch (error) {
    console.error("[presence] prune failed", (error as Error).message);
    return { pruned: false };
  }
}
