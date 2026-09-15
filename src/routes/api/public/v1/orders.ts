import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

/**
 * DIAGNÓSTICO TEMPORÁRIO (remover depois de identificar a recusa 400).
 * Registra apenas estrutura/presença de campos — nunca valores sensíveis
 * (e-mail, telefone, nome, endereço, fbp/fbc/fbclid, IP, UA, chaves, secrets).
 */
async function logOrderRejection(input: {
  request: Request;
  raw: unknown;
  error: unknown;
  startedAt: number;
}) {
  try {
    const body = (input.raw ?? {}) as Record<string, unknown>;
    const attribution = (body["attribution"] ?? {}) as Record<string, unknown>;
    const customer = (body["customer"] ?? null) as Record<string, unknown> | null;
    const address = (body["address"] ?? body["shippingAddress"] ?? null) as
      | Record<string, unknown>
      | null;
    const items = Array.isArray(body["items"]) ? (body["items"] as Record<string, unknown>[]) : [];
    const err = input.error as { code?: string; message?: string; details?: unknown };

    const postal = typeof address?.["postalCode"] === "string" ? (address["postalCode"] as string) : null;

    const payload = {
        csid: attribution["anonymous_session_id"] ?? attribution["csid"] ?? null,
        at: new Date().toISOString(),
        store_slug: input.request.headers.get("x-store-slug"),
        items: items.map((item) => ({
          product_id: typeof item["productId"] === "string" ? item["productId"] : null,
          quantity: item["quantity"] ?? null,
        })),
        item_count: items.length,
        customer_present: Boolean(customer),
        customer_shape: customer
          ? {
              first_name_present: typeof customer["firstName"] === "string" && customer["firstName"].trim() !== "",
              last_name_present: typeof customer["lastName"] === "string" && customer["lastName"].trim() !== "",
              email_present: typeof customer["email"] === "string" && customer["email"].trim() !== "",
              phone_present: typeof customer["phone"] === "string" && customer["phone"].trim() !== "",
              phone_length: typeof customer["phone"] === "string" ? customer["phone"].trim().length : null,
              keys: Object.keys(customer),
            }
          : null,
        address_present: Boolean(address),
        address_shape: address
          ? {
              postal_code_present: Boolean(postal && postal.trim() !== ""),
              postal_code_length: postal ? postal.trim().length : null,
              street_present: typeof address["street"] === "string" && address["street"].trim() !== "",
              number_present: typeof address["number"] === "string" && address["number"].trim() !== "",
              district_present: typeof address["district"] === "string" && address["district"].trim() !== "",
              city_present: typeof address["city"] === "string" && address["city"].trim() !== "",
              state_present: typeof address["state"] === "string" && address["state"].trim() !== "",
              country: typeof address["country"] === "string" ? address["country"] : null,
              keys: Object.keys(address),
            }
          : null,
        shipping_option_id: body["shippingOptionId"] ?? null,
        attribution_keys: Object.keys(attribution),
        body_keys: Object.keys(body),
        error_code: err?.code ?? null,
        error_message: err?.message ?? null,
        validation_details: err?.details ?? null,
        duration_ms: Date.now() - input.startedAt,
        http_status: (input.error as { status?: number })?.status ?? 400,
    };

    console.error("[orders-diag]", JSON.stringify(payload));

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("audit_logs").insert({
      action: "ORDERS_400_DIAG",
      resource_type: "order_create_rejection",
      resource_id: typeof payload.csid === "string" ? payload.csid : null,
      metadata: payload,
    });
  } catch (diagError) {
    console.error("[orders-diag] failed", (diagError as Error).message);
  }
}

export const Route = createFileRoute("/api/public/v1/orders")({
  server: {
    handlers: {
      OPTIONS: async () => {
        const { preflight } = await import("@/lib/payments/http.server");
        return preflight();
      },
      POST: async ({ request }) => {
        const startedAt = Date.now();
        // Snapshot apenas para diagnóstico (não consome o corpo original).
        let rawSnapshot: unknown = null;
        try {
          rawSnapshot = await request.clone().json();
        } catch {
          rawSnapshot = null;
        }
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
            try {
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
                // Produtos digitais (eBooks) não exigem endereço de entrega.
                address: addressSchema.optional(),
                shippingOptionId: z.string().trim().min(1).max(40).optional(),
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
              ...(body.address ? { address: body.address } : {}),
              shippingOptionId: body.shippingOptionId ?? "no-shipping",
              noShipping: isNoShippingRequest(request, store),
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
            } catch (error) {
              logOrderRejection({ request, raw: rawSnapshot, error, startedAt });
              throw error;
            }
          },
        );
      },

    },
  },
});
