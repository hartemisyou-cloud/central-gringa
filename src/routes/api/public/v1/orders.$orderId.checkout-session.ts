import { createFileRoute } from "@tanstack/react-router";

/**
 * Cria (ou reaproveita) uma Stripe Checkout Session em ui_mode "custom"
 * para um pedido já existente da loja autenticada.
 * A Secret Key da Stripe nunca sai da Central.
 */
export const Route = createFileRoute("/api/public/v1/orders/$orderId/checkout-session")({
  server: {
    handlers: {
      OPTIONS: async () => {
        const { preflight } = await import("@/lib/payments/http.server");
        return preflight();
      },
      POST: async ({ request, params }) => {
        const { withStore, parseBody } = await import("@/lib/payments/http.server");
        return withStore(
          request,
          { bucket: "checkout-session-create", limit: 20, windowSeconds: 60 },
          async (store) => {
            const { z } = await import("zod");
            const schema = z
              .object({
                returnUrl: z.string().trim().max(1000).optional(),
                customerEmail: z.string().trim().email().max(160).optional(),
                metadata: z.record(z.string(), z.string().max(500)).optional(),
              })
              .strip();

            const hasBody = (request.headers.get("content-length") ?? "0") !== "0";
            const body = hasBody
              ? await parseBody(request, schema).catch(() => ({}) as z.infer<typeof schema>)
              : ({} as z.infer<typeof schema>);

            const { createOrderCheckoutSession } = await import(
              "@/lib/payments/checkout-session.server"
            );
            return createOrderCheckoutSession({
              store,
              orderId: params.orderId,
              returnUrl: body.returnUrl,
              customerEmail: body.customerEmail,
              metadata: body.metadata,
            });
          },
        );
      },
    },
  },
});
