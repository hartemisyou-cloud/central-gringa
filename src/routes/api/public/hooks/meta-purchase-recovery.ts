import { createFileRoute } from "@tanstack/react-router";
import { isRecoveryAuthorized } from "@/lib/meta/recovery-auth";

export const Route = createFileRoute("/api/public/hooks/meta-purchase-recovery")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const headers = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
        if (!await isRecoveryAuthorized(request.headers.get("authorization"), process.env["CRON_SECRET"])) {
          return Response.json({ error: "Unauthorized" }, { status: 401, headers });
        }
        // Deployment switch is default-off; it is not an advertising consent grant.
        if (process.env["META_PURCHASE_RECOVERY_ENABLED"] !== "true") {
          return Response.json({ enabled: false, processed: 0 }, { headers });
        }
        try {
          const { recoverNewMetaPurchases } = await import("@/lib/meta/capi.server");
          return Response.json(await recoverNewMetaPurchases(), { headers });
        } catch {
          return Response.json({ error: "Purchase recovery unavailable" }, { status: 503, headers });
        }
      },
    },
  },
});