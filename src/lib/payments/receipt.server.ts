import { sql, one } from "@/lib/db/client.server";
import type { Receipt } from "@/lib/hhb-store.functions";
import { getOrderDeliverables } from "./fulfillment.server";
import { PaymentError } from "./errors";

/** Native receipts list items and works; theme B returns empty listings. PAID alone unlocks works. */
export async function loadReceipt(publicToken: string): Promise<Receipt> {
  const { data: order, error } = await one<{
    order_number: string; status: string; currency: string; total_cents: number; created_at: string;
    origin_hhf: boolean;
    order_items: Array<{ product_name: string; quantity: number; total_cents: number }>;
  }>(sql`
    select o.order_number, o.status, o.currency, o.total_cents, o.created_at, o.origin_hhf,
      coalesce((select jsonb_agg(jsonb_build_object('product_name', i.product_name, 'quantity', i.quantity,
        'total_cents', i.total_cents)) from public.order_items i where i.order_id = o.id), '[]'::jsonb) as order_items
    from public.orders o where o.public_token = ${publicToken}
  `, true);
  if (error) throw new PaymentError("CONFIG_ERROR", "Order temporarily unavailable.");
  if (!order) throw new PaymentError("NOT_FOUND", "Order not found.");
  if (order.origin_hhf) {
    return {
      orderNumber: order.order_number,
      status: order.status,
      currency: order.currency,
      totalCents: order.total_cents,
      createdAt: order.created_at,
      hhf: true,
      items: [],
      works: [],
    };
  }
  const deliverables = await getOrderDeliverables(publicToken);
  return {
    orderNumber: order.order_number,
    status: order.status,
    currency: order.currency,
    totalCents: order.total_cents,
    createdAt: order.created_at,
    hhf: order.origin_hhf,
    items: (order.order_items ?? []).map(item => ({
      name: item.product_name,
      quantity: item.quantity,
      totalCents: item.total_cents,
    })),
    works: deliverables.works,
  };
}
