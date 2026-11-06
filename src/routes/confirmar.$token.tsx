import { createFileRoute } from "@tanstack/react-router";

/**
 * Página leve de confirmação do fluxo de doação (cloaker). O success URL da
 * Stripe aponta para cá quando o pedido veio do site de doação: HTML mínimo,
 * sem bundle da loja, que confirma direto na Stripe e devolve o cliente à
 * página de obrigado do site de doação em um único instante. O receipt cheio
 * de /order segue existindo como fallback ("View your order").
 */
export const Route = createFileRoute("/confirmar/$token")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { renderConfirmationPage } = await import("@/lib/payments/confirmation-page.server");
        return renderConfirmationPage(params.token);
      },
    },
  },
});
