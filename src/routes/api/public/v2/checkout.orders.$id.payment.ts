import { createFileRoute } from "@tanstack/react-router";

/**
 * Checkout V2 — pagamento do pedido.
 * Reutiliza integralmente o serviço interno `createOrderPayment` (mesma Stripe,
 * mesma idempotência, mesmo metadata operacional, mesmo webhook). A única
 * diferença é a descrição do PaymentIntent: sempre `Pedido {orderNumber}`.
 */
export const Route = createFileRoute("/api/public/v2/checkout/orders/$id/payment")({
  server: {
    handlers: {
      OPTIONS: async () => {
        const { preflight } = await import("@/lib/payments/http.server");
        return preflight();
      },
      POST: async ({ request, params }) => {
        const { withStore } = await import("@/lib/payments/http.server");
        return withStore(
          request,
          { bucket: "v2-payment", limit: 20, windowSeconds: 60 },
          async (store) => {
            const { createOrderPayment } = await import("@/lib/payments/orders.server");
            return createOrderPayment({
              store,
              orderId: params.id,
              descriptionMode: "order-number",
            });
          },
        );
      },
    },
  },
});
