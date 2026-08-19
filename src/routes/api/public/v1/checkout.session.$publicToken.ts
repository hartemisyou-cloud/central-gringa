import { createFileRoute } from "@tanstack/react-router";

/**
 * Sessão de checkout hospedado para lojas que renderizam a própria página
 * de pagamento (estilo Stripe) no domínio delas, usando a API central.
 * Retorna o client_secret do PaymentIntent do pedido + chave publicável.
 */
export const Route = createFileRoute("/api/public/v1/checkout/session/$publicToken")({
  server: {
    handlers: {
      OPTIONS: async () => {
        const { preflight } = await import("@/lib/payments/http.server");
        return preflight();
      },
      GET: async ({ request, params }) => {
        const { withStore } = await import("@/lib/payments/http.server");
        return withStore(
          request,
          { bucket: "checkout-session", limit: 60, windowSeconds: 60 },
          async (store) => {
            const { getHostedPaymentSession } = await import("@/lib/payments/hosted.server");
            return getHostedPaymentSession(params.publicToken, { storeId: store.id });
          },
        );
      },
    },
  },
});
