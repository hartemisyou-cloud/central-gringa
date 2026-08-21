import { createFileRoute } from "@tanstack/react-router";

/**
 * Ingestão pública de eventos de checkout (sem PII de pagamento).
 * Endpoint tolerante a falhas: sempre responde 200/202 para não impactar o
 * fluxo de pagamento das lojas; erros são registrados no servidor.
 */
export const Route = createFileRoute("/api/public/v1/analytics/events")({
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
          const { ingestSchema } = await import("@/lib/analytics/schema");
          const parsed = ingestSchema.safeParse(await request.json());
          if (!parsed.success) {
            return new Response(JSON.stringify({ accepted: 0, ignored: true }), { status: 202, headers });
          }

          const { enforceRateLimit, clientIp } = await import("@/lib/payments/store-auth.server");
          await enforceRateLimit(`analytics:${parsed.data.anonymousSessionId}`, 240, 60);

          const { ingestClientEvents } = await import("@/lib/analytics/ingest.server");
          const result = await ingestClientEvents(parsed.data, {
            userAgent: request.headers.get("user-agent"),
            country: request.headers.get("cf-ipcountry"),
            ip: clientIp(request),
          });
          return new Response(JSON.stringify(result), { status: 200, headers });
        } catch (error) {
          console.error("[analytics] ingest failed", (error as Error).message);
          return new Response(JSON.stringify({ accepted: 0 }), { status: 202, headers });
        }
      },
    },
  },
});
