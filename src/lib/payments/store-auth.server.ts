import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { PaymentError } from "./errors";
import { sha256Hex, timingSafeEqual } from "./crypto.server";
import type { Database } from "@/integrations/supabase/types";

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
    throw new PaymentError("UNAUTHORIZED", "Credencial da loja ausente ou inválida.");
  }
  const [keyId, secret] = header.split(".");
  if (!keyId || !secret) {
    throw new PaymentError("UNAUTHORIZED", "Credencial da loja malformada.");
  }

  const { data: keyRow } = await supabaseAdmin
    .from("store_api_keys")
    .select("id, store_id, key_hash, status")
    .eq("key_id", keyId)
    .maybeSingle();

  if (!keyRow || keyRow.status !== "ACTIVE") {
    throw new PaymentError("UNAUTHORIZED", "Credencial da loja inválida ou revogada.");
  }

  const providedHash = await sha256Hex(`${keyId}.${secret}`);
  if (!timingSafeEqual(providedHash, keyRow.key_hash)) {
    throw new PaymentError("UNAUTHORIZED", "Credencial da loja inválida ou revogada.");
  }

  const { data: store } = await supabaseAdmin
    .from("stores")
    .select("*")
    .eq("id", keyRow.store_id)
    .maybeSingle();

  if (!store || store.status !== "ACTIVE") {
    throw new PaymentError("FORBIDDEN", "Loja inativa.");
  }

  await supabaseAdmin
    .from("store_api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", keyRow.id);

  return store;
}

/** Rate limiting por bucket persistido no banco (protege contra abuso/flood). */
export async function enforceRateLimit(
  bucket: string,
  limit: number,
  windowSeconds: number,
): Promise<void> {
  const { data, error } = await supabaseAdmin.rpc("bump_rate_limit", {
    _bucket: bucket,
    _window_seconds: windowSeconds,
  });
  if (error) {
    console.error("[rate-limit] failed", error.message);
    return;
  }
  if (typeof data === "number" && data > limit) {
    throw new PaymentError("RATE_LIMITED", "Muitas requisições. Tente novamente em instantes.");
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
    "Access-Control-Allow-Headers": "content-type, x-store-api-key, authorization",
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
