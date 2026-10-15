import { sql, one } from "@/lib/db/client.server";
import { PaymentError } from "./errors";
import { createOrderPayment } from "./orders.server";
import type { StoreRow } from "./store-auth.server";

export interface HostedPaymentSession {
  orderNumber: string;
  publicToken: string;
  clientSecret: string;
  publishableKey: string;
  amountCents: number;
  currency: string;
  label: string;
  subtitle: string | null;
  storeName: string;
  /** Configuração pública do Meta Pixel (nunca inclui Access Token). */
  metaPixelId: string | null;
  /** Itens reais do pedido, usados nos eventos de navegador do Pixel. */
  items: Array<{ id: string; name: string; quantity: number; unitAmount: number }>;
}

/**
 * Sessão de pagamento hospedada, resolvida apenas pelo public_token do pedido
 * (token aleatório e não enumerável). Não expõe dados internos da Stripe além
 * do client_secret do PaymentIntent do próprio pedido.
 */
export async function getHostedPaymentSession(
  publicToken: string,
  options?: { storeId?: string },
): Promise<HostedPaymentSession> {
  const { data: order } = await one<{
    id: string; store_id: string; order_number: string; status: string; total_cents: number; currency: string;
    order_items: Array<{ product_id: string; product_name: string; quantity: number; total_cents: number }>;
  }>(sql`
    select o.id, o.store_id, o.order_number, o.status, o.total_cents, o.currency,
      coalesce((select jsonb_agg(jsonb_build_object('product_id', i.product_id, 'product_name', i.product_name,
        'quantity', i.quantity, 'total_cents', i.total_cents)) from public.order_items i where i.order_id = o.id), '[]'::jsonb) as order_items
    from public.orders o where o.public_token = ${publicToken}
  `, true);
  if (!order) throw new PaymentError("NOT_FOUND", "Order not found.");
  if (options?.storeId && order.store_id !== options.storeId) {
    throw new PaymentError("NOT_FOUND", "Order not found.");
  }
  if (!["PENDING_PAYMENT", "PAYMENT_PROCESSING"].includes(order.status)) {
    throw new PaymentError("INVALID_STATE", "This order no longer accepts payments.");
  }

  const { data: store } = await one<StoreRow>(sql`select * from public.stores where id = ${order.store_id}`, true);
  if (!store) throw new PaymentError("NOT_FOUND", "Store not found.");

  const payment = await createOrderPayment({ store: store as StoreRow, orderId: order.id });
  if (!payment.clientSecret) {
    throw new PaymentError("INVALID_STATE", "Could not start the payment.");
  }

  const items = order.order_items ?? [];
  const first = items[0];
  const label = first
    ? items.length > 1
      ? `${first.product_name} + ${items.length - 1} item(s)`
      : first.product_name
    : `Order ${order.order_number}`;

  const { getPublicMetaConfig } = await import("@/lib/meta/config.server");
  const meta = await getPublicMetaConfig(order.store_id).catch(() => ({ pixelId: null }));

  return {
    orderNumber: order.order_number,
    publicToken,
    clientSecret: payment.clientSecret,
    publishableKey: payment.publishableKey,
    amountCents: payment.amountCents,
    currency: payment.currency,
    label,
    subtitle: store.name ?? null,
    storeName: store.name ?? "",
    metaPixelId: meta.pixelId,
    items: items.map((item) => ({
      id: item.product_id,
      name: item.product_name,
      quantity: item.quantity,
      unitAmount: Number((item.total_cents / Math.max(item.quantity, 1) / 100).toFixed(2)),
    })),
  };
}
