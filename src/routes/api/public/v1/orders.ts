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
        const { withStore, parseBody, itemsSchema, customerSchema, addressSchema } = await import(
          "@/lib/payments/http.server"
        );
        return withStore(
          request,
          { bucket: "orders", limit: 20, windowSeconds: 60 },
          async (store) => {
            // --- INSTRUMENTAÇÃO TEMPORÁRIA (somente leitura/diagnóstico) ---
            // Inspeciona o corpo BRUTO antes do Zod, porque o schema descarta
            // silenciosamente qualquer campo não declarado (inclusive UTMs).
            const rawBody = await request
              .clone()
              .json()
              .catch(() => null);
            const requestUrl = new URL(request.url);
            const { scanAttribution, mergeScans, logAttribution } = await import(
              "@/lib/payments/attribution-diagnostics.server"
            );
            const scan = mergeScans([
              { origin: "checkout request body", scan: scanAttribution(rawBody) },
              {
                origin: "checkout request query",
                scan: scanAttribution(Object.fromEntries(requestUrl.searchParams)),
              },
              {
                origin: "checkout request headers",
                scan: scanAttribution({
                  referer: request.headers.get("referer") ?? undefined,
                }),
              },
            ]);
            // --- FIM DA INSTRUMENTAÇÃO ---

            const body = await parseBody(
              request,
              z.object({
                items: itemsSchema,
                customer: customerSchema,
                address: addressSchema,
                shippingOptionId: z.string().trim().min(1).max(40),
              }),
            );
            const { createOrder } = await import("@/lib/payments/orders.server");
            const result = await createOrder({ store, ...body });

            logAttribution({
              stage: "checkout->central",
              storeId: store.id,
              orderId: result.order.id,
              orderNumber: result.order.order_number,
              fields: scan.fields,
              unknownKeys: scan.unknownKeys,
              notes: [
                "schema Zod de /orders nao declara campos de atribuicao: qualquer UTM enviada e descartada no parseBody",
                "tabela orders nao possui colunas de atribuicao: nada e persistido junto ao pedido",
              ],
            });
            const origin = new URL(request.url).origin;
            return {
              orderId: result.order.id,
              orderNumber: result.order.order_number,
              publicToken: result.publicToken,
              /** Página de checkout hospedada (redirecionar o cliente para cá). */
              paymentUrl: `${origin}/pay/${result.publicToken}`,
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
