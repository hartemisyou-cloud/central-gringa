import { createServerFn } from "@tanstack/react-start";

/**
 * Configuração pública de tracking da vitrine (BFF).
 * Devolve APENAS o Meta Pixel ID da loja configurada — o Access Token da CAPI
 * e o token da UTMify nunca saem do servidor.
 */
export const getStorefrontTracking = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ pixelId: string | null }> => {
    const { HHB_STORE_SLUG: slug } = await import("@/lib/catalog/hhb");
    const { sql, one } = await import("@/lib/db/client.server");

    const { data: store } = await one<{ id: string }>(
      sql`SELECT id FROM stores WHERE slug = ${slug}`,
      true,
    );
    if (!store) return { pixelId: null };

    const { getPublicMetaConfig } = await import("@/lib/meta/config.server");
    const config = await getPublicMetaConfig(store.id);
    return { pixelId: config.enabled ? config.pixelId : null };
  },
);
