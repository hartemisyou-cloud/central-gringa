import { z } from "zod";
import { PaymentError, toErrorResponse } from "./errors";
import {
  authenticateStoreRequest,
  clientIp,
  corsHeaders,
  enforceRateLimit,
  jsonResponse,
  type StoreRow,
} from "./store-auth.server";

export const itemsSchema = z
  .array(
    z.object({
      productId: z.string().uuid(),
      quantity: z.number().int().min(1).max(20),
    }),
  )
  .min(1)
  .max(30);

export const customerSchema = z.object({
  firstName: z.string().trim().min(2).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: z.string().trim().email().max(160),
  phone: z.string().trim().min(8).max(20),
});

export const addressSchema = z.object({
  postalCode: z.string().trim().min(8).max(9),
  street: z.string().trim().min(2).max(160),
  number: z.string().trim().min(1).max(20),
  complement: z.string().trim().max(80).optional(),
  district: z.string().trim().min(2).max(80),
  city: z.string().trim().min(2).max(80),
  state: z.string().trim().length(2),
  country: z.string().trim().length(2).optional(),
});

/**
 * Envelope padrão dos endpoints da API central:
 * CORS por allowlist -> autenticação da loja -> rate limit -> handler.
 */
export async function withStore(
  request: Request,
  options: { bucket: string; limit: number; windowSeconds: number },
  handler: (store: StoreRow) => Promise<unknown>,
): Promise<Response> {
  const origin = request.headers.get("origin");
  let store: StoreRow | null = null;
  try {
    store = await authenticateStoreRequest(request);
    await enforceRateLimit(
      `${options.bucket}:${store.id}:${clientIp(request)}`,
      options.limit,
      options.windowSeconds,
    );
    const data = await handler(store);
    return jsonResponse({ data }, 200, corsHeaders(store, origin));
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return jsonResponse(body, status, corsHeaders(store, origin));
  }
}

export function preflight(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Headers":
        "content-type, x-store-api-key, x-store-slug, authorization",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      Vary: "Origin",
    },
  });
}

export async function parseBody<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new PaymentError("INVALID_INPUT", "Corpo da requisição inválido.");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new PaymentError("INVALID_INPUT", "Dados inválidos.", {
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }
  return parsed.data;
}
