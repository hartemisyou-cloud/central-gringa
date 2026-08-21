/**
 * Coletor de eventos do checkout hospedado.
 * - assíncrono e não bloqueante: nenhuma falha aqui interrompe o pagamento;
 * - envia em lote (batch) com flush por tempo e no unload;
 * - nunca coleta dados de cartão, CVC, client_secret ou credenciais de wallet.
 */

const ENDPOINT = "/api/public/v1/analytics/events";
const STORAGE_KEY = "csp_anon_session";

type QueuedEvent = {
  eventId: string;
  type: string;
  occurredAt: string;
  paymentMethod?: string | undefined;
  errorCode?: string | undefined;
  metadata?: Record<string, string | number | boolean> | undefined;
};

function uid(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

function anonymousSessionId(): string {
  try {
    const existing = localStorage.getItem(STORAGE_KEY);
    if (existing) return existing;
    const created = uid();
    localStorage.setItem(STORAGE_KEY, created);
    return created;
  } catch {
    return uid();
  }
}

function utmParams() {
  try {
    const params = new URLSearchParams(window.location.search);
    return {
      source: params.get("utm_source") ?? undefined,
      medium: params.get("utm_medium") ?? undefined,
      campaign: params.get("utm_campaign") ?? undefined,
      term: params.get("utm_term") ?? undefined,
      content: params.get("utm_content") ?? undefined,
    };
  } catch {
    return {};
  }
}

export interface CheckoutTracker {
  track: (type: string, extra?: Omit<QueuedEvent, "eventId" | "type" | "occurredAt">) => void;
  flush: () => void;
  dispose: () => void;
}

export function createCheckoutTracker(input: { publicToken?: string; storeSlug?: string }): CheckoutTracker {
  if (typeof window === "undefined") {
    return { track: () => {}, flush: () => {}, dispose: () => {} };
  }

  const checkoutSessionId = uid();
  const anon = anonymousSessionId();
  const utm = utmParams();
  const referrer = document.referrer || undefined;
  let queue: QueuedEvent[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let reachedAttempt = false;

  function payload(events: QueuedEvent[]) {
    return JSON.stringify({
      publicToken: input.publicToken,
      storeSlug: input.storeSlug,
      anonymousSessionId: anon,
      checkoutSessionId,
      referrer,
      utm,
      events,
    });
  }

  function flush(useBeacon = false) {
    if (queue.length === 0) return;
    const batch = queue.splice(0, 30);
    const body = payload(batch);
    try {
      if (useBeacon && navigator.sendBeacon) {
        navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "application/json" }));
        return;
      }
      void fetch(ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        keepalive: true,
      }).catch(() => {});
    } catch {
      /* analytics nunca quebra o checkout */
    }
  }

  function track(type: string, extra?: Omit<QueuedEvent, "eventId" | "type" | "occurredAt">) {
    if (type === "payment_submitted") reachedAttempt = true;
    queue.push({ eventId: uid(), type, occurredAt: new Date().toISOString(), ...extra });
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => flush(false), 1200);
  }

  const onHide = () => {
    if (document.visibilityState !== "hidden") return;
    if (!reachedAttempt) track("checkout_abandoned");
    flush(true);
  };

  document.addEventListener("visibilitychange", onHide);
  window.addEventListener("pagehide", onHide);

  return {
    track,
    flush: () => flush(false),
    dispose: () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onHide);
      flush(true);
      queue = [];
    },
  };
}
