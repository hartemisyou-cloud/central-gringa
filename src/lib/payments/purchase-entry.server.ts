import { HHB_STORE_ID } from "@/lib/catalog/hhb";
import type { StoreRow } from "./store-auth.server";
import { PaymentError } from "./errors";
import { isHhfEntryReferer, purchaseEntryProduct } from "./purchase-entry";
import { CheckoutFailure, logCheckoutFailure } from "./checkout-log.server";
import type { createOrder } from "./orders.server";
import type { createEbookCheckoutSession } from "./checkout-session.server";
import { normalizeAttribution, type Attribution } from "./attribution";

export interface PurchaseEntryDeps {
  loadStore(): Promise<StoreRow | null>;
  rateLimit(bucket: string, limit: number, windowSeconds: number): Promise<void>;
  clientIp(request: Request): string;
  createOrder: typeof createOrder;
  createCheckout: typeof createEbookCheckoutSession;
  /** Active marketing code → UTM triple (server-only lookup). */
  resolveMarketingCode(code: string): Promise<{ utm_source: string; utm_medium: string; utm_campaign: string } | null>;
  now?(): number;
}

/**
 * Reads ref, fbclid, the five utm_* fields and gclid from the query.
 * Query values are applied first; a valid registry ref overrides its UTM fields
 * individually. Values are sanitized/truncated, never rejected.
 */
export async function entryAttribution(
  url: URL,
  deps: Pick<PurchaseEntryDeps, "resolveMarketingCode" | "now">,
): Promise<Attribution | undefined> {
  const raw = normalizeAttribution({
    utm_source: url.searchParams.get("utm_source") ?? undefined,
    utm_medium: url.searchParams.get("utm_medium") ?? undefined,
    utm_campaign: url.searchParams.get("utm_campaign") ?? undefined,
    utm_content: url.searchParams.get("utm_content") ?? undefined,
    utm_term: url.searchParams.get("utm_term") ?? undefined,
    gclid: url.searchParams.get("gclid") ?? undefined,
    click_id: url.searchParams.get("ref") ?? undefined,
    fbclid: url.searchParams.get("fbclid") ?? undefined,
  });
  const out: Attribution = { ...raw };
  if (raw.fbclid) {
    out.fbclid = raw.fbclid;
    out.fbc = normalizeAttribution({ fbc: `fb.1.${(deps.now ?? Date.now)()}.${raw.fbclid}` }).fbc;
  }
  if (raw.click_id) {
    try {
      const utm = await deps.resolveMarketingCode(raw.click_id);
      if (utm) Object.assign(out, normalizeAttribution(utm));
    } catch {
      // attribution is best effort; never fails the order
    }
  }
  return Object.keys(out).length ? out : undefined;
}

const headers = { "cache-control": "no-store", "x-robots-tag": "noindex" };

/** Server-only entry: no customer data or prices from the URL; only allowlisted tracking fields feed attribution. */
export async function handlePurchaseEntry(
  request: Request,
  slug: string,
  deps: PurchaseEntryDeps,
): Promise<Response> {
  if (request.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405, headers: { ...headers, allow: "GET" } });
  }
  const product = purchaseEntryProduct(slug);
  if (!product) return new Response("Not Found", { status: 404, headers });
  try {
    const store = await deps.loadStore();
    if (!store || store.status !== "ACTIVE") {
      throw new PaymentError("CONFIG_ERROR", "The store is not set up yet.");
    }
    await deps.rateLimit(`orders:${store.id}:${deps.clientIp(request)}`, 20, 60);
    const attribution = await entryAttribution(new URL(request.url), deps);
    const hhf = isHhfEntryReferer(request.headers.get("referer"));
    const order = await deps.createOrder({
      store,
      items: [{ productId: product.id, quantity: 1 }],
      shippingOptionId: "no-shipping",
      ...(attribution ? { attribution } : {}),
      originHhf: hhf,
      clientIp: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
        || request.headers.get("x-real-ip")?.trim()
        || null,
    });
    const checkout = await deps.createCheckout({
      store,
      orderId: order.order.id,
      slug,
      origin: new URL(request.url).origin,
      hhf,
    });
    return new Response(null, {
      status: 302,
      headers: { ...headers, location: checkout.url },
    });
  } catch (error) {
    if (!(error instanceof PaymentError) || error instanceof CheckoutFailure || error.code === "CONFIG_ERROR" || error.code === "PROVIDER_ERROR") {
      logCheckoutFailure(error, "comprar.create-order");
    }
    return new Response("Secure checkout is unavailable. Please try again later.", {
      status: error instanceof PaymentError ? error.status : 500,
      headers,
    });
  }
}

export async function defaultPurchaseEntryDeps(): Promise<PurchaseEntryDeps> {
  const { sql, one } = await import("@/lib/db/client.server");
  const { enforceRateLimit, clientIp } = await import("./store-auth.server");
  const { createOrder } = await import("./orders.server");
  const { createEbookCheckoutSession } = await import("./checkout-session.server");
  const { resolveMarketingCode } = await import("@/lib/marketing/codes.server");
  return {
    resolveMarketingCode,
    loadStore: async () => {
      const result = await one<StoreRow>(sql`select * from public.stores where id = ${HHB_STORE_ID}`, true);
      if (result.error) throw result.error;
      return result.data;
    },
    rateLimit: enforceRateLimit,
    clientIp,
    createOrder,
    createCheckout: createEbookCheckoutSession,
  };
}
