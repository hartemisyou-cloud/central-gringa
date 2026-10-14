import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { decryptSecret, encryptSecret } from "@/lib/payments/crypto.server";

/**
 * Configuração UTMify por loja (multi-tenant, isolada por store_id).
 *
 * O API Token existe SOMENTE no servidor, cifrado em repouso (AES-256-GCM,
 * mesmo cofre das credenciais Stripe/Meta). Nunca é retornado ao navegador,
 * nunca vai ao HTML/localStorage e nunca aparece em log.
 * O Webhook ID NÃO é segredo — é configuração normal (identifica o webhook
 * Stripe → UTMify já existente, que permanece intocado).
 */

export interface UtmifySettingsWithToken {
  storeId: string;
  webhookId: string | null;
  isTest: boolean;
  apiToken: string;
}

export interface UtmifySettingsSummary {
  storeId: string;
  storeName: string;
  storeSlug: string;
  webhookId: string | null;
  enabled: boolean;
  isTest: boolean;
  hasApiToken: boolean;
  /** Estado das VENDAS — derivado exclusivamente de utmify_events. */
  status: "DISABLED" | "NOT_CONFIGURED" | "CONFIGURED" | "CONNECTED" | "ERROR";
  lastSuccessAt: string | null;
  lastOrderNumber: string | null;
  /** Último erro de VENDA (utmify_events), nunca o teste de conexão. */
  lastError: string | null;
  lastErrorAt: string | null;
  sentCount: number;
  lastSentAt: string | null;
  /** Estado isolado do botão "Testar conexão" (utmify_settings). */
  connectionStatus: "UNKNOWN" | "OK" | "ERROR";
  connectionError: string | null;
  connectionErrorAt: string | null;
  connectionSuccessAt: string | null;
}


/** Config completa (token decifrado) — uso exclusivo do servidor. */
export async function getUtmifySettingsWithToken(
  storeId: string,
): Promise<UtmifySettingsWithToken | null> {
  const { data } = await supabaseAdmin
    .from("utmify_settings")
    .select("store_id, webhook_id, enabled, is_test, api_token_ciphertext")
    .eq("store_id", storeId)
    .maybeSingle();
  if (!data?.enabled || !data.api_token_ciphertext) return null;
  let apiToken: string;
  try {
    apiToken = await decryptSecret(data.api_token_ciphertext);
  } catch {
    return null;
  }
  return {
    storeId: data.store_id,
    webhookId: data.webhook_id,
    isTest: data.is_test,
    apiToken,
  };
}

export async function recordUtmifyHealth(
  storeId: string,
  result: { ok: boolean; error?: string | null; orderNumber?: string | null },
): Promise<void> {
  const patch: Record<string, unknown> = result.ok
    ? { last_success_at: new Date().toISOString(), last_error: null, last_error_at: null }
    : {
        last_error: (result.error ?? "unknown error").slice(0, 500),
        last_error_at: new Date().toISOString(),
      };
  if (result.ok && result.orderNumber) patch["last_order_number"] = result.orderNumber;
  await supabaseAdmin.from("utmify_settings").update(patch as never).eq("store_id", storeId);
}

/**
 * Painel: nunca devolve o token — apenas "configurado" e os 4 últimos caracteres.
 * O estado das VENDAS vem exclusivamente de `utmify_events`; o resultado do botão
 * "Testar conexão" (`utmify_settings.last_error/last_success_at`) fica isolado e
 * NUNCA marca o painel de vendas como erro. Leitura pura — não envia nada.
 */
export async function listUtmifySettings(): Promise<UtmifySettingsSummary[]> {
  const { data: stores } = await supabaseAdmin.from("stores").select("id, name, slug").order("name");
  const { data: settings } = await supabaseAdmin.from("utmify_settings").select("*");
  const { data: events } = await supabaseAdmin
    .from("utmify_events")
    .select("store_id, status, order_number, last_error, created_at, updated_at")
    .order("updated_at", { ascending: false })
    .limit(1000);

  return (stores ?? []).map((store) => {
    const row = (settings ?? []).find((entry) => entry.store_id === store.id);
    const storeEvents = (events ?? []).filter((entry) => entry.store_id === store.id);
    const sent = storeEvents.filter((entry) => entry.status === "SENT");
    const failed = storeEvents.filter(
      (entry) => entry.status !== "SENT" && Boolean(entry.last_error),
    );
    const lastSent = sent[0];
    const lastFailed = failed[0];
    const configured = Boolean(row?.api_token_ciphertext);

    const status: UtmifySettingsSummary["status"] = !row || !row.enabled
      ? configured
        ? "DISABLED"
        : "NOT_CONFIGURED"
      : !configured
        ? "NOT_CONFIGURED"
        : lastFailed && (!lastSent || (lastFailed.updated_at ?? "") > (lastSent.updated_at ?? ""))
          ? "ERROR"
          : lastSent
            ? "CONNECTED"
            : "CONFIGURED";

    const connectionStatus: UtmifySettingsSummary["connectionStatus"] = !row
      ? "UNKNOWN"
      : row.last_error && (!row.last_success_at || (row.last_error_at ?? "") > row.last_success_at)
        ? "ERROR"
        : row.last_success_at
          ? "OK"
          : "UNKNOWN";

    return {
      storeId: store.id,
      storeName: store.name,
      storeSlug: store.slug,
      webhookId: row?.webhook_id ?? null,
      enabled: row?.enabled ?? false,
      isTest: row?.is_test ?? false,
      hasApiToken: configured,
      status,
      lastSuccessAt: lastSent?.updated_at ?? null,
      lastOrderNumber: lastSent?.order_number ?? row?.last_order_number ?? null,
      lastError: lastFailed?.last_error ?? null,
      lastErrorAt: lastFailed?.updated_at ?? null,
      sentCount: sent.length,
      lastSentAt: lastSent?.updated_at ?? null,
      connectionStatus,
      connectionError: row?.last_error ?? null,
      connectionErrorAt: row?.last_error_at ?? null,
      connectionSuccessAt: row?.last_success_at ?? null,
    };
  });
}


export async function saveUtmifySettings(input: {
  storeId: string;
  webhookId: string | null;
  apiToken?: string | undefined;
  enabled: boolean;
  isTest: boolean;
}): Promise<void> {
  const patch: Record<string, unknown> = {
    store_id: input.storeId,
    webhook_id: input.webhookId,
    enabled: input.enabled,
    is_test: input.isTest,
  };
  if (input.apiToken) {
    patch["api_token_ciphertext"] = await encryptSecret(input.apiToken);
    patch["api_token_last4"] = input.apiToken.slice(-4);
    patch["last_error"] = null;
    patch["last_error_at"] = null;
  }
  await supabaseAdmin.from("utmify_settings").upsert(patch as never, { onConflict: "store_id" });
}
