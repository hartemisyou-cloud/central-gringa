import { createFileRoute } from "@tanstack/react-router";

/** Ebook download. Authorized only by orders.status = PAID (webhook-set). */
export const Route = createFileRoute("/api/public/v1/downloads/$publicToken/$workId")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { toErrorResponse } = await import("@/lib/payments/errors");
        try {
          if (!/^[A-Za-z0-9]{10,120}$/.test(params.publicToken) || !/^[a-z0-9-]{1,80}$/.test(params.workId)) {
            return new Response("Not found", { status: 404 });
          }
          const { downloadWork } = await import("@/lib/payments/fulfillment.server");
          return await downloadWork(params.publicToken, params.workId);
        } catch (error) {
          const { status, body } = toErrorResponse(error);
          return new Response(JSON.stringify(body), {
            status,
            headers: { "content-type": "application/json", "cache-control": "no-store" },
          });
        }
      },
    },
  },
});
