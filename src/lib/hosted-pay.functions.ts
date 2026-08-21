import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { attributionSchema } from "@/lib/payments/attribution";

const schema = z.object({ token: z.string().min(10).max(128) });

export const loadHostedPaymentSession = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => schema.parse(data))
  .handler(async ({ data }) => {
    const { getHostedPaymentSession } = await import("@/lib/payments/hosted.server");
    try {
      return { ok: true as const, session: await getHostedPaymentSession(data.token) };
    } catch (error) {
      return { ok: false as const, message: (error as Error).message };
    }
  });

const captureSchema = z.object({
  token: z.string().min(10).max(128),
  attribution: attributionSchema,
  pageUrl: z.string().trim().max(500).optional(),
});

/**
 * Completa a atribuição do pedido com o que existe no navegador do comprador
 * no checkout hospedado (fbclid/fbp/fbc/UTMs vindos direto na URL do checkout),
 * mais IP, User-Agent e a URL real da conversão.
 * Só preenche o que está vazio: a primeira origem capturada continua vencendo.
 * Nunca lança e nunca toca em pedidos, Stripe, pagamentos ou UTMify.
 */
export const captureHostedAttribution = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => captureSchema.parse(data))
  .handler(async ({ data }) => {
    try {
      const { getRequest } = await import("@tanstack/react-start/server");
      const request = getRequest();
      const headers = request.headers;
      const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
      const clientIp =
        headers.get("cf-connecting-ip") ?? forwarded ?? headers.get("x-real-ip") ?? null;
      const clientUserAgent = headers.get("user-agent");

      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: order } = await supabaseAdmin
        .from("orders")
        .select("id")
        .eq("public_token", data.token)
        .maybeSingle();
      if (!order) return { ok: false as const };

      const { enrichOrderAttribution } = await import("@/lib/payments/attribution.server");
      await enrichOrderAttribution(order.id, data.attribution ?? {}, {
        clientIp,
        clientUserAgent,
        eventSourceUrl: data.pageUrl ?? null,
      });
      return { ok: true as const };
    } catch {
      return { ok: false as const };
    }
  });
