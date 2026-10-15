import { sql, one, exec, count } from "@/lib/db/client.server";
import type { Row } from "@/lib/db/types";
import { recordAudit } from "@/lib/payments/audit.server";
import { PaymentError } from "@/lib/payments/errors";

/**
 * Limpeza de analytics por loja.
 * Apaga SOMENTE tabelas de comportamento/presença + o gate de prune derivado.
 * Nunca toca em orders, payments, payment_events, webhook_events,
 * order_attribution, produtos, integrações Stripe, Meta CAPI ou UTMify.
 */

const ANALYTICS_TABLES = ["presence_sessions", "checkout_sessions", "analytics_events"] as const;

export type PurgePreview = {
  storeId: string;
  storeName: string;
  storeSlug: string;
  tables: { table: string; rows: number }[];
  total: number;
  preserved: string[];
};

async function loadStore(storeId: string) {
  const { data, error } = await one<Row<"stores">>(
    sql`SELECT id, name, slug FROM stores WHERE id = ${storeId}`,
    true,
  );
  if (error) throw new PaymentError("PROVIDER_ERROR", error.message);
  if (!data) throw new PaymentError("NOT_FOUND", "Store not found.");
  return data;
}

export async function previewAnalyticsPurge(storeId: string): Promise<PurgePreview> {
  const store = await loadStore(storeId);
  const counts = await Promise.all(
    ANALYTICS_TABLES.map(async (table) => {
      // Identifier is selected solely from the fixed ANALYTICS_TABLES allowlist.
      const { count: total, error } = await count(
        sql`SELECT COUNT(*) AS count FROM ${sql(table)} WHERE store_id = ${storeId}`,
      );
      if (error) throw new PaymentError("PROVIDER_ERROR", `${table}: ${error.message}`);
      return { table, rows: total ?? 0 };
    }),
  );
  return {
    storeId: store.id,
    storeName: store.name,
    storeSlug: store.slug,
    tables: [...counts, { table: "rate_limit_counters (gate presence_prune)", rows: 0 }],
    total: counts.reduce((sum, item) => sum + item.rows, 0),
    preserved: [
      "orders",
      "payments",
      "payment_events",
      "webhook_events",
      "order_attribution",
      "products",
      "stripe_integrations",
      "meta_conversion_events",
      "utmify_events",
    ],
  };
}

export async function purgeAnalytics(storeId: string) {
  const store = await loadStore(storeId);
  const before = await previewAnalyticsPurge(storeId);

  for (const table of ANALYTICS_TABLES) {
    const { error } = await exec(sql`DELETE FROM ${sql(table)} WHERE store_id = ${storeId}`);
    if (error) throw new PaymentError("PROVIDER_ERROR", `${table}: ${error.message}`);
  }

  // Cache derivado: janela do prune de presença, para os cards recalcularem já.
  await exec(sql`DELETE FROM rate_limit_counters WHERE bucket = ${"presence_prune"}`);

  const deleted = Object.fromEntries(before.tables.map((t) => [t.table, t.rows]));

  await recordAudit({
    action: "analytics.purge",
    resourceType: "store",
    resourceId: store.id,
    metadata: {
      store_slug: store.slug,
      store_name: store.name,
      deleted,
      purged_at: new Date().toISOString(),
    },
  });

  return { ok: true as const, storeSlug: store.slug, deleted, total: before.total };
}
