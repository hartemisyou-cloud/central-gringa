import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/admin_/health-checkout")({
  server: { handlers: {
    GET: async ({ request }) => {
      const { checkoutHealthResponse } = await import("@/lib/payments/checkout-health.server");
      return checkoutHealthResponse(new URL(request.url).origin);
    },
  } },
});
