import { describe, expect, it, beforeEach } from "vitest";

const store = new Map<string, string>();
const listeners: Record<string, Array<() => void>> = {};
const sent: Array<{ url: string; body: any }> = [];

(globalThis as any).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};
(globalThis as any).document = {
  visibilityState: "visible",
  addEventListener: () => {},
  removeEventListener: () => {},
};
(globalThis as any).window = {
  location: { href: "https://livrariadacultura.shop/", origin: "https://livrariadacultura.shop", pathname: "/" },
  history: { state: null, replaceState: () => {} },
  setInterval: () => 1 as any,
  clearInterval: () => {},
  addEventListener: (ev: string, fn: () => void) => {
    (listeners[ev] ||= []).push(fn);
  },
  removeEventListener: (ev: string, fn: () => void) => {
    listeners[ev] = (listeners[ev] ?? []).filter((f) => f !== fn);
  },
};
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: {
    sendBeacon: (url: string, blob: any) => {
      sent.push({ url, body: JSON.parse(blob.__body) });
      return true;
    },
  },
});
// Blob simplificado para capturar o corpo do beacon
(globalThis as any).Blob = class {
  __body: string;
  constructor(parts: string[]) {
    this.__body = parts.join("");
  }
};
(globalThis as any).fetch = () => Promise.resolve({ ok: true }) as any;

const { startPresence } = (await import("@/lib/analytics/presence")) as any;

function firePagehide(index: number) {
  const fns = listeners["pagehide"] ?? [];
  fns[index]?.();
}

describe("duas abas abertas", () => {
  beforeEach(() => {
    store.clear();
    sent.length = 0;
    listeners["pagehide"] = [];
  });

  it("fechar uma aba não envia SESSION_ENDED enquanto a outra está aberta", () => {
    const tabA = startPresence({ state: "SESSION_ACTIVE", storeSlug: "livraria-cultura" });
    const tabB = startPresence({ state: "CHECKOUT_VIEWED", storeSlug: "livraria-cultura" });
    expect(tabA.sessionId).toBe(tabB.sessionId); // mesmo visitante, um único session_id

    firePagehide(0); // fecha a primeira aba
    expect(sent.filter((s) => s.body.event === "SESSION_ENDED")).toHaveLength(0);

    firePagehide(1); // fecha a última aba
    const ended = sent.filter((s) => s.body.event === "SESSION_ENDED");
    expect(ended).toHaveLength(1);
    expect(ended[0]!.body.sessionId).toBe(tabA.sessionId);
  });

  it("aba única fechando envia SESSION_ENDED", () => {
    startPresence({ state: "SESSION_ACTIVE" });
    firePagehide(0);
    expect(sent.filter((s) => s.body.event === "SESSION_ENDED")).toHaveLength(1);
  });
});
