import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { PaymentError } from "@/lib/payments/errors";
import { generateStoreApiKey, sha256Hex } from "@/lib/payments/crypto.server";
import { recordAudit } from "@/lib/payments/audit.server";

export interface AdminStore {
  id: string;
  name: string;
  slug: string;
  environment: "test" | "live";
  status: string;
  activeKeys: number;
}

export interface AdminApiKey {
  id: string;
  storeId: string;
  storeName: string;
  label: string;
  keyPrefix: string;
  status: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export async function listStores(): Promise<AdminStore[]> {
  const { data: stores, error } = await supabaseAdmin
    .from("stores")
    .select("id, name, slug, environment, status")
    .order("created_at", { ascending: true });
  if (error) throw new PaymentError("CONFIG_ERROR", "Não foi possível carregar as lojas.");

  const { data: keys } = await supabaseAdmin
    .from("store_api_keys")
    .select("store_id, status");

  return (stores ?? []).map((store) => ({
    id: store.id,
    name: store.name,
    slug: store.slug,
    environment: store.environment,
    status: store.status,
    activeKeys: (keys ?? []).filter((k) => k.store_id === store.id && k.status === "ACTIVE").length,
  }));
}

export async function listApiKeys(): Promise<AdminApiKey[]> {
  const { data, error } = await supabaseAdmin
    .from("store_api_keys")
    .select("id, store_id, label, key_prefix, status, last_used_at, revoked_at, created_at, stores(name)")
    .order("created_at", { ascending: false });
  if (error) throw new PaymentError("CONFIG_ERROR", "Não foi possível carregar as credenciais.");

  return (data ?? []).map((row) => ({
    id: row.id,
    storeId: row.store_id,
    storeName: (row as { stores?: { name?: string } | null }).stores?.name ?? "—",
    label: row.label,
    keyPrefix: row.key_prefix,
    status: row.status,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
  }));
}

/**
 * Gera uma nova credencial. O valor completo só existe nesta resposta:
 * o banco guarda apenas o hash SHA-256.
 */
export async function createApiKey(input: { storeId: string; label: string }): Promise<{
  fullKey: string;
  keyPrefix: string;
}> {
  const { data: store } = await supabaseAdmin
    .from("stores")
    .select("id, name, environment")
    .eq("id", input.storeId)
    .maybeSingle();
  if (!store) throw new PaymentError("NOT_FOUND", "Loja não encontrada.");

  const generated = generateStoreApiKey(store.environment);
  const keyHash = await sha256Hex(generated.fullKey);

  const { error } = await supabaseAdmin.from("store_api_keys").insert({
    store_id: store.id,
    label: input.label.slice(0, 60) || "default",
    key_id: generated.keyId,
    key_prefix: generated.prefix,
    key_hash: keyHash,
    status: "ACTIVE",
  });
  if (error) throw new PaymentError("CONFIG_ERROR", "Não foi possível criar a credencial.");

  await recordAudit({
    actorEmail: "admin-panel",
    action: "api_key.created",
    resourceType: "store_api_key",
    resourceId: generated.keyId,
    metadata: { store: store.name, label: input.label },
  });

  return { fullKey: generated.fullKey, keyPrefix: generated.prefix };
}

export async function revokeApiKey(keyId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from("store_api_keys")
    .update({ status: "REVOKED", revoked_at: new Date().toISOString() })
    .eq("id", keyId);
  if (error) throw new PaymentError("CONFIG_ERROR", "Não foi possível revogar a credencial.");

  await recordAudit({
    actorEmail: "admin-panel",
    action: "api_key.revoked",
    resourceType: "store_api_key",
    resourceId: keyId,
    metadata: {},
  });
}
