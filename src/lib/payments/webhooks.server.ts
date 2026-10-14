import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { PaymentError } from "./errors";
import { decryptSecret } from "./crypto.server";
import { constructStripeEvent, type StripeEvent } from "./stripe.server";
import type { Database } from "@/integrations/supabase/types";

type PaymentRow = Database["public"]["Tables"]["payments"]["Row"];

async function markOrder(orderId: string, status: Database["public"]["Enums"]["order_status"]) {
  const patch: Database["public"]["Tables"]["orders"]["Update"] = { status };
  if (status === "PAID") patch.paid_at = new Date().toISOString();
  await supabaseAdmin.from("orders").update(patch).eq("id", orderId);
}


async function logEvent(payment: PaymentRow, type: string, message: string) {
  await supabaseAdmin.from("payment_events").insert({
    payment_id: payment.id,
    order_id: payment.order_id,
    type,
    message,
    metadata: {} as never,
  });
}

/** Espelha o estado financeiro definitivo no analytics (fonte: servidor). */
async function trackPayment(
  payment: PaymentRow,
  type: "payment_succeeded" | "payment_failed" | "payment_canceled",
  extra: { paymentMethod?: string | null; declineCode?: string | null } = {},
) {
  const { recordServerEvent } = await import("@/lib/analytics/ingest.server");
  await recordServerEvent({
    eventId: `${type}:${payment.id}`,
    type,
    storeId: payment.store_id,
    integrationId: payment.integration_id,
    orderId: payment.order_id,
    paymentIntentId: payment.provider_payment_id,
    paymentMethod: extra.paymentMethod ?? payment.payment_method,
    currency: payment.currency,
    amountCents: payment.amount_cents,
    declineCode: extra.declineCode ?? null,
  });
}

async function findPayment(providerPaymentId: string): Promise<PaymentRow | null> {
  const { data } = await supabaseAdmin
    .from("payments")
    .select("*")
    .eq("provider", "STRIPE")
    .eq("provider_payment_id", providerPaymentId)
    .maybeSingle();
  return data;
}

async function applyEvent(event: StripeEvent): Promise<string> {
  const object = event.data.object as Record<string, unknown>;

  switch (event.type) {
    case "payment_intent.succeeded": {
      const payment = await findPayment(String(object["id"]));
      if (!payment) return "Payment not found locally (ignored).";
      const charges = object["charges"] as { data?: Array<Record<string, unknown>> } | undefined;
      const method = charges?.data?.[0]?.["payment_method_details"] as
        | { type?: string }
        | undefined;
      // Every step below is idempotent so a retried event (after a partial
      // failure) completes the remaining steps instead of being skipped.
      if (payment.status !== "SUCCEEDED") {
        await supabaseAdmin
          .from("payments")
          .update({ status: "SUCCEEDED", payment_method: method?.type ?? null })
          .eq("id", payment.id);
      }
      const { data: order } = await supabaseAdmin
        .from("orders")
        .select("status, stock_committed")
        .eq("id", payment.order_id)
        .maybeSingle();
      if (order && order.status !== "PAID") await markOrder(payment.order_id, "PAID");
      if (order && !order.stock_committed) {
        await supabaseAdmin.rpc("commit_order_stock", { _order_id: payment.order_id });
      }
      if (payment.status !== "SUCCEEDED") {
        await logEvent(payment, "PAYMENT_SUCCEEDED", "Payment confirmed by Stripe");
        await trackPayment(payment, "payment_succeeded", { paymentMethod: method?.type ?? null });
      }
      // Ebook delivery is gated on orders.status = PAID (see fulfillment.server.ts):
      // no extra write is needed, so delivery is naturally idempotent.
      // Meta CAPI / UTMify keep their own idempotency keys and never affect payment state.
      try {
        const { sendPurchaseForOrder } = await import("@/lib/meta/capi.server");
        await sendPurchaseForOrder({ orderId: payment.order_id, storeId: payment.store_id });
      } catch (error) {
        console.error("[meta-capi] purchase dispatch failed", (error as Error).message);
      }
      try {
        const { sendSaleForOrder } = await import("@/lib/utmify/api.server");
        await sendSaleForOrder({ orderId: payment.order_id, storeId: payment.store_id });
      } catch (error) {
        console.error("[utmify] sale dispatch failed", (error as Error).message);
      }
      return "Payment confirmed.";
    }
    case "payment_intent.payment_failed": {
      const payment = await findPayment(String(object["id"]));
      if (!payment) return "Payment not found locally (ignored).";
      const lastError = object["last_payment_error"] as { message?: string } | null;
      await supabaseAdmin
        .from("payments")
        .update({ status: "FAILED", last_error: lastError?.message ?? null })
        .eq("id", payment.id);
      if (payment.status === "SUCCEEDED") return "Late failure after success (ignored).";
      await markOrder(payment.order_id, "PAYMENT_FAILED");
      await supabaseAdmin.rpc("release_order_stock", { _order_id: payment.order_id });
      await logEvent(payment, "PAYMENT_FAILED", "Payment declined");
      await trackPayment(payment, "payment_failed", {
        declineCode: (object["last_payment_error"] as { decline_code?: string; code?: string } | null)?.decline_code ??
          (object["last_payment_error"] as { code?: string } | null)?.code ??
          null,
      });
      return "Payment declined.";
    }
    case "payment_intent.canceled": {
      const payment = await findPayment(String(object["id"]));
      if (!payment) return "Payment not found locally (ignored).";
      if (payment.status === "SUCCEEDED") return "Late cancel after success (ignored).";
      await supabaseAdmin.from("payments").update({ status: "CANCELLED" }).eq("id", payment.id);
      await markOrder(payment.order_id, "CANCELLED");
      await supabaseAdmin.rpc("release_order_stock", { _order_id: payment.order_id });
      await logEvent(payment, "PAYMENT_CANCELLED", "Payment cancelled");
      await trackPayment(payment, "payment_canceled");
      return "Payment cancelled.";
    }
    case "charge.refunded": {
      const intentId = object["payment_intent"];
      if (typeof intentId !== "string") return "Event without payment_intent (ignored).";
      const payment = await findPayment(intentId);
      if (!payment) return "Payment not found locally (ignored).";
      const refunded = Number(object["amount_refunded"] ?? 0);
      const fully = refunded >= payment.amount_cents;
      await supabaseAdmin
        .from("payments")
        .update({
          refunded_cents: refunded,
          status: fully ? "REFUNDED" : "PARTIALLY_REFUNDED",
        })
        .eq("id", payment.id);
      await markOrder(payment.order_id, fully ? "REFUNDED" : "PARTIALLY_REFUNDED");
      await supabaseAdmin
        .from("refunds")
        .update({ status: "SUCCEEDED" })
        .eq("payment_id", payment.id)
        .eq("status", "PENDING");
      await logEvent(payment, "REFUND_APPLIED", fully ? "Full refund" : "Partial refund");
      return "Refund recorded.";
    }
    case "charge.dispute.created": {
      const intentId = object["payment_intent"];
      if (typeof intentId !== "string") return "Event without payment_intent (ignored).";
      const payment = await findPayment(intentId);
      if (!payment) return "Payment not found locally (ignored).";
      await logEvent(payment, "DISPUTE_OPENED", "Dispute/chargeback opened");
      return "Dispute recorded.";
    }
    default:
      return "Unhandled event.";
  }
}

