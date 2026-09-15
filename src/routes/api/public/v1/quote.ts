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
        const { withStore, parseBody, itemsSchema, isNoShippingRequest } = await import(
          "@/lib/payments/http.server"
        );
        return withStore(
          request,
          { bucket: "quote", limit: 60, windowSeconds: 60 },
          async (store) => {
            const body = await parseBody(
              request,
              z.object({
                items: itemsSchema,
                postalCode: z.string().trim().min(3).max(16).optional(),
              }),
            );
            const { quoteCart } = await import("@/lib/payments/orders.server");
            return quoteCart({
              store,
              items: body.items,
              noShipping: isNoShippingRequest(request, store),
              ...(body.postalCode ? { postalCode: body.postalCode } : {}),
            });
          },
        );
      },
    },
  },
});
