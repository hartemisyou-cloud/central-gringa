import { sql, rows } from "@/lib/db/client.server";
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
  weightGrams: number;
  imageUrl: string | null;
  category: string | null;
}

/** Catálogo público da loja: apenas colunas seguras, sempre isolado por store_id. */
export async function listStoreProducts(store: StoreRow): Promise<PublicProduct[]> {
  const { data, error } = await rows<import("@/lib/db/types").Database["public"]["Tables"]["products"]["Row"]>(sql`
    select id, name, slug, description, sku, price_cents, currency, stock,
           reserved_stock, weight_grams, image_url, category
    from public.products where store_id = ${store.id} and active = true order by name asc
  `);

  if (error) throw new PaymentError("INVALID_INPUT", "Failed to load the catalog.");

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    sku: row.sku,
    priceCents: row.price_cents,
    currency: row.currency,
    available: Math.max(row.stock - row.reserved_stock, 0),
    weightGrams: row.weight_grams,
    imageUrl: row.image_url,
    category: row.category,
  }));
}
