import { sql, one, exec } from "@/lib/db/client.server";
import { PaymentError } from "./errors";
import { sha256Hex, timingSafeEqual } from "./crypto.server";
import type { Database } from "@/lib/db/types";

export type StoreRow = Database["public"]["Tables"]["stores"]["Row"];

/**
 * Autenticação da Loja -> API Central.
 * A credencial (`store_api_key`) NUNCA pode existir no JavaScript público:
 * ela vive apenas no BFF server-side da loja.
 * O banco guarda somente o hash SHA-256 da chave.
 */
export async function authenticateStoreRequest(request: Request): Promise<StoreRow> {
  const header =
    request.headers.get("x-store-api-key") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    "";

  if (!header || !header.includes(".")) {
    throw new PaymentError("UNAUTHORIZED", "Store credential missing or invalid.");
  }
  const [keyId, secret] = header.split(".");
  if (!keyId || !secret) {
    throw new PaymentError("UNAUTHORIZED", "Malformed store credential.");
  }

  // Uma credencial pode atender várias lojas (chave unificada). A loja padrão é
  // a dona da chave; para as demais, a loja é escolhida via `x-store-slug`
  // e só é aceita se estiver no escopo autorizado da credencial.
  const requestedSlug = request.headers.get("x-store-slug")?.trim().toLowerCase() || null;

  // As duas leituras são independentes (uma usa o key_id, outra o slug) e
  // nenhuma escreve — podem ir em paralelo. A ORDEM DAS VALIDAÇÕES abaixo
  // permanece exatamente a mesma de antes.
  const [{ data: keyRow }, requestedResult] = await Promise.all([
    one<Pick<Database["public"]["Tables"]["store_api_keys"]["Row"], "id" | "store_id" | "key_hash" | "status">>(sql`
      select id, store_id, key_hash, status from public.store_api_keys where key_id = ${keyId}
    `, true),
    requestedSlug
      ? one<StoreRow>(sql`select * from public.stores where slug = ${requestedSlug}`, true)
      : Promise.resolve({ data: null }),
  ]);

  if (!keyRow || keyRow.status !== "ACTIVE") {
    throw new PaymentError("UNAUTHORIZED", "Store credential invalid or revoked.");
  }

  const providedHash = await sha256Hex(`${keyId}.${secret}`);
  if (!timingSafeEqual(providedHash, keyRow.key_hash)) {
    throw new PaymentError("UNAUTHORIZED", "Store credential invalid or revoked.");
  }

  let store: StoreRow | null = null;

  if (requestedSlug) {
    const requested = requestedResult.data as StoreRow | null;
    if (!requested) throw new PaymentError("NOT_FOUND", "Store not found.");

    if (requested.id !== keyRow.store_id) {
      const { data: scope } = await one<{ id: string }>(sql`
        select id from public.store_api_key_scopes
        where api_key_id = ${keyRow.id} and store_id = ${requested.id}
      `, true);
      if (!scope) {
        throw new PaymentError("FORBIDDEN", "Credential not authorized for this store.");
      }
    }
    // A linha completa já veio na consulta por slug: dispensa o SELECT por id.
    store = requested;
  } else {
    const { data } = await one<StoreRow>(sql`
      select * from public.stores where id = ${keyRow.store_id}
    `, true);
    store = data;
  }

  if (!store || store.status !== "ACTIVE") {
    throw new PaymentError("FORBIDDEN", "Store inactive.");
  }

  // Telemetria não-crítica: sai do caminho crítico via waitUntil (com fallback
  // para await em ambientes sem ExecutionContext).
  const { runInBackground } = await import("./background.server");
  await runInBackground(
    async () => {
      await exec(sql`update public.store_api_keys set last_used_at = ${new Date().toISOString()} where id = ${keyRow.id}`);
    },
    "store_api_keys.last_used_at",
  );

  return store;
}

/** Rate limiting por bucket persistido no banco (protege contra abuso/flood). */
export async function enforceRateLimit(
  bucket: string,
  limit: number,
  windowSeconds: number,
): Promise<void> {
  const { data: result, error } = await one<{ value: number }>(sql`
    select public.bump_rate_limit(${bucket}, ${windowSeconds}) as value
  `);
  const data = result?.value;
  if (error || !Number.isSafeInteger(data) || data! < 1) {
    console.error("[rate-limit] unavailable", error?.code ?? "INVALID_COUNTER");
    throw new PaymentError("CONFIG_ERROR", "Request protection is temporarily unavailable.");
  }
  if (typeof data === "number" && data > limit) {
    throw new PaymentError("RATE_LIMITED", "Too many requests. Please try again shortly.");
  }
}

export function clientIp(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

/** Allowlist de origens: nunca `*` em endpoints sensíveis. */
export function corsHeaders(store: StoreRow | null, origin: string | null): Record<string, string> {
  const allowed = store?.allowed_origins ?? [];
  const headers: Record<string, string> = {
    Vary: "Origin",
    "Access-Control-Allow-Headers": "content-type, x-store-api-key, x-store-slug, authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };
  if (origin && allowed.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

export function jsonResponse(
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...extraHeaders },
  });
}
