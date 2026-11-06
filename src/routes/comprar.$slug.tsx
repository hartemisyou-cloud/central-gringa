import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/comprar/$slug")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { purchaseEntryProduct } = await import("@/lib/payments/purchase-entry");
        const { CAPTURE_PARAM, purchaseBridgeResponse } = await import("@/lib/payments/purchase-bridge");
        const url = new URL(request.url);
        // Primeira visita: serve o documento de captura (cookies Meta _fbp/_fbc
        // e document.referrer), que reentra na mesma rota com c=1. A requisição
        // com c=1 executa a entrada de compra real no servidor.
        const hasEsrc = (url.searchParams.get("esrc") ?? "").trim().length > 0;
        if (!url.searchParams.has(CAPTURE_PARAM) && !hasEsrc && purchaseEntryProduct(params.slug)) {
          return purchaseBridgeResponse(url);
        }
        const { handlePurchaseEntry, defaultPurchaseEntryDeps } = await import("@/lib/payments/purchase-entry.server");
        return handlePurchaseEntry(request, params.slug, await defaultPurchaseEntryDeps());
      },
    },
  },
});
