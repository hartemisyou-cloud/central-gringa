import { describe, expect, it, beforeEach, vi } from "vitest";

const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};
(globalThis as any).window = {
  location: { href: "https://livrariadacultura.shop/", origin: "https://livrariadacultura.shop" },
  history: { state: null, replaceState: () => {} },
};

const mod = await import("@/lib/analytics/presence");
const { presenceSessionId, isExpired, IDLE_TTL_MS, MAX_AGE_MS, withPresenceSession } = mod as any;
const KEY = "csp_presence_session";
const read = () => JSON.parse(store.get(KEY)!);

describe("ciclo de vida do session_id", () => {
  beforeEach(() => { store.clear(); vi.useRealTimers(); (globalThis as any).window.location.href = "https://livrariadacultura.shop/"; });

  it("sair e voltar em minutos mantém o mesmo id", () => {
    const a = presenceSessionId();
    const rec = read();
    store.set(KEY, JSON.stringify({ ...rec, lastSeen: Date.now() - 5 * 60_000 }));
    expect(presenceSessionId()).toBe(a);
  });

  it("retorno após 30 min de inatividade rotaciona o id", () => {
    const a = presenceSessionId();
    const rec = read();
    store.set(KEY, JSON.stringify({ ...rec, lastSeen: Date.now() - (IDLE_TTL_MS + 1000) }));
    const b = presenceSessionId();
    expect(b).not.toBe(a);
    expect(read().createdAt).toBeGreaterThan(rec.createdAt - 1);
  });

  it("retorno no dia seguinte rotaciona o id", () => {
    const a = presenceSessionId();
    store.set(KEY, JSON.stringify({ id: a, lastSeen: Date.now() - 26 * 3600_000, createdAt: Date.now() - 26 * 3600_000 }));
    expect(presenceSessionId()).not.toBe(a);
  });

  it("idade máxima de 24h rotaciona mesmo com uso contínuo", () => {
    const a = presenceSessionId();
    store.set(KEY, JSON.stringify({ id: a, lastSeen: Date.now() - 1000, createdAt: Date.now() - (MAX_AGE_MS + 1000) }));
    expect(presenceSessionId()).not.toBe(a);
    expect(isExpired({ id: a, lastSeen: Date.now(), createdAt: Date.now() - MAX_AGE_MS - 1 })).toBe(true);
  });

  it("site -> checkout preserva o id via csid e mantém a idade original", () => {
    const a = presenceSessionId();
    const created = read().createdAt;
    const link = withPresenceSession("https://pay.freeheartsfoundations.org/checkout");
    expect(link).toContain(`csid=${a}`);
    // checkout adota o csid
    (globalThis as any).window.location.href = `https://pay.freeheartsfoundations.org/checkout?csid=${a}`;
    expect(presenceSessionId()).toBe(a);
    expect(read().createdAt).toBe(created);
  });

  it("id legado em formato antigo (string) não quebra e vira sessão nova", () => {
    store.set(KEY, "id-antigo-sem-json");
    const a = presenceSessionId();
    expect(a).not.toBe("id-antigo-sem-json");
    expect(read().id).toBe(a);
  });
});
