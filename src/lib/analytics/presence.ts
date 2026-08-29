/**
 * Camada de presença em tempo real (cliente).
 *
 * Objetivo: alimentar os cards "Online agora", "Carrinho aberto agora" e
 * "No checkout agora" do painel admin. Nada aqui toca pagamento, Stripe,
 * webhook, Meta CAPI, UTMify ou attribution.
 *
 * - heartbeat leve a cada 30s enquanto a aba estiver visível;
 * - a fonte principal de expiração é o `last_seen_at` no servidor;
 *   `SESSION_ENDED` é apenas uma otimização enviada no `pagehide`;
 * - o mesmo `session_id` é reaproveitado entre domínios (vitrine → checkout)
 *   através do parâmetro `csid`, para não contar a mesma pessoa duas vezes.
 */

export const PRESENCE_ENDPOINT = "/api/public/v1/analytics/presence";
export const PRESENCE_PARAM = "csid";
const STORAGE_KEY = "csp_presence_session";
export const HEARTBEAT_MS = 30_000;

export type PresenceEvent =
  | "SESSION_ACTIVE"
  | "CART_OPENED"
  | "CHECKOUT_VIEWED"
  | "PAYMENT_SUCCEEDED"
  | "SESSION_ENDED";

const ID_PATTERN = /^[A-Za-z0-9_-]{8,80}$/;

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

function readStored(): string | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value && ID_PATTERN.test(value) ? value : null;
  } catch {
    return null;
  }
}

function store(id: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* modo privado: a sessão vale só para esta página */
  }
}

/** Identificador da sessão: parâmetro cross-domain > armazenado > novo. */
export function presenceSessionId(): string {
  if (typeof window === "undefined") return "ssr";
  try {
    const url = new URL(window.location.href);
    const incoming = url.searchParams.get(PRESENCE_PARAM);
    if (incoming && ID_PATTERN.test(incoming)) {
      store(incoming);
      // limpa a URL para não vazar o identificador em referrer/compartilhamento
      url.searchParams.delete(PRESENCE_PARAM);
      window.history.replaceState(window.history.state, "", url.toString());
      return incoming;
    }
  } catch {
    /* ignora URLs inválidas */
  }
  const existing = readStored();
  if (existing) return existing;
  const created = newId();
  store(created);
  return created;
}

/** Anexa o `csid` a um link externo (ex.: vitrine → domínio do checkout). */
export function withPresenceSession(href: string): string {
  if (typeof window === "undefined") return href;
  try {
    const url = new URL(href, window.location.origin);
    url.searchParams.set(PRESENCE_PARAM, presenceSessionId());
    return url.toString();
  } catch {
    return href;
  }
}

function post(body: string, beacon: boolean): void {
  try {
    if (beacon && navigator.sendBeacon) {
      navigator.sendBeacon(PRESENCE_ENDPOINT, new Blob([body], { type: "application/json" }));
      return;
    }
    void fetch(PRESENCE_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* presença nunca quebra a loja */
  }
}

export interface PresenceOptions {
  storeSlug?: string | undefined;
  /** Estado inicial/base desta página. */
  state?: PresenceEvent | undefined;
}

export interface PresenceHandle {
  sessionId: string;
  send: (event: PresenceEvent) => void;
  dispose: () => void;
}

/** Inicia o heartbeat de presença desta página. Chamar dentro de useEffect. */
export function startPresence(options: PresenceOptions = {}): PresenceHandle {
  if (typeof window === "undefined") {
    return { sessionId: "ssr", send: () => {}, dispose: () => {} };
  }

  const sessionId = presenceSessionId();
  let current: PresenceEvent = options.state ?? "SESSION_ACTIVE";
  let disposed = false;

  const payload = (event: PresenceEvent) =>
    JSON.stringify({
      sessionId,
      storeSlug: options.storeSlug,
      event,
      page: window.location.pathname.slice(0, 160),
    });

  const send = (event: PresenceEvent, beacon = false) => {
    if (disposed && event !== "SESSION_ENDED") return;
    if (event !== "SESSION_ENDED") current = event;
    post(payload(event), beacon);
  };

  send(current);

  const timer = window.setInterval(() => {
    if (document.visibilityState === "hidden") return;
    send(current);
  }, HEARTBEAT_MS);

  const onVisible = () => {
    if (document.visibilityState === "visible") send(current);
  };
  const onHide = () => send("SESSION_ENDED", true);

  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("pagehide", onHide);

  return {
    sessionId,
    send: (event: PresenceEvent) => send(event),
    dispose: () => {
      disposed = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pagehide", onHide);
    },
  };
}
