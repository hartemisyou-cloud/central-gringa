import { sql, one, rows, exec } from "@/lib/db/client.server";
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
  const { data: stores, error } = await rows<import("@/lib/db/types").Row<"stores">>(sql`
    select id, name, slug, environment, status from public.stores order by created_at asc
  `);
  if (error) throw new PaymentError("CONFIG_ERROR", "Could not load stores.");

  const { data: keys } = await rows<{ store_id: string; status: string }>(sql`select store_id, status from public.store_api_keys`);

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
  const { data, error } = await rows<import("@/lib/db/types").Row<"store_api_keys"> & { stores: { name: string } | null }>(sql`
    select k.id, k.store_id, k.label, k.key_id, k.key_prefix, k.encrypted_key, k.status,
      k.last_used_at, k.revoked_at, k.created_at,
      case when s.id is null then null else jsonb_build_object('name', s.name) end as stores
    from public.store_api_keys k left join public.stores s on s.id = k.store_id order by k.created_at desc
  `);
  if (error) throw new PaymentError("CONFIG_ERROR", "Could not load credentials.");

  const { data: scopeRows } = await rows<{ api_key_id: string; stores: { slug: string } | null }>(sql`
    select k.api_key_id, case when s.id is null then null else jsonb_build_object('slug', s.slug) end as stores
    from public.store_api_key_scopes k left join public.stores s on s.id = k.store_id
  `);

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
  const { data: current } = await one<import("@/lib/db/types").Row<"store_api_keys"> & { stores: { environment: "test" | "live"; name: string } | null }>(sql`
    select k.id, k.store_id, k.label, k.status,
      case when s.id is null then null else jsonb_build_object('environment', s.environment, 'name', s.name) end as stores
    from public.store_api_keys k left join public.stores s on s.id = k.store_id where k.id = ${keyId}
  `, true);
  if (!current) throw new PaymentError("NOT_FOUND", "Credential not found.");

  const environment =
    (current as { stores?: { environment?: "test" | "live" } | null }).stores?.environment ?? "live";

  const generated = generateStoreApiKey(environment);
  const keyHash = await sha256Hex(generated.fullKey);

  const encrypted = await encryptSecret(generated.fullKey);
  const { data: inserted, error } = await one<{ id: string }>(sql`
    insert into public.store_api_keys (store_id, label, key_id, key_prefix, key_hash, encrypted_key, status)
    values (${current.store_id}, ${current.label}, ${generated.keyId}, ${generated.prefix}, ${keyHash}, ${encrypted}, 'ACTIVE') returning id
  `);
  if (error || !inserted) {
    throw new PaymentError("CONFIG_ERROR", "Could not rotate credential.");
  }

  const { data: scopeRows } = await rows<{ store_id: string }>(sql`
    select store_id from public.store_api_key_scopes where api_key_id = ${current.id}
  `);

  if (scopeRows?.length) {
    const newScopes = scopeRows.map((row) => ({ api_key_id: inserted.id, store_id: row.store_id }));
    await exec(sql`insert into public.store_api_key_scopes ${sql(newScopes, "api_key_id", "store_id")}`);
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
  const { data: store } = await one<import("@/lib/db/types").Row<"stores">>(sql`
    select id, name, environment from public.stores where id = ${input.storeId}
  `, true);
  if (!store) throw new PaymentError("NOT_FOUND", "Store not found.");

  const generated = generateStoreApiKey(store.environment);
  const keyHash = await sha256Hex(generated.fullKey);

  const encrypted = await encryptSecret(generated.fullKey);
  const { error } = await exec(sql`
    insert into public.store_api_keys (store_id, label, key_id, key_prefix, key_hash, encrypted_key, status)
    values (${store.id}, ${input.label.slice(0, 60) || "default"}, ${generated.keyId}, ${generated.prefix}, ${keyHash}, ${encrypted}, 'ACTIVE')
  `);
  if (error) throw new PaymentError("CONFIG_ERROR", "Could not create credential.");

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
  const { error } = await exec(sql`
    update public.store_api_keys set status = 'REVOKED', revoked_at = ${new Date().toISOString()} where id = ${keyId}
  `);
  if (error) throw new PaymentError("CONFIG_ERROR", "Could not revoke credential.");

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
  const { data } = await one<import("@/lib/db/types").Row<"store_api_keys">>(sql`
    select id, key_id, encrypted_key from public.store_api_keys where id = ${keyId}
  `, true);
  if (!data) throw new PaymentError("NOT_FOUND", "Credential not found.");
  const encrypted = (data as { encrypted_key?: string | null }).encrypted_key;
  if (!encrypted) {
    throw new PaymentError(
      "NOT_FOUND",
      "This credential was created before encrypted storage. Rotate it to obtain a visible value.",
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
