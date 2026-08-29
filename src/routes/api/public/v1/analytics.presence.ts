import { createFileRoute } from "@tanstack/react-router";

/**
 * Heartbeat público de presença. Tolerante a falhas: sempre responde 200/202
 * para nunca impactar a loja ou o checkout. Não grava PII nem dados de pagamento.
 */
export const Route = createFileRoute("/api/public/v1/analytics/presence")({
  server: {
    handlers: {
      OPTIONS: async () =>
        new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "content-type",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            Vary: "Origin",
          },
        }),
      POST: async ({ request }) => {
        const headers = {
          "content-type": "application/json",
          "cache-control": "no-store",
          "Access-Control-Allow-Origin": request.headers.get("origin") ?? "*",
          Vary: "Origin",
        };
        try {
          const { z } = await import("zod");
          const schema = z.object({
            sessionId: z.string().regex(/^[A-Za-z0-9_-]{8,80}$/),
            event: z.enum([
              "SESSION_ACTIVE",
              // CART_OPENED = drawer de doação aberto no site principal
              "CART_OPENED",
              "CART_CLOSED",
              "CHECKOUT_VIEWED",
              "PAYMENT_SUCCEEDED",
              "SESSION_ENDED",
            ]),
            storeSlug: z.string().min(2).max(80).optional(),
            page: z.string().max(200).optional(),
          });
          const parsed = schema.safeParse(await request.json());
          if (!parsed.success) {
            return new Response(JSON.stringify({ ok: false, ignored: true }), {
              status: 202,
              headers,
            });
          }

          const { enforceRateLimit } = await import("@/lib/payments/store-auth.server");
          await enforceRateLimit(`presence:${parsed.data.sessionId}`, 120, 60);

          const { recordPresence, prunePresence } = await import(
            "@/lib/analytics/presence.server"
          );
          const result = await recordPresence(parsed.data, request.headers.get("user-agent"));
          // Limpeza determinística (1x a cada 5 min) mesmo sem o painel aberto.
          await prunePresence();
          return new Response(JSON.stringify(result), { status: 200, headers });
        } catch (error) {
          console.error("[presence] heartbeat failed", (error as Error).message);
          return new Response(JSON.stringify({ ok: false }), { status: 202, headers });
        }
      },
    },
  },
});
