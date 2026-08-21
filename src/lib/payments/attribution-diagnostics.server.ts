/**
 * INSTRUMENTAÇÃO TEMPORÁRIA — DIAGNÓSTICO DE ATRIBUIÇÃO (UTM / click IDs).
 *
 * Objetivo: descobrir se os checkouts enviam dados de atribuição para a Central
 * e em que ponto do fluxo eles são descartados.
 *
 * Regras de segurança aplicadas aqui:
 * - allowlist estrita: só campos de atribuição conhecidos são inspecionados;
 * - nunca registra chaves (sk_/rk_/pk_), client_secret, tokens, Authorization,
 *   cookies, dados de cartão/CVC, e-mail, telefone, documento ou endereço;
 * - valores são truncados e higienizados;
 * - de campos desconhecidos registramos APENAS o nome da chave, nunca o valor.
 *
 * Este módulo é read-only: não altera pagamentos, pedidos nem o PaymentIntent.
 * Remover após a definição da implementação definitiva de tracking.
 */

/** Campos de atribuição procurados no payload do checkout. */
export const ATTRIBUTION_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "gclid",
  "gbraid",
  "wbraid",
  "fbclid",
  "fbp",
  "fbc",
  "ttclid",
  "msclkid",
  "twclid",
  "li_fat_id",
  "epik",
  "irclickid",
  "referrer",
  "referer",
  "landing_page",
  "landingpage",
  "click_id",
  "clickid",
  "session_id",
  "sessionid",
  "checkout_session_id",
  "anonymous_session_id",
  "src",
  "sck",
  "xcod",
] as const;

/** Nomes de campos que NUNCA podem ser lidos/registrados por este módulo. */
const FORBIDDEN_KEY_PATTERN =
  /(secret|key|token|password|authorization|cookie|card|cvc|cvv|iban|pan|email|phone|document|cpf|cnpj|postal|zip|street|address)/i;

const ALLOWED = new Set<string>(ATTRIBUTION_KEYS.map((key) => key.toLowerCase()));

/** Normaliza `utmSource` / `UTM-Source` / `utm.source` para `utm_source`. */
function normalizeKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[-.\s]+/g, "_")
    .toLowerCase();
}

/** Valores de UTM/click ID não são sensíveis, mas ainda assim truncamos. */
function safeValue(value: unknown): string | null {
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > 80 ? `${trimmed.slice(0, 80)}…` : trimmed;
}

export interface AttributionScan {
  /** Campo de atribuição -> valor higienizado. */
  found: Record<string, string>;
  /** Nomes (sem valores) de chaves não reconhecidas, para revelar campos novos. */
  unknownKeys: string[];
}

/**
 * Varre um objeto (profundidade limitada) procurando campos de atribuição.
 * Contêineres aninhados comuns (`utm`, `tracking`, `attribution`, `analytics`,
 * `metadata`) também são inspecionados.
 */
export function scanAttribution(input: unknown, depth = 0): AttributionScan {
  const found: Record<string, string> = {};
  const unknownKeys: string[] = [];
  if (!input || typeof input !== "object" || Array.isArray(input) || depth > 3) {
    return { found, unknownKeys };
  }

  for (const [rawKey, rawValue] of Object.entries(input as Record<string, unknown>)) {
    const key = normalizeKey(rawKey);
    if (FORBIDDEN_KEY_PATTERN.test(key)) continue;

    if (rawValue && typeof rawValue === "object" && !Array.isArray(rawValue)) {
      const nested = scanAttribution(rawValue, depth + 1);
      for (const [nestedKey, nestedValue] of Object.entries(nested.found)) {
        // `utm: { source }` vira `utm_source`.
        const composed = ALLOWED.has(nestedKey) ? nestedKey : `${key}_${nestedKey}`;
        found[composed] ??= nestedValue;
      }
      for (const nestedKey of nested.unknownKeys) unknownKeys.push(`${key}.${nestedKey}`);
      continue;
    }

    if (ALLOWED.has(key)) {
      const value = safeValue(rawValue);
      if (value !== null) found[key] = value;
      continue;
    }
    if (depth === 0) unknownKeys.push(key);
  }

  return { found, unknownKeys };
}

/** Mescla varreduras mantendo a origem de cada campo encontrado. */
export function mergeScans(
  entries: Array<{ origin: string; scan: AttributionScan }>,
): { fields: Record<string, { value: string; origin: string }>; unknownKeys: string[] } {
  const fields: Record<string, { value: string; origin: string }> = {};
  const unknownKeys = new Set<string>();
  for (const entry of entries) {
    for (const [key, value] of Object.entries(entry.scan.found)) {
      fields[key] ??= { value, origin: entry.origin };
    }
    for (const key of entry.scan.unknownKeys) unknownKeys.add(`${entry.origin}:${key}`);
  }
  return { fields, unknownKeys: [...unknownKeys] };
}

/** Presença/ausência de cada campo do catálogo, para leitura rápida no log. */
export function presenceMap(fields: Record<string, unknown>): Record<string, boolean> {
  const map: Record<string, boolean> = {};
  for (const key of ATTRIBUTION_KEYS) map[key] = fields[key] !== undefined;
  return map;
}

export interface AttributionLogInput {
  stage: "checkout->central" | "central->paymentintent";
  storeId?: string | null;
  orderId?: string | null;
  orderNumber?: string | null;
  fields: Record<string, { value: string; origin: string }>;
  unknownKeys?: string[];
  /** Chaves de metadata efetivamente enviadas ao provedor (nomes, não valores). */
  metadataKeys?: string[];
  notes?: string[];
}

/** Log estruturado de uma linha só, sem nenhum dado sensível. */
export function logAttribution(input: AttributionLogInput): void {
  const received = Object.entries(input.fields).map(([key, entry]) => ({
    field: key,
    value: entry.value,
    origin: entry.origin,
  }));

  console.info(
    "[attribution-diagnostics]",
    JSON.stringify({
      stage: input.stage,
      store_id: input.storeId ?? null,
      order_id: input.orderId ?? null,
      order_number: input.orderNumber ?? null,
      attribution_received: received,
      attribution_present: presenceMap(input.fields),
      attribution_missing: ATTRIBUTION_KEYS.filter((key) => input.fields[key] === undefined),
      unknown_payload_keys: input.unknownKeys ?? [],
      payment_intent_metadata_keys: input.metadataKeys ?? [],
      notes: input.notes ?? [],
    }),
  );
}
