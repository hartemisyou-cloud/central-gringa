import { supabaseAdmin } from "@/integrations/supabase/client.server";
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
  const { data, error } = await supabaseAdmin
    .from("stores")
    .select("id, name, slug")
    .eq("id", storeId)
    .maybeSingle();
  if (error) throw new PaymentError("INTERNAL_ERROR", error.message);
  if (!data) throw new PaymentError("NOT_FOUND", "Loja não encontrada.");
  return data;
}

export async function previewAnalyticsPurge(storeId: string): Promise<PurgePreview> {
  const store = await loadStore(storeId);
  const counts = await Promise.all(
    ANALYTICS_TABLES.map(async (table) => {
      const { count, error } = await supabaseAdmin
        .from(table)
        .select("*", { count: "exact", head: true })
        .eq("store_id", storeId);
      if (error) throw new PaymentError("INTERNAL_ERROR", `${table}: ${error.message}`);
      return { table, rows: count ?? 0 };
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
    const { error } = await supabaseAdmin.from(table).delete().eq("store_id", storeId);
    if (error) throw new PaymentError("INTERNAL_ERROR", `${table}: ${error.message}`);
  }

  // Cache derivado: janela do prune de presença, para os cards recalcularem já.
  await supabaseAdmin.from("rate_limit_counters").delete().eq("bucket", "presence_prune");

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
