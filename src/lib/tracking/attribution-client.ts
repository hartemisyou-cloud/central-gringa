/**
 * Captura de atribuição no navegador da vitrine (BFF).
 *
 * Guarda UTMs, click ids, referrer e landing page da PRIMEIRA visita da sessão
 * e os cookies do Meta (_fbp/_fbc) atualizados. Nada sensível é armazenado —
 * apenas a allowlist já usada pela API central.
 */
import { ATTRIBUTION_KEYS, type Attribution } from "@/lib/payments/attribution";

const STORAGE_KEY = "lc.attribution";

const URL_KEYS = ATTRIBUTION_KEYS.filter(
  (key) => key !== "fbp" && key !== "fbc" && key !== "referrer" && key !== "landing_page",
);

function readCookie(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

function load(): Attribution {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Attribution) : {};
  } catch {
    return {};
  }
}

function save(value: Attribution): void {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    /* sessionStorage indisponível — segue sem persistir */
  }
}

/** Chame no carregamento de qualquer página pública da vitrine. */
export function captureAttribution(): Attribution {
  if (typeof window === "undefined") return {};
  const current = load();
  const params = new URLSearchParams(window.location.search);
  const next: Attribution = { ...current };

  for (const key of URL_KEYS) {
    const value = params.get(key)?.trim();
    // Primeira origem da sessão vence: não sobrescreve atribuição já capturada.
    if (value && !next[key]) next[key] = value.slice(0, 255);
  }
  if (!next.landing_page) next.landing_page = window.location.href.slice(0, 2000);
  if (!next.referrer && document.referrer) next.referrer = document.referrer.slice(0, 2000);

  // Cookies do Meta mudam durante a sessão: sempre usam o valor mais recente.
  const fbp = readCookie("_fbp");
  const fbc = readCookie("_fbc") ?? (next.fbclid ? `fb.1.${Date.now()}.${next.fbclid}` : undefined);
  if (fbp) next.fbp = fbp;
  if (fbc) next.fbc = fbc;

  save(next);
  return next;
}

/** Atribuição acumulada da sessão, pronta para enviar ao checkout. */
export function readAttribution(): Attribution {
  if (typeof window === "undefined") return {};
  return captureAttribution();
}
