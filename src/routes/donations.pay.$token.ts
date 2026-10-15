import { createFileRoute } from "@tanstack/react-router";

/**
 * Redirects only to the persisted, official Stripe-hosted Checkout URL created
 * for this donation. Never accepts a redirect target from the request.
 */
export const Route = createFileRoute("/donations/pay/$token")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { donationByToken } = await import("@/lib/donations/service.server");
        const { isOfficialStripeCheckoutUrl, payBridgeResponse, seeOther, PAY_SECURITY_HEADERS } = await import("@/lib/donations/pay-bridge");
        const d = await donationByToken(params.token);
        const origin = new URL(request.url).origin;
        const receipt = `${origin}/donations/receipt/${encodeURIComponent(params.token)}`;
        if (!d) return new Response("Donation not found.", { status: 404, headers: { ...PAY_SECURITY_HEADERS, "content-type": "text/plain; charset=utf-8" } });
        const url = typeof d.checkout_url === "string" ? d.checkout_url : "";
        const official = isOfficialStripeCheckoutUrl(url);
        const notExpired = !d.checkout_expires_at || new Date(d.checkout_expires_at).getTime() > Date.now();
        if (d.status === "PENDING" && official && notExpired) {
          // New local redirects only while acceptance is open (config, campaign, live recipient check).
          // This cannot close a Stripe page that is already open elsewhere.
          const { paymentRedirectGaps } = await import("@/lib/donations/service.server");
          const gaps = await paymentRedirectGaps(d).catch(() => ["check failed"]);
          if (gaps.length) return seeOther(receipt);
          return payBridgeResponse(url);
        }
        return seeOther(receipt);
      },
    },
  },
});