/**
 * Pipeline do webhook: assinatura -> deduplicação -> registro -> processamento.
 * O corpo RAW nunca é parseado antes da verificação da assinatura.
 */
export async function processStripeWebhook(input: {
  integrationId: string;
  rawBody: string;
  signature: string | null;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  const { data: integration } = await supabaseAdmin
    .from("stripe_integrations")
    .select("id, environment, webhook_secret_ciphertext")
    .eq("id", input.integrationId)
    .maybeSingle();

  if (!integration?.webhook_secret_ciphertext) {
    throw new PaymentError("CONFIG_ERROR", "Webhook not configured for this integration.");
  }

  const secret = await decryptSecret(integration.webhook_secret_ciphertext);
  const event = await constructStripeEvent(input.rawBody, input.signature, secret);

  const expectedLive = integration.environment === "live";
  if (event.livemode !== expectedLive) {
    throw new PaymentError("FORBIDDEN", "Event environment does not match the integration.");
  }

  const { error: insertError } = await supabaseAdmin.from("webhook_events").insert({
    stripe_event_id: event.id,
    event_type: event.type,
    livemode: event.livemode,
    integration_id: integration.id,
    payload_summary: { object_id: (event.data.object as { id?: string }).id ?? null } as never,
  });

  if (insertError) {
    // UNIQUE(provider, stripe_event_id): seen before. Only skip when it was
    // actually processed; FAILED (or stuck RECEIVED) events are retried so a
    // transient error never loses a payment confirmation.
    const { data: existing } = await supabaseAdmin
      .from("webhook_events")
      .select("processing_status, received_at")
      .eq("provider", "STRIPE")
      .eq("stripe_event_id", event.id)
      .maybeSingle();
    if (!shouldReprocess(existing)) {
      return { status: 200, body: { received: true, duplicate: true } };
    }
    await supabaseAdmin
      .from("webhook_events")
      .update({ processing_status: "RECEIVED", error_message: null })
      .eq("stripe_event_id", event.id);
  }

  try {
    const message = await applyEvent(event);
    await supabaseAdmin
      .from("webhook_events")
      .update({
        processed: true,
        processing_status: "PROCESSED",
        processed_at: new Date().toISOString(),
        error_message: message,
      })
      .eq("stripe_event_id", event.id);
    return { status: 200, body: { received: true } };
  } catch (error) {
    await supabaseAdmin
      .from("webhook_events")
      .update({
        processing_status: "FAILED",
        processed_at: new Date().toISOString(),
        error_message: (error as Error).message.slice(0, 500),
      })
      .eq("stripe_event_id", event.id);
    throw error;
  }
}

/** Decides whether an already-recorded event must be processed again. */
export function shouldReprocess(
  existing: { processing_status: string; received_at: string } | null,
  now: number = Date.now(),
): boolean {
  if (!existing) return true;
  if (existing.processing_status === "FAILED") return true;
  if (existing.processing_status === "RECEIVED") {
    // Another delivery may still be in flight; retry only once it looks stuck.
    return now - new Date(existing.received_at).getTime() > 2 * 60 * 1000;
  }
  return false;
}
