import { createFileRoute } from "@tanstack/react-router";

/**
 * Cria o PaymentIntent do pedido no instante em que o cliente confirma o
 * pagamento na loja. A sessão de checkout não cria mais a cobrança, então a
 * Stripe só recebe pagamentos aprovados ou recusados.
 */
export const Route = createFileRoute("/api/public/v1/checkout/intent/$publicToken")({
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
          { bucket: "checkout-intent", limit: 30, windowSeconds: 60 },
          async (store) => {
            const { startHostedPayment } = await import("@/lib/payments/hosted.server");
            return startHostedPayment(params.publicToken, { storeId: store.id });
          },
        );
      },
    },
  },
});
