import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const schema = z.object({ token: z.string().min(10).max(128) });

export const loadHostedPaymentSession = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => schema.parse(data))
  .handler(async ({ data }) => {
    const { getHostedPaymentSession } = await import("@/lib/payments/hosted.server");
    try {
      return { ok: true as const, session: await getHostedPaymentSession(data.token) };
    } catch (error) {
      return { ok: false as const, message: (error as Error).message };
    }
  });

/** Cria o PaymentIntent apenas quando o cliente confirma o pagamento. */
export const startHostedPaymentIntent = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => schema.parse(data))
  .handler(async ({ data }) => {
    const { startHostedPayment } = await import("@/lib/payments/hosted.server");
    try {
      return { ok: true as const, ...(await startHostedPayment(data.token)) };
    } catch (error) {
      return { ok: false as const, message: (error as Error).message };
    }
  });
