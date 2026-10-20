import { sql, one, exec } from "@/lib/db/client.server";
import { worksForSkus } from "@/lib/catalog/hhb";
import { normalizeCheckoutCustomerDetails } from "./checkout-customer.server";

type DeliveryOrder = {
  id: string; status: string; order_number: string; public_token: string;
  origin_hhf: boolean; delivery_email_sent_at: string | null;
  checkout_customer_details: unknown; customer_email: string | null;
  items: Array<{ product_name: string; sku: string }>;
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]!);
}

/** This link deliberately never inherits Checkout's return marker (R3). */
export function deliveryOrderUrl(publicToken: string): string {
  return `https://hopehumanbooks.com/order/${encodeURIComponent(publicToken)}`;
}

export function buildDeliveryEmail(order: Pick<DeliveryOrder, "order_number" | "public_token" | "origin_hhf" | "items">) {
  const url = deliveryOrderUrl(order.public_token);
  const works = worksForSkus(order.items.map(item => item.sku));
  const products = order.items.map(item => item.product_name);
  const titles = works.map(work => `${work.title} — ${work.author}`);
  const thanks = order.origin_hhf ? "Thank you. Make a Difference Today." : "Thank you for your purchase.";
  return {
    subject: `Your e-books — ${order.order_number}`,
    text: ["Your payment is confirmed. Your e-books are ready.", "", ...products,
      "", ...titles.map(title => `• ${title}`), "", `View your order and download: ${url}`, "", thanks].join("\n"),
    html: `<p>Your payment is confirmed. Your e-books are ready.</p><ul>${products.map(title => `<li>${escapeHtml(title)}</li>`).join("")}</ul>` +
      `<ul>${titles.map(title => `<li>${escapeHtml(title)}</li>`).join("")}</ul>` +
      `<p><a href="${escapeHtml(url)}">View order and Download</a></p><p>${escapeHtml(thanks)}</p>`,
  };
}

/**
 * Invoked only after the verified webhook has committed PAID. Provider
 * idempotency protects concurrent dispatch; the persisted timestamp suppresses
 * later repeats. Failures use the existing Stripe webhook replay, no scheduler.
 */
export async function sendDeliveryEmailForOrder(orderId: string, storeId: string) {
  const { data: order, error } = await one<DeliveryOrder>(sql`
    select o.id, o.status, o.order_number, o.public_token, o.origin_hhf,
      o.delivery_email_sent_at, o.checkout_customer_details, c.email as customer_email,
      coalesce((select jsonb_agg(jsonb_build_object('product_name', i.product_name, 'sku', i.sku))
        from public.order_items i where i.order_id = o.id), '[]'::jsonb) as items
    from public.orders o left join public.customers c on c.id = o.customer_id
    where o.id = ${orderId} and o.store_id = ${storeId}
  `, true);
  if (error) throw new Error("Delivery order lookup failed.");
  if (!order || order.status !== "PAID") return { skipped: "not_paid" };
  if (order.delivery_email_sent_at) return { skipped: "already_sent" };
  if (!worksForSkus(order.items.map(item => item.sku)).length) return { skipped: "no_ebooks" };
  const details = normalizeCheckoutCustomerDetails(order.checkout_customer_details);
  const recipient = details ? details.email : order.customer_email?.trim().toLowerCase();
  if (!recipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
    console.warn("[ebook-delivery] missing_email", { orderId });
    return { skipped: "missing_email" };
  }
  const apiKey = process.env["RESEND_API_KEY"];
  const from = process.env["DELIVERY_EMAIL_FROM"];
  if (!apiKey || !from) {
    console.warn("[ebook-delivery] not_configured", { orderId });
    return { skipped: "not_configured" };
  }
  let response: Response;
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST", signal: AbortSignal.timeout(10000),
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json",
        "Idempotency-Key": `ebook-delivery/${order.id}` },
      body: JSON.stringify({ from, to: [recipient], ...buildDeliveryEmail(order) }),
    });
  } catch { throw new Error("E-book delivery provider unavailable."); }
  if (!response.ok) throw new Error(`E-book delivery provider HTTP ${response.status}.`);
  const result = await response.json().catch(() => null) as { id?: unknown } | null;
  if (!result || typeof result.id !== "string" || !result.id) throw new Error("E-book delivery provider returned no message ID.");
  const saved = await exec(sql`update public.orders set delivery_email_sent_at = coalesce(delivery_email_sent_at, now())
    where id = ${order.id} and store_id = ${storeId} and status = 'PAID'`);
  if (saved.error) throw new Error("E-book delivery confirmation could not be saved.");
  console.info("[ebook-delivery] accepted", { orderId, messageId: result.id });
  return { sent: true };
}
