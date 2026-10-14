import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { PaymentError } from "./errors";
import { decryptSecret } from "./crypto.server";
import { constructStripeEvent, type StripeEvent } from "./stripe.server";
import type { Database } from "@/integrations/supabase/types";

type PaymentRow = Database["public"]["Tables"]["payments"]["Row"];

/** Throws when a Supabase write/RPC failed so the event stays FAILED and Stripe retries. */
function must<T extends { error: { message: string } | null }>(result: T, what: string): T {
  if (result.error) throw new Error(`${what} failed: ${result.error.message}`);
  return result;
}

/** Payment states that later failure/cancel/success events must never undo. */
const SETTLED_AFTER_SUCCESS = new Set(["SUCCEEDED", "REFUNDED", "PARTIALLY_REFUNDED"]);
const REFUND_STATES = new Set(["REFUNDED", "PARTIALLY_REFUNDED"]);

async function markOrder(orderId: string, status: Database["public"]["Enums"]["order_status"]) {
  const patch: Database["public"]["Tables"]["orders"]["Update"] = { status };
  if (status === "PAID") patch.paid_at = new Date().toISOString();
  must(await supabaseAdmin.from("orders").update(patch).eq("id", orderId), "Order update");
}

async function rpc(name: "commit_order_stock" | "release_order_stock", orderId: string) {
  must(await supabaseAdmin.rpc(name, { _order_id: orderId }), `RPC ${name}`);
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

/** Mirrors the final financial state into analytics (server source). */
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
  const { data } = must(
    await supabaseAdmin
      .from("payments")
      .select("*")
      .eq("provider", "STRIPE")
      .eq("provider_payment_id", providerPaymentId)
      .maybeSingle(),
    "Payment lookup",
  );
  return data;
}

export async function applyEvent(event: StripeEvent): Promise<string> {
  const object = event.data.object as Record<string, unknown>;

  switch (event.type) {
    case "payment_intent.succeeded": {
      const payment = await findPayment(String(object["id"]));
      if (!payment) return "Payment not found locally (ignored).";
      // A delayed success must never undo a refund.
      if (REFUND_STATES.has(payment.status)) return "Late success after refund (ignored).";
      const charges = object["charges"] as { data?: Array<Record<string, unknown>> } | undefined;
      const method = charges?.data?.[0]?.["payment_method_details"] as
        | { type?: string }
        | undefined;
      // Every step below is idempotent so a retried event (after a partial
      // failure) completes the remaining steps instead of being skipped.
      if (payment.status !== "SUCCEEDED") {
        must(
          await supabaseAdmin
            .from("payments")
            .update({ status: "SUCCEEDED", payment_method: method?.type ?? null })
            .eq("id", payment.id),
          "Payment update",
        );
      }
      const { data: order } = must(
        await supabaseAdmin
          .from("orders")
          .select("status, stock_committed")
          .eq("id", payment.order_id)
          .maybeSingle(),
        "Order lookup",
      );
      if (!order) throw new Error("Order missing for payment.");
      if (REFUND_STATES.has(order.status)) return "Late success after refund (ignored).";
      if (order.status !== "PAID") await markOrder(payment.order_id, "PAID");
      if (!order.stock_committed) await rpc("commit_order_stock", payment.order_id);
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
      // Guard BEFORE any mutation: never overwrite success/refund/cancel records.
      if (SETTLED_AFTER_SUCCESS.has(payment.status)) return "Late failure after success (ignored).";
      if (payment.status === "CANCELLED") return "Late failure after cancel (ignored).";
      const lastError = object["last_payment_error"] as
        | { message?: string; decline_code?: string; code?: string }
        | null;
      must(
        await supabaseAdmin
          .from("payments")
          .update({ status: "FAILED", last_error: lastError?.message ?? null })
          .eq("id", payment.id),
        "Payment update",
      );
      await markOrder(payment.order_id, "PAYMENT_FAILED");
      await rpc("release_order_stock", payment.order_id);
      await logEvent(payment, "PAYMENT_FAILED", "Payment declined");
      await trackPayment(payment, "payment_failed", {
        declineCode: lastError?.decline_code ?? lastError?.code ?? null,
      });
      return "Payment declined.";
    }
    case "payment_intent.canceled": {
      const payment = await findPayment(String(object["id"]));
      if (!payment) return "Payment not found locally (ignored).";
      if (SETTLED_AFTER_SUCCESS.has(payment.status)) return "Late cancel after success (ignored).";
      must(
        await supabaseAdmin.from("payments").update({ status: "CANCELLED" }).eq("id", payment.id),
        "Payment update",
      );
      await markOrder(payment.order_id, "CANCELLED");
      await rpc("release_order_stock", payment.order_id);
      await logEvent(payment, "PAYMENT_CANCELLED", "Payment cancelled");
      await trackPayment(payment, "payment_canceled");
      return "Payment cancelled.";
    }
    case "charge.refunded": {
      const intentId = object["payment_intent"];
      if (typeof intentId !== "string") return "Event without payment_intent (ignored).";
      const payment = await findPayment(intentId);
      if (!payment) return "Payment not found locally (ignored).";
      // Out-of-order refund events never shrink an already recorded refund.
      const refunded = Math.max(Number(object["amount_refunded"] ?? 0), payment.refunded_cents ?? 0);
      const fully = refunded >= payment.amount_cents;
      must(
        await supabaseAdmin
          .from("payments")
          .update({ refunded_cents: refunded, status: fully ? "REFUNDED" : "PARTIALLY_REFUNDED" })
          .eq("id", payment.id),
        "Payment update",
      );
      await markOrder(payment.order_id, fully ? "REFUNDED" : "PARTIALLY_REFUNDED");
      must(
        await supabaseAdmin
          .from("refunds")
          .update({ status: "SUCCEEDED" })
          .eq("payment_id", payment.id)
          .eq("status", "PENDING"),
        "Refund update",
      );
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
 * Webhook pipeline: signature -> dedup -> record -> process.
 * The RAW body is never parsed before the signature is verified.
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
    if (existing?.processing_status === "PROCESSED") {
      return { status: 200, body: { received: true, duplicate: true } };
    }
    if (!shouldReprocess(existing)) {
      // Another delivery is still in flight. Answer non-2xx so Stripe retries
      // later; if that delivery crashed, the retry (after 2 min) reprocesses it.
      return { status: 409, body: { received: true, inFlight: true } };
    }
    await supabaseAdmin
      .from("webhook_events")
      .update({ processing_status: "RECEIVED", error_message: null })
      .eq("stripe_event_id", event.id);
  }

  try {
    const message = await applyEvent(event);
    // Written last: an event is PROCESSED only after every financial write succeeded.
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
