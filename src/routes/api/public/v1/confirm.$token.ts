import { createFileRoute } from "@tanstack/react-router";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{8,120}$/;
const WAITING_STATUSES = ["PAYMENT_PROCESSING", "PENDING_PAYMENT"];

/**
 * Sonde de status leve para a página de confirmação do cloaker
 * (/confirmar/$token). Sem autenticação por design: a única entrada é o token
 * público aleatório do pedido. Enquanto o pedido ainda espera, executa também a
 * mesma confirmação best effort direto na Stripe.
 */
export const Route = createFileRoute("/api/public/v1/confirm/$token")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const json = (body: unknown, status: number): Response =>
          new Response(JSON.stringify(body), {
            status,
            headers: { "content-type": "application/json", "cache-control": "no-store" },
          });
        let token = "";
        try { token = decodeURIComponent(params.token ?? ""); } catch { token = ""; }
        if (!TOKEN_PATTERN.test(token)) return json({ ok: false, status: "NOT_FOUND" }, 404);
        try {
          const { enforceRateLimit } = await import("@/lib/payments/store-auth.server");
          // Bucket por token: sem disputa entre compradores diferentes e teto
          // acima do máximo de sondas da página (75/pedido).
          await enforceRateLimit(`confirm:${token}`, 100, 60);
          const { loadReceipt } = await import("@/lib/payments/receipt.server");
          let receipt = await loadReceipt(token);
          if (WAITING_STATUSES.includes(receipt.status)) {
            const { confirmPaidReceiptFromProvider } = await import("@/lib/payments/receipt-refresh.server");
            await confirmPaidReceiptFromProvider(token).catch(() => undefined);
            receipt = await loadReceipt(token);
          }
          return json({ ok: true, status: receipt.status, totalCents: receipt.totalCents, hhf: receipt.hhf });
        } catch (error) {
          const { PaymentError } = await import("@/lib/payments/errors");
          if (error instanceof PaymentError) {
            if (error.code === "RATE_LIMITED") return json({ ok: false, status: "PROCESSING" }, 200);
            if (error.code === "NOT_FOUND") return json({ ok: false, status: "NOT_FOUND" }, 404);
          }
          // Qualquer outra falha: o cliente continua sondando em silêncio.
          return json({ ok: false, status: "PROCESSING" }, 200);
        }
      },
    },
  },
});
