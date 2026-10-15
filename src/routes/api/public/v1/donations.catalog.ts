import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/v1/donations/catalog")({
  server: {
    handlers: {
      OPTIONS: async () => (await import("@/lib/payments/http.server")).preflight(),
      GET: async ({ request }) => {
        const { withStore } = await import("@/lib/payments/http.server");
        return withStore(request, { bucket: "donation-catalog", limit: 120, windowSeconds: 60 }, async (store) => {
          const { getDonationCatalog } = await import("@/lib/donations/service.server");
          return getDonationCatalog(store);
        });
      },
    },
  },
});
