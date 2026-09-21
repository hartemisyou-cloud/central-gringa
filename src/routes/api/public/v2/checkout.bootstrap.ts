import { createFileRoute } from "@tanstack/react-router";

/**
 * Checkout V2 — bootstrap READ-ONLY.
 * Mesma autenticação/rate limit/CORS dos endpoints /api/public/v1/*.
 */
export const Route = createFileRoute("/api/public/v2/checkout/bootstrap")({
  server: {
    handlers: {
      OPTIONS: async () => {
        const { preflight } = await import("@/lib/payments/http.server");
        return preflight();
      },
      GET: async ({ request }) => {
        const { withStore } = await import("@/lib/payments/http.server");
        return withStore(
          request,
          { bucket: "v2-bootstrap", limit: 120, windowSeconds: 60 },
          async (store) => {
            const { bootstrapCheckoutV2 } = await import("@/lib/payments/v2.server");
            const sku = new URL(request.url).searchParams.get("sku") ?? "";
            return bootstrapCheckoutV2({ store, sku });
          },
        );
      },
    },
  },
});
