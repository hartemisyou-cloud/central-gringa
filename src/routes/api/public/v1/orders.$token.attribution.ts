import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

/**
 * Enriquecimento de atribuição de um pedido já existente.
 *
 * Somente telemetria: localiza o pedido pelo public token (escopado à loja
 * autenticada) e completa `order_attribution`. Nunca cria pedido, nunca toca
 * em status, Stripe, PaymentIntent, Meta CAPI ou UTMify. Idempotente.
 */
export const Route = createFileRoute("/api/public/v1/orders/$token/attribution")({
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
          { bucket: "order-attribution", limit: 60, windowSeconds: 60 },
          async (store) => {
            const { attributionWithContextSchema, splitAttributionPayload } = await import(
              "@/lib/payments/attribution"
            );
            const token = z.string().trim().min(10).max(128).parse(params.token);
            const body = await parseBody(
              request,
              z.object({ attribution: attributionWithContextSchema }),
            );
            const { attribution, context } = splitAttributionPayload(body.attribution);

            const headers = request.headers;
            const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
            const clientIp =
              context.clientIp ??
              headers.get("cf-connecting-ip") ??
              forwarded ??
              headers.get("x-real-ip") ??
              null;
            const clientUserAgent = context.clientUserAgent ?? headers.get("user-agent");
            const eventSourceUrl =
              context.eventSourceUrl ?? attribution.landing_page ?? headers.get("referer");

            const { PaymentError } = await import("@/lib/payments/errors");
            const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
            const { data: order } = await supabaseAdmin
              .from("orders")
              .select("id, order_number")
              .eq("public_token", token)
              .eq("store_id", store.id)
              .maybeSingle();
            if (!order) throw new PaymentError("NOT_FOUND", "Order not found.");

            const { enrichOrderAttribution, getOrderAttributionRecord } = await import(
              "@/lib/payments/attribution.server"
            );
            await enrichOrderAttribution(order.id, attribution, {
              clientIp,
              clientUserAgent,
              eventSourceUrl,
            });

            const saved = await getOrderAttributionRecord(order.id);
            return {
              orderNumber: order.order_number,
              updated: true,
              attribution: {
                fbc: Boolean(saved.fbc),
                fbp: Boolean(saved.fbp),
                client_ip: Boolean(saved.client_ip),
                client_user_agent: Boolean(saved.client_user_agent),
                event_source_url: Boolean(saved.event_source_url),
                utm_source: saved.utm_source ?? null,
                utm_medium: saved.utm_medium ?? null,
                utm_campaign: saved.utm_campaign ?? null,
              },
            };
          },
        );
      },
    },
  },
});
