import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/v1/donations")({
  server: {
    handlers: {
      OPTIONS: async () => (await import("@/lib/payments/http.server")).preflight(),
      POST: async ({ request }) => {
        const { withStore, parseBody } = await import("@/lib/payments/http.server");
        return withStore(request, { bucket: "donation-create", limit: 30, windowSeconds: 60 }, async (store) => {
          const { createDonationSchema } = await import("@/lib/donations/rules");
          const body = await parseBody(request, createDonationSchema);
          const { createDonation } = await import("@/lib/donations/service.server");
          return createDonation({ store, body, origin: new URL(request.url).origin });
        });
      },
    },
  },
});
