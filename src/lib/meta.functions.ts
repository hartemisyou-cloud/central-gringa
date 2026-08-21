import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const tokenSchema = z.object({ token: z.string().min(10).max(128) });

/**
 * Configuração pública de rastreamento de um pedido (Pixel ID + valor real).
 * Público por design (resolvido por token não enumerável) e nunca devolve
 * Access Token da Meta nem qualquer credencial.
 */
export const loadOrderTracking = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => tokenSchema.parse(data))
  .handler(async ({ data }) => {
    const { getOrderTracking } = await import("@/lib/meta/tracking.server");
    try {
      return await getOrderTracking(data.token);
    } catch {
      return null;
    }
  });
