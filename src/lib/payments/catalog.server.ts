import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { PaymentError } from "./errors";
import type { StoreRow } from "./store-auth.server";

export interface PublicProduct {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  sku: string;
  priceCents: number;
  currency: string;
  available: number;
  imageUrl: string | null;
  category: string | null;
}

/** Catálogo público da loja: apenas colunas seguras, sempre isolado por store_id. */
export async function listStoreProducts(store: StoreRow): Promise<PublicProduct[]> {
  const { data, error } = await supabaseAdmin
    .from("products")
    .select(
      "id, name, slug, description, sku, price_cents, currency, stock, reserved_stock, image_url, category",
    )
    .eq("store_id", store.id)
    .eq("active", true)
    .order("name", { ascending: true });

  if (error) throw new PaymentError("INVALID_INPUT", "Falha ao carregar o catálogo.");

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    sku: row.sku,
    priceCents: row.price_cents,
    currency: row.currency,
    available: Math.max(row.stock - row.reserved_stock, 0),
    imageUrl: row.image_url,
    category: row.category,
  }));
}
