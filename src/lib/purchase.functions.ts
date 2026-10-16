import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const preparePurchase = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ slug: z.string().min(1).max(100), token: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict().parse(input))
  .handler(async ({ data }) => {
    const { getRequest, setResponseHeader } = await import("@tanstack/react-start/server");
    const request = getRequest();
    setResponseHeader("Cache-Control", "no-store");
    const origin = new URL(request.url).origin;
    if (request.headers.get("origin") !== origin) return { ok: false as const, message: "Invalid request origin." };
    try {
      const { enforceRateLimit, clientIp } = await import("@/lib/payments/store-auth.server");
      await enforceRateLimit(`ebook-purchase:${clientIp(request)}`, 10, 60);
      const { startPurchase } = await import("@/lib/payments/purchase.server");
      return { ok: true as const, ...await startPurchase(data.slug, origin, data.token) };
    } catch {
      return { ok: false as const, message: "Secure checkout is unavailable. Please try again later." };
    }
  });