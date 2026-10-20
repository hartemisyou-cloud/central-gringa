import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { attributionSchema } from "@/lib/payments/attribution";

/**
 * Server functions for the central's own Hope Human Books storefront.
 * They run server-side against the same order/pricing services the public
 * API uses. Prices always come from the database; the browser only sends
 * product ids and quantities.
 */

export interface CatalogProduct {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  sku: string;
  priceCents: number;
  currency: string;
  category: string | null;
  stock: number;
  weightGrams: number;
}

async function loadStore() {
  const { sql, one } = await import("@/lib/db/client.server");
  const { HHB_STORE_SLUG } = await import("@/lib/catalog/hhb");
  const { data: store } = await one<import("@/lib/payments/store-auth.server").StoreRow>(sql`
    select * from public.stores where slug = ${HHB_STORE_SLUG}
  `, true);
  if (!store) throw new Error("The store is not set up yet.");
  return store;
}

interface PublicProductRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  sku: string;
  price_cents: number;
  currency: string;
  category: string | null;
  stock: number;
  reserved_stock: number;
  weight_grams: number;
}

/**
 * Read-only storefront fallback for environments without DATABASE_URL
 * (e.g. the Lovable preview): the public catalog is served through the
 * backend's anonymous read-only policy on active products. Checkout and
 * every write path still require the PostgreSQL server connection.
 */
async function loadPublicCatalog(): Promise<CatalogProduct[]> {
  const base = import.meta.env["VITE_SUPABASE_URL"] as string | undefined;
  const key = import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"] as string | undefined;
  if (!base || !key) throw new Error("Public catalog is not configured.");
  const { HHB_STORE_SLUG } = await import("@/lib/catalog/hhb");
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  const storesRes = await fetch(
    `${base}/rest/v1/stores?select=id&slug=eq.${encodeURIComponent(HHB_STORE_SLUG)}&limit=1`,
    { headers },
  );
  if (!storesRes.ok) throw new Error(`Public catalog store lookup failed (${storesRes.status}).`);
  const stores = (await storesRes.json()) as { id: string }[];
  if (!stores[0]) throw new Error("The store is not set up yet.");
  const productsRes = await fetch(
    `${base}/rest/v1/products?select=id,name,slug,description,sku,price_cents,currency,category,stock,reserved_stock,weight_grams&store_id=eq.${stores[0].id}&active=eq.true`,
    { headers },
  );
  if (!productsRes.ok) throw new Error(`Public catalog read failed (${productsRes.status}).`);
  const rows = (await productsRes.json()) as PublicProductRow[];
  return rows
    .map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      description: p.description,
      sku: p.sku,
      priceCents: p.price_cents,
      currency: p.currency,
      category: p.category,
      stock: Math.max(p.stock - p.reserved_stock, 0),
      weightGrams: p.weight_grams,
    }))
    .sort((a, b) => a.priceCents - b.priceCents);
}

export const getCatalog = createServerFn({ method: "GET" }).handler(
  async (): Promise<CatalogProduct[]> => {
    try {
      const store = await loadStore();
      const { listStoreProducts } = await import("@/lib/payments/catalog.server");
      const products = await listStoreProducts(store);
      return products
        .map((p) => ({
          id: p.id,
          name: p.name,
          slug: p.slug,
          description: p.description,
          sku: p.sku,
          priceCents: p.priceCents,
          currency: p.currency,
          category: p.category,
          stock: p.available,
          weightGrams: p.weightGrams,
        }))
        .sort((a, b) => a.priceCents - b.priceCents);
    } catch {
      return loadPublicCatalog();
    }
  },
);

const orderSchema = z.object({
  items: z
    .array(z.object({ productId: z.string().uuid(), quantity: z.number().int().min(1).max(5) }))
    .min(1)
    .max(11),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: z.string().trim().email().max(160),
  attribution: attributionSchema,
});

export const createDigitalOrder = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => orderSchema.parse(input))
  .handler(async ({ data }): Promise<{ ok: true; publicToken: string } | { ok: false; message: string }> => {
    try {
      const store = await loadStore();
      const { createOrder } = await import("@/lib/payments/orders.server");
      const result = await createOrder({
        store,
        items: data.items,
        customer: { firstName: data.firstName, lastName: data.lastName, email: data.email },
        shippingOptionId: "no-shipping",
        attribution: data.attribution,
      });
      return { ok: true, publicToken: result.publicToken };
    } catch (error) {
      return { ok: false, message: (error as Error).message };
    }
  });

export interface Receipt {
  orderNumber: string;
  status: string;
  currency: string;
  totalCents: number;
  createdAt: string;
  /** Persisted HHF origin: optional return also requires ret=1 and PAID. */
  hhf: boolean;
  items: Array<{ name: string; quantity: number; totalCents: number }>;
  works: Array<{
    workId: string;
    title: string;
    author: string;
    firstPublished: string;
    sourceUrl: string;
    bytes: number;
    downloadPath: string;
  }>;
}

export const getReceipt = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => z.object({ token: z.string().min(10).max(120) }).parse(input))
  .handler(async ({ data }): Promise<{ ok: true; receipt: Receipt } | { ok: false; message: string }> => {
    try {
      const { loadReceipt } = await import("@/lib/payments/receipt.server");
      return { ok: true, receipt: await loadReceipt(data.token) };
    } catch (error) {
      return { ok: false, message: (error as Error).message };
    }
  });
