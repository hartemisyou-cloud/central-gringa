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
        const d = await donationByToken(params.token);
        const origin = new URL(request.url).origin;
        const receipt = `${origin}/donations/receipt/${encodeURIComponent(params.token)}`;
        if (!d) return new Response("Donation not found.", { status: 404 });
        const url = typeof d.checkout_url === "string" ? d.checkout_url : "";
        const official = /^https:\/\/checkout\.stripe\.com\//.test(url);
        const notExpired = !d.checkout_expires_at || new Date(d.checkout_expires_at).getTime() > Date.now();
        if (d.status === "PENDING" && official && notExpired) {
          // New local redirects only while acceptance is open (config, campaign, live recipient check).
          // This cannot close a Stripe page that is already open elsewhere.
          const { paymentRedirectGaps } = await import("@/lib/donations/service.server");
          const gaps = await paymentRedirectGaps(d).catch(() => ["check failed"]);
          if (gaps.length) {
            return new Response(null, { status: 303, headers: { location: `${receipt}?unavailable=1`, "cache-control": "no-store" } });
          }
          return new Response(null, { status: 303, headers: { location: url, "cache-control": "no-store" } });
        }
        return new Response(null, { status: 303, headers: { location: receipt, "cache-control": "no-store" } });
      },
    },
  },
});
