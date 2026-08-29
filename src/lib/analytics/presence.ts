/**
 * Camada de presença em tempo real (cliente).
 *
 * Objetivo: alimentar os cards "Online agora", "Carrinho aberto agora" e
 * "No checkout agora" do painel admin. Nada aqui toca pagamento, Stripe,
 * webhook, Meta CAPI, UTMify ou attribution.
 *
 * Regras do ciclo de vida do identificador:
 * - `{ id, lastSeen, createdAt }` no localStorage;
 * - rotaciona após 30 min de inatividade OU 24h de idade máxima, para que
 *   "voltar amanhã" seja uma sessão nova e não um id perpétuo;
 * - `last_seen_at` no servidor continua sendo a fonte principal de expiração;
 * - `SESSION_ENDED` é apenas um sinal temporário e só é enviado quando esta é
 *   a última aba viva desta sessão;
 * - o mesmo `session_id` é reaproveitado entre domínios (vitrine → checkout)
 *   através do parâmetro `csid`.
 */

export const PRESENCE_ENDPOINT = "/api/public/v1/analytics/presence";
export const PRESENCE_PARAM = "csid";
const STORAGE_KEY = "csp_presence_session";
const TABS_KEY = "csp_presence_tabs";
export const HEARTBEAT_MS = 30_000;
/** Inatividade que encerra a sessão e força um novo id. */
export const IDLE_TTL_MS = 30 * 60_000;
/** Idade máxima absoluta de um id, mesmo em uso contínuo. */
export const MAX_AGE_MS = 24 * 60 * 60_000;
/** Uma aba é considerada viva enquanto tiver batido dentro desta janela. */
const TAB_TTL_MS = HEARTBEAT_MS * 3;

export type PresenceEvent =
  | "SESSION_ACTIVE"
  | "CART_OPENED"
  | "CHECKOUT_VIEWED"
  | "PAYMENT_SUCCEEDED"
  | "SESSION_ENDED";

const ID_PATTERN = /^[A-Za-z0-9_-]{8,80}$/;

interface StoredSession {
  id: string;
  lastSeen: number;
  createdAt: number;
}

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

function readStored(): StoredSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    // Formato legado (string simples): tratado como sessão nova.
    if (!raw.startsWith("{")) return null;
    const parsed = JSON.parse(raw) as Partial<StoredSession>;
    if (typeof parsed.id !== "string" || !ID_PATTERN.test(parsed.id)) return null;
    const lastSeen = typeof parsed.lastSeen === "number" ? parsed.lastSeen : 0;
    const createdAt = typeof parsed.createdAt === "number" ? parsed.createdAt : lastSeen;
    return { id: parsed.id, lastSeen, createdAt };
  } catch {
    return null;
  }
}

function store(session: StoredSession): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    /* modo privado: a sessão vale só para esta página */
  }
}

/** Uma sessão expira por inatividade (30 min) ou por idade máxima (24h). */
export function isExpired(session: StoredSession, now = Date.now()): boolean {
  return now - session.lastSeen > IDLE_TTL_MS || now - session.createdAt > MAX_AGE_MS;
}

/**
 * Identificador da sessão: parâmetro cross-domain > armazenado válido > novo.
 * Cada chamada renova o `lastSeen`, então a expiração é por inatividade real.
 */
export function presenceSessionId(): string {
  if (typeof window === "undefined") return "ssr";
  const now = Date.now();

  try {
    const url = new URL(window.location.href);
    const incoming = url.searchParams.get(PRESENCE_PARAM);
    if (incoming && ID_PATTERN.test(incoming)) {
      const existing = readStored();
      // Continuidade cross-domain: adota o id recebido e preserva a idade
      // original quando é a mesma sessão que veio do outro domínio.
      const createdAt = existing?.id === incoming ? existing.createdAt : now;
      store({ id: incoming, lastSeen: now, createdAt });
      // limpa a URL para não vazar o identificador em referrer/compartilhamento
      url.searchParams.delete(PRESENCE_PARAM);
      window.history.replaceState(window.history.state, "", url.toString());
      return incoming;
    }
  } catch {
    /* ignora URLs inválidas */
  }

  const stored = readStored();
  if (stored && !isExpired(stored, now)) {
    store({ ...stored, lastSeen: now });
    return stored.id;
  }

  const created = newId();
  store({ id: created, lastSeen: now, createdAt: now });
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

/* ------------------------------------------------------------------ */
/* Registro de abas: fechar uma aba não derruba a presença das outras. */
/* ------------------------------------------------------------------ */

function readTabs(): Record<string, number> {
  try {
    const raw = localStorage.getItem(TABS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "number") out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

function writeTabs(tabs: Record<string, number>): void {
  try {
    localStorage.setItem(TABS_KEY, JSON.stringify(tabs));
  } catch {
    /* ignora */
  }
}

function touchTab(tabId: string): void {
  const now = Date.now();
  const tabs = readTabs();
  tabs[tabId] = now;
  for (const [key, seen] of Object.entries(tabs)) {
    if (now - seen > TAB_TTL_MS) delete tabs[key];
  }
  writeTabs(tabs);
}

/** Remove esta aba e informa se ainda existe outra aba viva. */
function releaseTab(tabId: string): { othersAlive: boolean } {
  const now = Date.now();
  const tabs = readTabs();
  delete tabs[tabId];
  let othersAlive = false;
  for (const [key, seen] of Object.entries(tabs)) {
    if (now - seen > TAB_TTL_MS) delete tabs[key];
    else if (key !== tabId) othersAlive = true;
  }
  writeTabs(tabs);
  return { othersAlive };
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
  /** Estado desta página; o servidor passa a refletir a página atual. */
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

  const tabId = newId();
  let sessionId = presenceSessionId();
  touchTab(tabId);

  let current: PresenceEvent = options.state ?? "SESSION_ACTIVE";
  let disposed = false;

  const payload = (event: PresenceEvent, id: string) =>
    JSON.stringify({
      sessionId: id,
      storeSlug: options.storeSlug,
      event,
      page: window.location.pathname.slice(0, 160),
    });

  const send = (event: PresenceEvent, beacon = false) => {
    if (disposed && event !== "SESSION_ENDED") return;
    if (event === "SESSION_ENDED") {
      post(payload(event, sessionId), beacon);
      return;
    }
    current = event;
    // Heartbeat válido de página ativa: renova o id (ou rotaciona se expirou)
    // e mantém o registro desta aba vivo.
    sessionId = presenceSessionId();
    touchTab(tabId);
    post(payload(event, sessionId), beacon);
  };

  send(current);

  const timer = window.setInterval(() => {
    if (document.visibilityState === "hidden") return;
    send(current);
  }, HEARTBEAT_MS);

  const onVisible = () => {
    if (document.visibilityState === "visible") send(current);
  };
  const onHide = () => {
    // Só encerra quando esta era a última aba viva desta sessão.
    const { othersAlive } = releaseTab(tabId);
    if (!othersAlive) send("SESSION_ENDED", true);
  };

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
      releaseTab(tabId);
    },
  };
}
