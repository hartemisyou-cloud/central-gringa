import { z } from "zod";
import { DONATION_AMOUNTS_CENTS, createDonationSchema, type CreateDonationInput } from "./rules";

/**
 * Same-tab form POST from the Foundation site -> 303 to this central's /donations/pay/<token>.
 * The store is resolved server-side only; the browser never sends or sees store credentials.
 */
export const START_ALLOWED_ORIGINS = new Set([
  "https://hopehumanfoundation.org",
  "https://www.hopehumanfoundation.org",
  "https://id-preview--5dc3b815-88ea-4da6-b1d3-a58fa6079440.lovable.app",
]);
export const START_MAX_BODY_BYTES = 8 * 1024;
export const START_ERROR_BASE = "https://www.hopehumanfoundation.org/donate";
const STORE_SLUG = "hope-human-books";

export const startPayloadSchema = z
  .object({
    campaignSlug: z.string().trim().min(1).max(120).regex(/^[a-z0-9-]+$/),
    amountCents: z.number().int().refine((v) => (DONATION_AMOUNTS_CENTS as readonly number[]).includes(v)),
    idempotencyKey: z.string().trim().min(8).max(200),
    attribution: z.record(z.string().max(80), z.string().max(500)).optional(),
  })
  .strict();

export interface StartDeps {
  loadStore(slug: string): Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  rateLimit(bucket: string): Promise<void>;
  createDonation(i: { store: any; body: CreateDonationInput; origin: string }): Promise<{ publicToken: string }>; // eslint-disable-line @typescript-eslint/no-explicit-any
  clientIp(r: Request): string;
}

const noStore = { "cache-control": "no-store", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff" };
const plain = (status: number, msg: string, extra: Record<string, string> = {}) =>
  new Response(msg, { status, headers: { ...noStore, "content-type": "text/plain; charset=utf-8", ...extra } });
const see = (location: string) => new Response(null, { status: 303, headers: { ...noStore, location } });

/** Reads at most `max` bytes, cancelling the stream as soon as the limit is exceeded. */
export async function readBounded(request: Request, max: number): Promise<Uint8Array | null> {
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.byteLength; }
  return out;
}

export function methodNotAllowed(): Response {
  return plain(405, "Method Not Allowed", { allow: "POST" });
}

export async function handleDonationStart(request: Request, deps: StartDeps): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed();
  const self = new URL(request.url).origin;
  const origin = request.headers.get("origin");
  if (!origin || (origin !== self && !START_ALLOWED_ORIGINS.has(origin))) return plain(403, "Forbidden origin.");
  const ctype = (request.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (ctype !== "application/x-www-form-urlencoded") return plain(400, "Unsupported content type.");
  const cl = request.headers.get("content-length");
  if (cl !== null && (!/^\d{1,7}$/.test(cl.trim()) || Number(cl) > START_MAX_BODY_BYTES)) return plain(400, "Request too large.");
  const buf = await readBounded(request, START_MAX_BODY_BYTES);
  if (!buf) return plain(400, "Request too large.");

  const form = new URLSearchParams(new TextDecoder().decode(buf));
  const keys = [...form.keys()];
  if (keys.length !== 1 || keys[0] !== "payload") return plain(400, "Invalid request.");
  let raw: unknown;
  try {
    raw = JSON.parse(form.get("payload") ?? "");
  } catch {
    return plain(400, "Invalid request.");
  }
  const parsed = startPayloadSchema.safeParse(raw);
  if (!parsed.success) return plain(400, "Invalid request.");
  const p = parsed.data;

  const back = `${START_ERROR_BASE}?slug=${encodeURIComponent(p.campaignSlug)}&amount=${p.amountCents / 100}&checkout_error=unavailable`;
  try {
    const store = await deps.loadStore(STORE_SLUG);
    if (!store) return see(back);
    await deps.rateLimit(`donation-start:${store.id}:${deps.clientIp(request)}`);
    // Same normalized body as the server-to-server API (no donor here; Stripe collects contact details).
    const body = createDonationSchema.parse({
      campaignSlug: p.campaignSlug,
      amountCents: p.amountCents,
      currency: "USD",
      idempotencyKey: p.idempotencyKey,
      ...(p.attribution ? { attribution: p.attribution } : {}),
    });
    const r = await deps.createDonation({ store, body, origin: self });
    if (!r?.publicToken) return see(back);
    return see(`${self}/donations/pay/${encodeURIComponent(r.publicToken)}`);
  } catch (e) {
    console.error("[donations/start] unavailable:", (e as { code?: string }).code ?? "error");
    return see(back);
  }
}

export async function defaultStartDeps(): Promise<StartDeps> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { enforceRateLimit, clientIp } = await import("@/lib/payments/store-auth.server");
  const { createDonation } = await import("./service.server");
  return {
    loadStore: async (slug) => {
      const { data } = await supabaseAdmin.from("stores").select("*").eq("slug", slug).eq("status", "ACTIVE").maybeSingle();
      return data;
    },
    rateLimit: (b) => enforceRateLimit(b, 20, 60),
    createDonation: createDonation as StartDeps["createDonation"],
    clientIp,
  };
}
