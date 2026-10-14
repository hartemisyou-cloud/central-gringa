import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { PaymentError } from "./errors";
import { EBOOK_BUCKET, EBOOK_PREFIX, workById, worksForSkus, type HhbWork } from "@/lib/catalog/hhb";

/**
 * Ebook fulfillment. Downloads are authorized ONLY by the order's database
 * state (orders.status = PAID, set exclusively by the verified Stripe webhook).
 * No query-string flag, redirect parameter or client claim can unlock a file.
 * The public token is the unguessable receipt credential (32 random chars).
 */

export interface DeliverableWork {
  workId: string;
  title: string;
  author: string;
  firstPublished: string;
  sourceUrl: string;
  bytes: number;
  downloadPath: string;
}

/** Pure decision: which works an order may download. Exported for tests. */
export function deliverableWorks(status: string, skus: string[]): HhbWork[] {
  if (status !== "PAID") return [];
  return worksForSkus(skus);
}

async function loadOrder(publicToken: string) {
  const { data: order } = await supabaseAdmin
    .from("orders")
    .select("id, status, order_number, order_items(sku)")
    .eq("public_token", publicToken)
    .maybeSingle();
  if (!order) throw new PaymentError("NOT_FOUND", "Order not found.");
  return order;
}

export async function getOrderDeliverables(publicToken: string): Promise<{
  orderNumber: string;
  status: string;
  works: DeliverableWork[];
}> {
  const order = await loadOrder(publicToken);
  const skus = (order.order_items ?? []).map((i) => i.sku);
  return {
    orderNumber: order.order_number,
    status: order.status,
    works: deliverableWorks(order.status, skus).map((w) => ({
      workId: w.workId,
      title: w.title,
      author: w.author,
      firstPublished: w.firstPublished,
      sourceUrl: w.sourceUrl,
      bytes: w.bytes,
      downloadPath: `/api/public/v1/downloads/${publicToken}/${w.workId}`,
    })),
  };
}

/** Streams one ebook file after re-checking PAID status and SKU membership. */
export async function downloadWork(publicToken: string, workId: string): Promise<Response> {
  const order = await loadOrder(publicToken);
  const skus = (order.order_items ?? []).map((i) => i.sku);
  const allowed = deliverableWorks(order.status, skus).some((w) => w.workId === workId);
  if (!allowed) {
    throw new PaymentError(
      order.status === "PAID" ? "NOT_FOUND" : "FORBIDDEN",
      order.status === "PAID"
        ? "This title is not part of the order."
        : "Downloads unlock once payment is confirmed.",
    );
  }
  const work = workById(workId)!;
  const { data, error } = await supabaseAdmin.storage
    .from(EBOOK_BUCKET)
    .download(`${EBOOK_PREFIX}${work.file}`);
  if (error || !data) throw new PaymentError("CONFIG_ERROR", "File temporarily unavailable.");
  return new Response(data.stream(), {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "content-disposition": `attachment; filename="${work.file}"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
