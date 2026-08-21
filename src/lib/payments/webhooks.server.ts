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
      if (!payment) return "Pagamento não encontrado localmente (ignorado).";
      if (payment.status === "SUCCEEDED") return "Já processado.";
      const charges = object["charges"] as { data?: Array<Record<string, unknown>> } | undefined;
      const method = charges?.data?.[0]?.["payment_method_details"] as
        | { type?: string }
        | undefined;
      await supabaseAdmin
        .from("payments")
        .update({ status: "SUCCEEDED", payment_method: method?.type ?? null })
        .eq("id", payment.id);
      await markOrder(payment.order_id, "PAID");
      await supabaseAdmin.rpc("commit_order_stock", { _order_id: payment.order_id });
      await logEvent(payment, "PAYMENT_SUCCEEDED", "Pagamento confirmado pela Stripe");
      await trackPayment(payment, "payment_succeeded", { paymentMethod: method?.type ?? null });
      return "Pagamento confirmado.";
    }
    case "payment_intent.payment_failed": {
      const payment = await findPayment(String(object["id"]));
      if (!payment) return "Pagamento não encontrado localmente (ignorado).";
      const lastError = object["last_payment_error"] as { message?: string } | null;
      await supabaseAdmin
        .from("payments")
        .update({ status: "FAILED", last_error: lastError?.message ?? null })
        .eq("id", payment.id);
      await markOrder(payment.order_id, "PAYMENT_FAILED");
      await supabaseAdmin.rpc("release_order_stock", { _order_id: payment.order_id });
      await logEvent(payment, "PAYMENT_FAILED", "Pagamento recusado");
      await trackPayment(payment, "payment_failed", {
        declineCode: (object["last_payment_error"] as { decline_code?: string; code?: string } | null)?.decline_code ??
          (object["last_payment_error"] as { code?: string } | null)?.code ??
          null,
      });
      return "Pagamento recusado.";
    }
    case "payment_intent.canceled": {
      const payment = await findPayment(String(object["id"]));
      if (!payment) return "Pagamento não encontrado localmente (ignorado).";
      await supabaseAdmin.from("payments").update({ status: "CANCELLED" }).eq("id", payment.id);
      await markOrder(payment.order_id, "CANCELLED");
      await supabaseAdmin.rpc("release_order_stock", { _order_id: payment.order_id });
      await logEvent(payment, "PAYMENT_CANCELLED", "Pagamento cancelado");
      await trackPayment(payment, "payment_canceled");
      return "Pagamento cancelado.";
    }
    case "charge.refunded": {
      const intentId = object["payment_intent"];
      if (typeof intentId !== "string") return "Evento sem payment_intent (ignorado).";
      const payment = await findPayment(intentId);
      if (!payment) return "Pagamento não encontrado localmente (ignorado).";
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
      await logEvent(payment, "REFUND_APPLIED", fully ? "Reembolso total" : "Reembolso parcial");
      return "Reembolso registrado.";
    }
    case "charge.dispute.created": {
      const intentId = object["payment_intent"];
      if (typeof intentId !== "string") return "Evento sem payment_intent (ignorado).";
      const payment = await findPayment(intentId);
      if (!payment) return "Pagamento não encontrado localmente (ignorado).";
      await logEvent(payment, "DISPUTE_OPENED", "Disputa/chargeback aberto");
      return "Disputa registrada.";
    }
    default:
      return "Evento não tratado.";
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
    throw new PaymentError("CONFIG_ERROR", "Webhook não configurado para esta integração.");
  }

  const secret = await decryptSecret(integration.webhook_secret_ciphertext);
  const event = await constructStripeEvent(input.rawBody, input.signature, secret);

  const expectedLive = integration.environment === "live";
  if (event.livemode !== expectedLive) {
    throw new PaymentError("FORBIDDEN", "Ambiente do evento não corresponde à integração.");
  }

  const { error: insertError } = await supabaseAdmin.from("webhook_events").insert({
    stripe_event_id: event.id,
    event_type: event.type,
    livemode: event.livemode,
    integration_id: integration.id,
    payload_summary: { object_id: (event.data.object as { id?: string }).id ?? null } as never,
  });

  if (insertError) {
    // Violação da UNIQUE(provider, stripe_event_id): evento duplicado.
    return { status: 200, body: { received: true, duplicate: true } };
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
