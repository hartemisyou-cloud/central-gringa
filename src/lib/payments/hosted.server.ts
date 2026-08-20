import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { PaymentError } from "./errors";
import { createOrderPayment, integrationForStore } from "./orders.server";
import type { StoreRow } from "./store-auth.server";

export interface HostedPaymentCustomer {
  name: string;
  email: string;
  phone: string;
  address: {
    line1: string;
    line2: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  } | null;
}

export interface HostedPaymentItem {
  name: string;
  sku: string;
  quantity: number;
  totalCents: number;
}

export interface HostedPaymentSession {
  orderNumber: string;
  publicToken: string;
  /**
   * Sempre `null`: o PaymentIntent só é criado quando o cliente confirma o
   * pagamento, para que a Stripe receba apenas cobranças aprovadas ou
   * recusadas (nada de checkouts abandonados/incompletos).
   */
  clientSecret: null;
  publishableKey: string;
  amountCents: number;
  currency: string;
  label: string;
  subtitle: string | null;
  storeName: string;
  items: HostedPaymentItem[];
  customer: HostedPaymentCustomer;
}


/**
 * Sessão de pagamento hospedada, resolvida apenas pelo public_token do pedido
 * (token aleatório e não enumerável). NÃO cria PaymentIntent — apenas devolve
 * o contexto do pedido e a chave publicável para montar o checkout.
 */
export async function getHostedPaymentSession(
  publicToken: string,
  options?: { storeId?: string },
): Promise<HostedPaymentSession> {
  const { data: order } = await supabaseAdmin
    .from("orders")
    .select(
      "id, store_id, order_number, status, total_cents, currency, customer_id, shipping_address_id, order_items(product_name, sku, quantity, total_cents)",
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

  const integration = await integrationForStore(store as StoreRow);


  const [{ data: customerRow }, { data: addressRow }] = await Promise.all([
    order.customer_id
      ? supabaseAdmin
          .from("customers")
          .select("email, first_name, last_name, phone")
          .eq("id", order.customer_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    order.shipping_address_id
      ? supabaseAdmin
          .from("addresses")
          .select(
            "recipient_name, phone, street, number, complement, district, city, state, postal_code, country",
          )
          .eq("id", order.shipping_address_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const items = order.order_items ?? [];
  const first = items[0];
  const label = first
    ? items.length > 1
      ? `${first.product_name} (SKU ${first.sku}) + ${items.length - 1} item(s)`
      : `${first.product_name} (SKU ${first.sku})`
    : `Pedido ${order.order_number}`;

  const customerName = customerRow
    ? `${customerRow.first_name ?? ""} ${customerRow.last_name ?? ""}`.trim()
    : (addressRow?.recipient_name ?? "");

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
    items: items.map((item) => ({
      name: item.product_name,
      sku: item.sku,
      quantity: item.quantity,
      totalCents: item.total_cents,
    })),
    customer: {
      name: customerName,
      email: customerRow?.email ?? "",
      phone: customerRow?.phone ?? addressRow?.phone ?? "",
      address: addressRow
        ? {
            line1: `${addressRow.street}, ${addressRow.number}`.trim(),
            line2: addressRow.complement ?? "",
            city: addressRow.city,
            state: addressRow.state,
            postalCode: addressRow.postal_code,
            country: addressRow.country || "BR",
          }
        : null,
    },
  };
}

