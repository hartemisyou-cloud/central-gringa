import { HHB_STORE_ID } from "@/lib/catalog/hhb";
import type { StoreRow } from "./store-auth.server";
import { PaymentError } from "./errors";
import { purchaseEntryProduct, purchasePaymentPath } from "./purchase-entry";
import { CheckoutFailure, logCheckoutFailure } from "./checkout-log.server";
import type { createOrder } from "./orders.server";

export interface PurchaseEntryDeps {
  loadStore(): Promise<StoreRow | null>;
  rateLimit(bucket: string, limit: number, windowSeconds: number): Promise<void>;
  clientIp(request: Request): string;
  createOrder: typeof createOrder;
}

const headers = { "cache-control": "no-store", "x-robots-tag": "noindex" };

/** Server-only entry: no customer data, prices or marketing fields from the URL. */
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
    const order = await deps.createOrder({
      store,
      items: [{ productId: product.id, quantity: 1 }],
      shippingOptionId: "no-shipping",
    });
    return new Response(null, {
      status: 302,
      headers: { ...headers, location: purchasePaymentPath(order.publicToken, request.headers.get("referer")) },
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
  return {
    loadStore: async () => {
      const result = await one<StoreRow>(sql`select * from public.stores where id = ${HHB_STORE_ID}`, true);
      if (result.error) throw result.error;
      return result.data;
    },
    rateLimit: enforceRateLimit,
    clientIp,
    createOrder,
  };
}
