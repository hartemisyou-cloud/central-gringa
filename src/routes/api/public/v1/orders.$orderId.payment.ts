import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/v1/orders/$orderId/payment")({
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
          { bucket: "payment", limit: 20, windowSeconds: 60 },
          async (store) => {
            const { createOrderPayment } = await import("@/lib/payments/orders.server");
            return createOrderPayment({ store, orderId: params.orderId });
          },
        );
      },
    },
  },
});
