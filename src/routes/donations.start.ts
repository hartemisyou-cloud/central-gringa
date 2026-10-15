import { createFileRoute } from "@tanstack/react-router";

const deny = async () => (await import("@/lib/donations/start.server")).methodNotAllowed();

export const Route = createFileRoute("/donations/start")({
  server: {
    handlers: {
      GET: deny,
      HEAD: deny,
      OPTIONS: deny,
      PUT: deny,
      PATCH: deny,
      DELETE: deny,
      POST: async ({ request }) => {
        const { handleDonationStart, defaultStartDeps } = await import("@/lib/donations/start.server");
        return handleDonationStart(request, await defaultStartDeps());
      },
    },
  },
});
