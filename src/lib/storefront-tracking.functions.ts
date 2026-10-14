import { createServerFn } from "@tanstack/react-start";

/**
 * Configuração pública de tracking da vitrine (BFF).
 * Devolve APENAS o Meta Pixel ID da loja configurada — o Access Token da CAPI
 * e o token da UTMify nunca saem do servidor.
 */
export const getStorefrontTracking = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ pixelId: string | null }> => {
    const { HHB_STORE_SLUG: slug } = await import("@/lib/catalog/hhb");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: store } = await supabaseAdmin
      .from("stores")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();
    if (!store) return { pixelId: null };

    const { getPublicMetaConfig } = await import("@/lib/meta/config.server");
    const config = await getPublicMetaConfig(store.id);
    return { pixelId: config.enabled ? config.pixelId : null };
  },
);
