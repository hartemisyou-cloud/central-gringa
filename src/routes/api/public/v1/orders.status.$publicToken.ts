import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/v1/orders/status/$publicToken")({
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
          { bucket: "order-status", limit: 120, windowSeconds: 60 },
          async (store) => {
            const { getOrderPublicStatus } = await import("@/lib/payments/orders.server");
            const result = await getOrderPublicStatus({ store, publicToken: params.publicToken });
            const origin = new URL(request.url).origin;
            return {
              ...result,
              /** Central-hosted receipt; ebook downloads appear there once PAID. */
              receiptUrl: `${origin}/order/${params.publicToken}`,
              downloadsAvailable: result.order.status === "PAID",
            };
          },
        );
      },
    },
  },
});
