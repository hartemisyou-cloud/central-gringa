import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { decryptSecret, encryptSecret } from "@/lib/payments/crypto.server";

/**
 * Configuração de rastreamento Meta por loja (multi-tenant).
 *
 * O Access Token existe SOMENTE no servidor, cifrado em repouso (AES-256-GCM,
 * mesmo cofre das credenciais Stripe). Ele nunca é retornado por endpoint
 * público, nunca vai ao HTML e nunca é registrado em log.
 */

export interface MetaSettings {
  storeId: string;
  pixelId: string | null;
  enabled: boolean;
  testEventCode: string | null;
  hasAccessToken: boolean;
}

export interface MetaSettingsWithToken extends MetaSettings {
  accessToken: string;
}

export interface MetaSettingsSummary extends MetaSettings {
  storeName: string;
  storeSlug: string;
  accessTokenLast4: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  status: "DISABLED" | "NOT_CONFIGURED" | "CONFIGURED" | "CONNECTED" | "ERROR";
  eventCount: number;
  lastPurchaseAt: string | null;
}

/** Config pública (apenas o Pixel ID) — segura para o navegador. */
export async function getPublicMetaConfig(
  storeId: string,
): Promise<{ pixelId: string | null; enabled: boolean }> {
  const { data } = await supabaseAdmin
    .from("meta_tracking_settings")
    .select("pixel_id, enabled")
    .eq("store_id", storeId)
    .maybeSingle();
  if (!data || !data.enabled || !data.pixel_id) return { pixelId: null, enabled: false };
  return { pixelId: data.pixel_id, enabled: true };
}

/** Config completa (com token decifrado) — uso exclusivo do servidor. */
export async function getMetaSettingsWithToken(
  storeId: string,
): Promise<MetaSettingsWithToken | null> {
  const { data } = await supabaseAdmin
    .from("meta_tracking_settings")
    .select("store_id, pixel_id, enabled, test_event_code, access_token_ciphertext")
    .eq("store_id", storeId)
    .maybeSingle();
  if (!data?.enabled || !data.pixel_id || !data.access_token_ciphertext) return null;
  let accessToken: string;
  try {
    accessToken = await decryptSecret(data.access_token_ciphertext);
  } catch {
    return null;
  }
  return {
    storeId: data.store_id,
    pixelId: data.pixel_id,
    enabled: true,
    testEventCode: data.test_event_code,
    hasAccessToken: true,
    accessToken,
  };
}

export async function recordMetaHealth(
  storeId: string,
  result: { ok: boolean; error?: string | null },
): Promise<void> {
  const patch = result.ok
    ? { last_success_at: new Date().toISOString(), last_error: null, last_error_at: null }
    : { last_error: (result.error ?? "erro desconhecido").slice(0, 500), last_error_at: new Date().toISOString() };
  await supabaseAdmin.from("meta_tracking_settings").update(patch).eq("store_id", storeId);
}

/** Painel: nunca devolve o token, apenas os 4 últimos caracteres. */
export async function listMetaSettings(): Promise<MetaSettingsSummary[]> {
  const { data: stores } = await supabaseAdmin
    .from("stores")
    .select("id, name, slug")
    .order("name");
  const { data: settings } = await supabaseAdmin.from("meta_tracking_settings").select("*");
  const { data: events } = await supabaseAdmin
    .from("meta_conversion_events")
    .select("store_id, status, created_at")
    .eq("status", "SENT")
    .order("created_at", { ascending: false })
    .limit(1000);

  return (stores ?? []).map((store) => {
    const row = (settings ?? []).find((entry) => entry.store_id === store.id);
    const sent = (events ?? []).filter((entry) => entry.store_id === store.id);
    const configured = Boolean(row?.pixel_id && row?.access_token_ciphertext);
    const status: MetaSettingsSummary["status"] = !row || !row.enabled
      ? configured
        ? "DISABLED"
        : "NOT_CONFIGURED"
      : !configured
        ? "NOT_CONFIGURED"
        : row.last_error && (!row.last_success_at || (row.last_error_at ?? "") > row.last_success_at)
          ? "ERROR"
          : row.last_success_at
            ? "CONNECTED"
            : "CONFIGURED";

    return {
      storeId: store.id,
      storeName: store.name,
      storeSlug: store.slug,
      pixelId: row?.pixel_id ?? null,
      enabled: row?.enabled ?? false,
      testEventCode: row?.test_event_code ?? null,
      hasAccessToken: Boolean(row?.access_token_ciphertext),
      accessTokenLast4: row?.access_token_last4 ?? null,
      lastSuccessAt: row?.last_success_at ?? null,
      lastError: row?.last_error ?? null,
      lastErrorAt: row?.last_error_at ?? null,
      status,
      eventCount: sent.length,
      lastPurchaseAt: sent[0]?.created_at ?? null,
    };
  });
}

export async function saveMetaSettings(input: {
  storeId: string;
  pixelId: string | null;
  accessToken?: string | undefined;
  testEventCode: string | null;
  enabled: boolean;
}): Promise<void> {
  const patch: Record<string, unknown> = {
    store_id: input.storeId,
    pixel_id: input.pixelId,
    test_event_code: input.testEventCode,
    enabled: input.enabled,
  };
  if (input.accessToken) {
    patch["access_token_ciphertext"] = await encryptSecret(input.accessToken);
    patch["access_token_last4"] = input.accessToken.slice(-4);
    patch["last_error"] = null;
    patch["last_error_at"] = null;
  }
  await supabaseAdmin
    .from("meta_tracking_settings")
    .upsert(patch as never, { onConflict: "store_id" });
}
