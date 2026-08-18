import { createServerFn } from "@tanstack/react-start";
import { callCentralApi } from "./storefront-api.server";
import {
  storefrontCheckoutSchema,
  storefrontQuoteSchema,
  storefrontTokenSchema,
} from "./storefront-schemas";

/**
 * BFF da Loja 1.
 *
 * O navegador NUNCA fala com a API central e NUNCA vê a credencial da loja.
 * Estas server functions rodam no servidor, anexam `x-store-api-key`
 * (segredo `STORE1_API_KEY`) e repassam apenas dados seguros ao cliente.
 */

export interface StorefrontProduct {
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

export const getStorefrontProducts = createServerFn({ method: "GET" }).handler(async () => {
  const data = await callCentralApi<{ products: StorefrontProduct[] }>("/products");
  return data.products;
});

export interface ShippingOptionDTO {
  id: string;
  label: string;
  amountCents: number;
  estimatedDays: number;
  provider: string;
}

export interface QuoteDTO {
  currency: string;
  subtotalCents: number;
  shippingCents: number;
  discountCents: number;
  totalCents: number;
  shippingOptions: ShippingOptionDTO[];
}

export const quoteStorefrontCart = createServerFn({ method: "POST" })
  .inputValidator((input: { items: unknown; postalCode?: string }) =>
    storefrontQuoteSchema.parse(input),
  )
  .handler(async ({ data }) =>
    callCentralApi<QuoteDTO>("/quote", { method: "POST", body: data }),
  );

export interface CheckoutDTO {
  orderId: string;
  orderNumber: string;
  publicToken: string;
  clientSecret: string;
  publishableKey: string;
  amountCents: number;
  currency: string;
}

/** Cria o pedido (com reserva de estoque) e já inicia o pagamento. */
export const startStorefrontCheckout = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => storefrontCheckoutSchema.parse(input))
  .handler(async ({ data }): Promise<CheckoutDTO> => {
    const order = await callCentralApi<{
      orderId: string;
      orderNumber: string;
      publicToken: string;
      totals: { currency: string; totalCents: number };
    }>("/orders", { method: "POST", body: data });

    const payment = await callCentralApi<{
      clientSecret: string;
      publishableKey: string;
      amountCents: number;
      currency: string;
    }>(`/orders/${order.orderId}/payment`, { method: "POST" });

    return {
      orderId: order.orderId,
      orderNumber: order.orderNumber,
      publicToken: order.publicToken,
      clientSecret: payment.clientSecret,
      publishableKey: payment.publishableKey,
      amountCents: payment.amountCents,
      currency: payment.currency,
    };
  });

export interface OrderStatusDTO {
  orderNumber: string;
  status: string;
  currency: string;
  totalCents: number;
  createdAt: string;
  items?: Array<{ name: string; quantity: number; totalCents: number }>;
}

interface CentralOrderStatus {
  order: {
    order_number: string;
    status: string;
    currency: string;
    total_cents: number;
    created_at: string;
    order_items?: Array<{ product_name: string; quantity: number; total_cents: number }> | null;
  };
  paymentStatus: string | null;
}

export const getStorefrontOrderStatus = createServerFn({ method: "GET" })
  .inputValidator((input: { publicToken: string }) =>
    storefrontTokenSchema.parse(input),
  )
  .handler(async ({ data }): Promise<OrderStatusDTO> => {
    const result = await callCentralApi<CentralOrderStatus>(
      `/orders/status/${encodeURIComponent(data.publicToken)}`,
    );
    return {
      orderNumber: result.order.order_number,
      status: result.order.status,
      currency: result.order.currency,
      totalCents: result.order.total_cents,
      createdAt: result.order.created_at,
      items: (result.order.order_items ?? []).map((item) => ({
        name: item.product_name,
        quantity: item.quantity,
        totalCents: item.total_cents,
      })),
    };
  });

