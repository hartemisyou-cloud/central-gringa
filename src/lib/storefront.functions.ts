import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

/**
 * BFF da Loja 1.
 *
 * O navegador NUNCA fala com a API central e NUNCA vê a credencial da loja.
 * Estas server functions rodam no servidor, anexam `x-store-api-key`
 * (segredo `STORE1_API_KEY`) e repassam apenas dados seguros ao cliente.
 */

function apiBaseUrl(): string {
  const configured = process.env["PAYMENTS_API_BASE_URL"];
  if (configured) return configured.replace(/\/$/, "");
  return new URL(getRequest().url).origin;
}

async function callCentralApi<T>(
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const apiKey = process.env["STORE1_API_KEY"];
  if (!apiKey) throw new Error("Credencial da loja não configurada no servidor.");

  const response = await fetch(`${apiBaseUrl()}/api/public/v1${path}`, {
    method: init?.method ?? "GET",
    headers: {
      "content-type": "application/json",
      "x-store-api-key": apiKey,
    },
    ...(init?.body ? { body: JSON.stringify(init.body) } : {}),
  });

  const payload = (await response.json().catch(() => null)) as
    | { data?: T; error?: { code?: string; message?: string } }
    | null;

  if (!response.ok || !payload?.data) {
    throw new Error(payload?.error?.message ?? "Não foi possível concluir a operação.");
  }
  return payload.data;
}

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

const itemsSchema = z
  .array(z.object({ productId: z.string().uuid(), quantity: z.number().int().min(1).max(20) }))
  .min(1)
  .max(30);

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
    z
      .object({ items: itemsSchema, postalCode: z.string().trim().min(8).max(9).optional() })
      .parse(input),
  )
  .handler(async ({ data }) =>
    callCentralApi<QuoteDTO>("/quote", { method: "POST", body: data }),
  );

const checkoutSchema = z.object({
  items: itemsSchema,
  customer: z.object({
    firstName: z.string().trim().min(2).max(80),
    lastName: z.string().trim().min(1).max(80),
    email: z.string().trim().email().max(160),
    phone: z.string().trim().min(8).max(20),
  }),
  address: z.object({
    postalCode: z.string().trim().min(8).max(9),
    street: z.string().trim().min(2).max(160),
    number: z.string().trim().min(1).max(20),
    complement: z.string().trim().max(80).optional(),
    district: z.string().trim().min(2).max(80),
    city: z.string().trim().min(2).max(80),
    state: z.string().trim().length(2),
  }),
  shippingOptionId: z.string().trim().min(1).max(40),
});

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
  .inputValidator((input: unknown) => checkoutSchema.parse(input))
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
    z.object({ publicToken: z.string().trim().min(10).max(120) }).parse(input),
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

