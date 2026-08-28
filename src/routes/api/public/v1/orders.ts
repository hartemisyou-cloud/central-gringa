import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

export const Route = createFileRoute("/api/public/v1/orders")({
  server: {
    handlers: {
      OPTIONS: async () => {
        const { preflight } = await import("@/lib/payments/http.server");
        return preflight();
      },
      POST: async ({ request }) => {
        const {
          withStore,
          parseBody,
          itemsSchema,
          customerSchema,
          addressSchema,
          isNoShippingRequest,
        } = await import("@/lib/payments/http.server");
        return withStore(
          request,
          { bucket: "orders", limit: 20, windowSeconds: 60 },
          async (store) => {
            const {
              attributionWithContextSchema,
              splitAttributionPayload,
              appendAttributionToUrl,
            } = await import("@/lib/payments/attribution");
            const body = await parseBody(
              request,
              z.object({
                items: itemsSchema,
                customer: customerSchema,
                address: addressSchema,
                shippingOptionId: z.string().trim().min(1).max(40),
                attribution: attributionWithContextSchema,
              }),
            );
            const { attribution, context } = splitAttributionPayload(body.attribution);

            // Headers da requisição como fallback; o que o checkout envia explicitamente vence.
            const headers = request.headers;
            const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
            const clientContext = {
              clientIp:
                context.clientIp ??
                headers.get("cf-connecting-ip") ??
                forwarded ??
                headers.get("x-real-ip") ??
                null,
              clientUserAgent: context.clientUserAgent ?? headers.get("user-agent"),
              eventSourceUrl:
                context.eventSourceUrl ?? attribution.landing_page ?? headers.get("referer"),
            };

            const { createOrder } = await import("@/lib/payments/orders.server");
            const result = await createOrder({
              store,
              items: body.items,
              customer: body.customer,
              address: body.address,
              shippingOptionId: body.shippingOptionId,
              attribution,
              clientContext,
            });

            const origin = new URL(request.url).origin;
            const paymentUrl = appendAttributionToUrl(
              `${origin}/pay/${result.publicToken}`,
              result.attribution,
            );

            return {
              orderId: result.order.id,
              orderNumber: result.order.order_number,
              publicToken: result.publicToken,
              /** Página de checkout hospedada (redirecionar o cliente para cá). */
              paymentUrl,
              totals: {
                currency: result.totals.currency,
                subtotalCents: result.totals.subtotalCents,
                shippingCents: result.totals.shippingCents,
                discountCents: result.totals.discountCents,
                totalCents: result.totals.totalCents,
              },
            };
          },
        );
      },

    },
  },
});
