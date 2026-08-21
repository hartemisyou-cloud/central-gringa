import { z } from "zod";

/**
 * Atribuição de marketing (UTMs + click ids).
 * Regras:
 * - todos os campos são opcionais: um checkout sem UTMs continua funcionando igual;
 * - allowlist estrita — nenhum objeto arbitrário e nenhum dado sensível é aceito;
 * - valores são sanitizados e truncados antes de persistir ou ir para a Stripe.
 */
export const ATTRIBUTION_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "gclid",
  "fbclid",
  "ttclid",
  "msclkid",
  "gbraid",
  "wbraid",
  "fbp",
  "fbc",
  "referrer",
  "landing_page",
  "click_id",
  "checkout_session_id",
  "anonymous_session_id",
] as const;

export type AttributionKey = (typeof ATTRIBUTION_KEYS)[number];
export type Attribution = { [K in AttributionKey]?: string | undefined };

/** URLs podem ser mais longas; os demais campos são curtos por natureza. */
const MAX_LENGTH: Partial<Record<AttributionKey, number>> = {
  referrer: 500,
  landing_page: 500,
};
const DEFAULT_MAX_LENGTH = 255;

function field(key: AttributionKey) {
  return z
    .string()
    .trim()
    .max(MAX_LENGTH[key] ?? DEFAULT_MAX_LENGTH)
    .optional();
}

export const attributionSchema = z
  .object(
    Object.fromEntries(ATTRIBUTION_KEYS.map((key) => [key, field(key)])) as {
      [K in AttributionKey]: z.ZodOptional<z.ZodString>;
    },
  )
  .strip()
  .optional();

/** Remove caracteres de controle e valores vazios; nunca lança. */
export function normalizeAttribution(input: Attribution | undefined | null): Attribution {
  const out: Attribution = {};
  if (!input || typeof input !== "object") return out;
  for (const key of ATTRIBUTION_KEYS) {
    const raw = input[key];
    if (typeof raw !== "string") continue;
    const cleaned = raw
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .trim()
      .slice(0, MAX_LENGTH[key] ?? DEFAULT_MAX_LENGTH);
    if (cleaned) out[key] = cleaned;
  }
  return out;
}

export function hasAttribution(value: Attribution): boolean {
  return Object.keys(value).length > 0;
}

/** Limites da Stripe: 50 chaves por objeto, valores de até 500 caracteres. */
const STRIPE_MAX_KEYS = 50;
const STRIPE_MAX_VALUE = 500;

/** Prioridade caso o orçamento de chaves acabe (campos mais úteis para atribuição). */
const PRIORITY: AttributionKey[] = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "fbclid",
  "gclid",
  "ttclid",
  "msclkid",
  "gbraid",
  "wbraid",
  "fbp",
  "fbc",
  "click_id",
  "checkout_session_id",
  "anonymous_session_id",
  "referrer",
  "landing_page",
];

/**
 * Mescla a atribuição no metadata base do PaymentIntent.
 * O metadata base (store_id, order_id, order_number, environment) é sempre preservado
 * e nunca é sobrescrito; campos vazios não são adicionados.
 */
export function mergeAttributionIntoMetadata(
  base: Record<string, string>,
  attribution: Attribution,
): Record<string, string> {
  const merged: Record<string, string> = { ...base };
  for (const key of PRIORITY) {
    if (Object.keys(merged).length >= STRIPE_MAX_KEYS) break;
    if (key in merged) continue;
    const value = attribution[key];
    if (!value) continue;
    merged[key] = value.slice(0, STRIPE_MAX_VALUE);
  }
  return merged;
}

/** Parâmetros repassados na URL do checkout hospedado (sem dados sensíveis). */
const QUERY_KEYS: AttributionKey[] = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "gclid",
  "fbclid",
  "ttclid",
  "msclkid",
  "gbraid",
  "wbraid",
];

/** Anexa a atribuição à paymentUrl sem duplicar nem criar parâmetros vazios. */
export function appendAttributionToUrl(url: string, attribution: Attribution): string {
  const parsed = new URL(url);
  for (const key of QUERY_KEYS) {
    const value = attribution[key];
    if (!value) continue;
    if (parsed.searchParams.has(key)) continue;
    parsed.searchParams.set(key, value);
  }
  return parsed.toString();
}
