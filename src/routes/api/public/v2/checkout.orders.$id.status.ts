import { createFileRoute } from "@tanstack/react-router";

/** Checkout V2 — status do pedido pelo publicToken. Lê apenas o banco da Central. */
export const Route = createFileRoute("/api/public/v2/checkout/orders/$id/status")({
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
          { bucket: "v2-order-status", limit: 120, windowSeconds: 60 },
          async (store) => {
            const { getCheckoutV2Status } = await import("@/lib/payments/v2.server");
            return getCheckoutV2Status({ store, publicToken: params.id });
          },
        );
      },
    },
  },
});
