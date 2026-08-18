import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

export const Route = createFileRoute("/api/public/v1/quote")({
  server: {
    handlers: {
      OPTIONS: async () => {
        const { preflight } = await import("@/lib/payments/http.server");
        return preflight();
      },
      POST: async ({ request }) => {
        const { withStore, parseBody, itemsSchema } = await import("@/lib/payments/http.server");
        return withStore(
          request,
          { bucket: "quote", limit: 60, windowSeconds: 60 },
          async (store) => {
            const body = await parseBody(
              request,
              z.object({
                items: itemsSchema,
                postalCode: z.string().trim().min(8).max(9).optional(),
              }),
            );
            const { quoteCart } = await import("@/lib/payments/orders.server");
            return quoteCart({ store, items: body.items, ...(body.postalCode ? { postalCode: body.postalCode } : {}) });
          },
        );
      },
    },
  },
});
