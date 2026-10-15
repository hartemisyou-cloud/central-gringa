import { sql, rows, one, exec } from "@/lib/db/client.server";
import type { Row } from "@/lib/db/types";
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

const HEALTH_COLUMNS = ["last_success_at", "last_error", "last_error_at"] as const;
const SETTINGS_COLUMNS = [
  "store_id",
  "pixel_id",
  "test_event_code",
  "enabled",
  "access_token_ciphertext",
  "access_token_last4",
  "last_error",
  "last_error_at",
] as const;

/** Config pública (apenas o Pixel ID) — segura para o navegador. */
export async function getPublicMetaConfig(
  storeId: string,
): Promise<{ pixelId: string | null; enabled: boolean }> {
  const { data } = await one<Row<"meta_tracking_settings">>(
    sql`SELECT pixel_id, enabled FROM meta_tracking_settings WHERE store_id = ${storeId}`,
    true,
  );
  if (!data || !data.enabled || !data.pixel_id) return { pixelId: null, enabled: false };
  return { pixelId: data.pixel_id, enabled: true };
}

/** Config completa (com token decifrado) — uso exclusivo do servidor. */
export async function getMetaSettingsWithToken(
  storeId: string,
): Promise<MetaSettingsWithToken | null> {
  const { data } = await one<Row<"meta_tracking_settings">>(
    sql`SELECT store_id, pixel_id, enabled, test_event_code, access_token_ciphertext FROM meta_tracking_settings WHERE store_id = ${storeId}`,
    true,
  );
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
    : {
        last_error: (result.error ?? "erro desconhecido").slice(0, 500),
        last_error_at: new Date().toISOString(),
      };
  const columns = HEALTH_COLUMNS.filter((column) => Object.hasOwn(patch, column));
  await exec(
    sql`UPDATE meta_tracking_settings SET ${sql(patch, ...columns)} WHERE store_id = ${storeId}`,
  );
}

/** Painel: nunca devolve o token, apenas os 4 últimos caracteres. */
export async function listMetaSettings(): Promise<MetaSettingsSummary[]> {
  const { data: stores } = await rows<Row<"stores">>(
    sql`SELECT id, name, slug FROM stores ORDER BY name ASC`,
  );
  const { data: settings } = await rows<Row<"meta_tracking_settings">>(
    sql`SELECT * FROM meta_tracking_settings`,
  );
  const { data: events } = await rows<Row<"meta_conversion_events">>(
    sql`SELECT store_id, status, created_at FROM meta_conversion_events WHERE status = ${"SENT"} ORDER BY created_at DESC LIMIT 1000`,
  );

  return (stores ?? []).map((store) => {
    const row = (settings ?? []).find((entry) => entry.store_id === store.id);
    const sent = (events ?? []).filter((entry) => entry.store_id === store.id);
    const configured = Boolean(row?.pixel_id && row?.access_token_ciphertext);
    const status: MetaSettingsSummary["status"] =
      !row || !row.enabled
        ? configured
          ? "DISABLED"
          : "NOT_CONFIGURED"
        : !configured
          ? "NOT_CONFIGURED"
          : row.last_error &&
              (!row.last_success_at || (row.last_error_at ?? "") > row.last_success_at)
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
  const columns = SETTINGS_COLUMNS.filter((column) => Object.hasOwn(patch, column));
  await exec(sql`INSERT INTO meta_tracking_settings ${sql(patch, ...columns)}
    ON CONFLICT (store_id) DO UPDATE SET ${sql(patch, ...columns)}`);
}
