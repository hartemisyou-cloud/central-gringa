import { supabaseAdmin } from "@/integrations/supabase/client.server";
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
  const { data: order } = await supabaseAdmin
    .from("orders")
    .select(
      "id, store_id, order_number, status, total_cents, currency, order_items(product_name, quantity)",
    )
    .eq("public_token", publicToken)
    .maybeSingle();
  if (!order) throw new PaymentError("NOT_FOUND", "Pedido não encontrado.");
  if (options?.storeId && order.store_id !== options.storeId) {
    throw new PaymentError("NOT_FOUND", "Pedido não encontrado.");
  }
  if (!["PENDING_PAYMENT", "PAYMENT_PROCESSING"].includes(order.status)) {
    throw new PaymentError("INVALID_STATE", "Este pedido não aceita novos pagamentos.");
  }

  const { data: store } = await supabaseAdmin
    .from("stores")
    .select("*")
    .eq("id", order.store_id)
    .maybeSingle();
  if (!store) throw new PaymentError("NOT_FOUND", "Loja não encontrada.");

  const payment = await createOrderPayment({ store: store as StoreRow, orderId: order.id });
  if (!payment.clientSecret) {
    throw new PaymentError("INVALID_STATE", "Não foi possível iniciar o pagamento.");
  }

  const items = order.order_items ?? [];
  const first = items[0];
  const label = first
    ? items.length > 1
      ? `${first.product_name} + ${items.length - 1} item(s)`
      : first.product_name
    : `Pedido ${order.order_number}`;

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
  };
}
