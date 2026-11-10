import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

/**
 * TEMPORARY diagnostic probe (remove after UTMify investigation).
 * Admin-session only. Creates no DB rows, orders or Meta events in probe mode;
 * with orderNumber it delegates to the existing admin resend action.
 */
const Body = z.object({
  orderNumber: z.string().trim().min(1).max(120).optional(),
  storeId: z.string().uuid().optional(),
});

function utcStamp(d: Date): string {
  return d.toISOString().slice(0, 19).replace("T", " ");
}

export const Route = createFileRoute("/api/admin/utmify/probe")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { isUnlocked } = await import("@/lib/admin/session.server");
        if (!(await isUnlocked())) {
          return Response.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
        }
        let body: z.infer<typeof Body>;
        try {
          body = Body.parse(await request.json().catch(() => ({})));
        } catch {
          return Response.json({ ok: false, error: "INVALID_BODY" }, { status: 400 });
        }
        const headers = { "cache-control": "no-store" };
        if (body.orderNumber) {
          const { resendUtmifySaleForOrderNumber } = await import("@/lib/utmify/api.server");
          return Response.json(await resendUtmifySaleForOrderNumber(body.orderNumber), { headers });
        }
        const storeId = body.storeId ?? "b0b5e000-4848-4b00-8000-000000000001";
        const { getUtmifySettingsWithToken } = await import("@/lib/utmify/config.server");
        const settings = await getUtmifySettingsWithToken(storeId);
        if (!settings) {
          return Response.json({ ok: false, error: "UTMIFY_NOT_CONFIGURED" }, { headers });
        }
        const now = new Date();
        const stamp = utcStamp(now);
        const payload = {
          orderId: `PROBE-DRAEL-${Math.floor(now.getTime() / 1000)}`,
          platform: "CentralSparkPay",
          paymentMethod: "credit_card",
          status: "paid",
          createdAt: stamp,
          approvedDate: stamp,
          refundedAt: null,
          customer: { name: "Diag Probe", email: "diag-probe@drael.local", phone: null, document: null, country: "US", ip: null },
          products: [{ id: "probe-1", name: "Diagnostic Probe", planId: null, planName: null, quantity: 1, priceInCents: 100 }],
          trackingParameters: {},
          commission: { totalPriceInCents: 100, gatewayFeeInCents: 0, userCommissionInCents: 100, currency: "USD" },
          isTest: true,
        };
        try {
          const res = await fetch("https://api.utmify.com.br/api-credentials/orders", {
            method: "POST",
            headers: { "content-type": "application/json", "x-api-token": settings.apiToken },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(15000),
          });
          const text = await res.text();
          return Response.json({ ok: true, httpStatus: res.status, responseBody: text.split(settings.apiToken).join("[redacted]") }, { headers });
        } catch (e) {
          return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { headers });
        }
      },
    },
  },
});
