import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/webhooks/stripe/$integrationId")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const { toErrorResponse } = await import("@/lib/payments/errors");
        try {
          // Corpo RAW: obrigatório para validar a assinatura HMAC da Stripe.
          const rawBody = await request.text();
          const { processStripeWebhook } = await import("@/lib/payments/webhooks.server");
          const result = await processStripeWebhook({
            integrationId: params.integrationId,
            rawBody,
            signature: request.headers.get("stripe-signature"),
          });
          return new Response(JSON.stringify(result.body), {
            status: result.status,
            headers: { "content-type": "application/json" },
          });
        } catch (error) {
          const { status, body } = toErrorResponse(error);
          return new Response(JSON.stringify(body), {
            status,
            headers: { "content-type": "application/json" },
          });
        }
      },
    },
  },
});
