import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/v1/donations/status/$publicToken")({
  server: {
    handlers: {
      OPTIONS: async () => (await import("@/lib/payments/http.server")).preflight(),
      GET: async ({ request, params }) => {
        const { withStore } = await import("@/lib/payments/http.server");
        return withStore(request, { bucket: "donation-status", limit: 120, windowSeconds: 60 }, async (store) => {
          const { getDonationStatus } = await import("@/lib/donations/service.server");
          return getDonationStatus(store, params.publicToken, new URL(request.url).origin);
        });
      },
    },
  },
});
