import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/comprar/$slug")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { handlePurchaseEntry, defaultPurchaseEntryDeps } = await import("@/lib/payments/purchase-entry.server");
        return handlePurchaseEntry(request, params.slug, await defaultPurchaseEntryDeps());
      },
    },
  },
});
