import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getPublicMetaConfig } from "./config.server";

/**
 * Dados públicos de rastreamento de um pedido, resolvidos pelo public_token
 * (aleatório e não enumerável). Contém somente o que o navegador precisa:
 * pixel público, valor e moeda REAIS do pedido e o order_id (event_id).
 * Nunca expõe token da Meta, chave Stripe, client_secret ou dados do cliente.
 */
export interface OrderTracking {
  paid: boolean;
  orderId: string;
  orderNumber: string;
  value: number;
  currency: string;
  pixelId: string | null;
  contents: Array<{ id: string; quantity: number; item_price: number }>;
}

export async function getOrderTracking(publicToken: string): Promise<OrderTracking | null> {
  const { data: order } = await supabaseAdmin
    .from("orders")
    .select("id, store_id, order_number, status, total_cents, currency, order_items(product_id, quantity, total_cents)")
    .eq("public_token", publicToken)
    .maybeSingle();
  if (!order) return null;

  const { pixelId } = await getPublicMetaConfig(order.store_id);

  return {
    // Purchase no navegador só é permitido com pagamento realmente confirmado.
    paid: order.status === "PAID",
    orderId: order.id,
    orderNumber: order.order_number,
    value: Number((order.total_cents / 100).toFixed(2)),
    currency: order.currency.toUpperCase(),
    pixelId,
    contents: (order.order_items ?? []).map((item) => ({
      id: item.product_id,
      quantity: item.quantity,
      item_price: Number((item.total_cents / item.quantity / 100).toFixed(2)),
    })),
  };
}
