import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { PaymentError } from "@/lib/payments/errors";
import { encryptSecret, decryptSecret, generateStoreApiKey, sha256Hex } from "@/lib/payments/crypto.server";
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
  keyId: string;
  keyPrefix: string;
  scopes: string[];
  canReveal: boolean;
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
    .select(
      "id, store_id, label, key_id, key_prefix, encrypted_key, status, last_used_at, revoked_at, created_at, stores(name)",
    )
    .order("created_at", { ascending: false });
  if (error) throw new PaymentError("CONFIG_ERROR", "Não foi possível carregar as credenciais.");

  const { data: scopeRows } = await supabaseAdmin
    .from("store_api_key_scopes")
    .select("api_key_id, stores(slug)");

  const scopesByKey = new Map<string, string[]>();
  for (const row of scopeRows ?? []) {
    const slug = (row as { stores?: { slug?: string } | null }).stores?.slug;
    if (!slug) continue;
    const list = scopesByKey.get(row.api_key_id) ?? [];
    list.push(slug);
    scopesByKey.set(row.api_key_id, list);
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    storeId: row.store_id,
    storeName: (row as { stores?: { name?: string } | null }).stores?.name ?? "—",
    label: row.label,
    keyId: row.key_id,
    keyPrefix: row.key_prefix,
    scopes: (scopesByKey.get(row.id) ?? []).sort(),
    canReveal: Boolean((row as { encrypted_key?: string | null }).encrypted_key),
    status: row.status,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
  }));
}

/**
 * Rotaciona uma credencial: cria uma nova chave para a mesma loja, replicando
 * label e escopos, e revoga a anterior. O valor completo só existe na resposta.
 */
export async function rotateApiKey(keyId: string): Promise<{ fullKey: string; keyPrefix: string }> {
  const { data: current } = await supabaseAdmin
    .from("store_api_keys")
    .select("id, store_id, label, status, stores(environment, name)")
    .eq("id", keyId)
    .maybeSingle();
  if (!current) throw new PaymentError("NOT_FOUND", "Credencial não encontrada.");

  const environment =
    (current as { stores?: { environment?: "test" | "live" } | null }).stores?.environment ?? "live";

  const generated = generateStoreApiKey(environment);
  const keyHash = await sha256Hex(generated.fullKey);

  const { data: inserted, error } = await supabaseAdmin
    .from("store_api_keys")
    .insert({
      store_id: current.store_id,
      label: current.label,
      key_id: generated.keyId,
      key_prefix: generated.prefix,
      key_hash: keyHash,
      encrypted_key: await encryptSecret(generated.fullKey),
      status: "ACTIVE",
    })
    .select("id")
    .single();
  if (error || !inserted) {
    throw new PaymentError("CONFIG_ERROR", "Não foi possível rotacionar a credencial.");
  }

  const { data: scopeRows } = await supabaseAdmin
    .from("store_api_key_scopes")
    .select("store_id")
    .eq("api_key_id", current.id);

  if (scopeRows?.length) {
    await supabaseAdmin.from("store_api_key_scopes").insert(
      scopeRows.map((row) => ({ api_key_id: inserted.id, store_id: row.store_id })),
    );
  }

  await revokeApiKey(current.id);

  await recordAudit({
    actorEmail: "admin-panel",
    action: "api_key.rotated",
    resourceType: "store_api_key",
    resourceId: generated.keyId,
    metadata: { replaced: current.id, label: current.label },
  });

  return { fullKey: generated.fullKey, keyPrefix: generated.prefix };
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
    encrypted_key: await encryptSecret(generated.fullKey),
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

/**
 * Revela o valor completo de uma credencial, quando ela foi criada já com
 * armazenamento cifrado. Chaves antigas (somente hash) não podem ser reveladas.
 */
export async function revealApiKey(keyId: string): Promise<{ fullKey: string }> {
  const { data } = await supabaseAdmin
    .from("store_api_keys")
    .select("id, key_id, encrypted_key")
    .eq("id", keyId)
    .maybeSingle();
  if (!data) throw new PaymentError("NOT_FOUND", "Credencial não encontrada.");
  const encrypted = (data as { encrypted_key?: string | null }).encrypted_key;
  if (!encrypted) {
    throw new PaymentError(
      "NOT_FOUND",
      "Esta credencial foi criada antes do armazenamento cifrado. Rotacione para obter um valor visível.",
    );
  }

  const fullKey = await decryptSecret(encrypted);

  await recordAudit({
    actorEmail: "admin-panel",
    action: "api_key.revealed",
    resourceType: "store_api_key",
    resourceId: data.key_id,
    metadata: {},
  });

  return { fullKey };
}
