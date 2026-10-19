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

export const getCatalog = createServerFn({ method: "GET" }).handler(
  async (): Promise<CatalogProduct[]> => {
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
      }))
      .sort((a, b) => a.priceCents - b.priceCents);
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
  /** Persisted HHF origin: the receipt page renders a neutral confirmation. */
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
      const { sql, one } = await import("@/lib/db/client.server");
      const { data: order } = await one<{
        order_number: string; status: string; currency: string; total_cents: number; created_at: string;
        origin_hhf: boolean;
        order_items: Array<{ product_name: string; quantity: number; total_cents: number }>;
      }>(sql`
        select o.order_number, o.status, o.currency, o.total_cents, o.created_at, o.origin_hhf,
          coalesce((select jsonb_agg(jsonb_build_object('product_name', i.product_name, 'quantity', i.quantity,
            'total_cents', i.total_cents)) from public.order_items i where i.order_id = o.id), '[]'::jsonb) as order_items
        from public.orders o where o.public_token = ${data.token}
      `, true);
      if (!order) return { ok: false, message: "Order not found." };
      // HHF-originated orders never expose items or works to the browser: the
      // receipt page is a neutral support confirmation that returns the visitor
      // to the foundation. Delivery stays page-only for regular store orders.
      if (order.origin_hhf) {
        return {
          ok: true,
          receipt: {
            orderNumber: order.order_number,
            status: order.status,
            currency: order.currency,
            totalCents: order.total_cents,
            createdAt: order.created_at,
            hhf: true,
            items: [],
            works: [],
          },
        };
      }
      const { getOrderDeliverables } = await import("@/lib/payments/fulfillment.server");
      const deliverables = await getOrderDeliverables(data.token);
      return {
        ok: true,
        receipt: {
          orderNumber: order.order_number,
          status: order.status,
          currency: order.currency,
          totalCents: order.total_cents,
          createdAt: order.created_at,
          hhf: false,
          items: (order.order_items ?? []).map((i) => ({
            name: i.product_name,
            quantity: i.quantity,
            totalCents: i.total_cents,
          })),
          works: deliverables.works,
        },
      };
    } catch (error) {
      return { ok: false, message: (error as Error).message };
    }
  });
