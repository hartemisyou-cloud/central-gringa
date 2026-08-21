import { z } from "zod";

/**
 * Vocabulário de eventos de analytics da Central.
 * Eventos de UX vêm do checkout; eventos financeiros definitivos vêm do
 * servidor/webhook da Stripe (ver `source`).
 */
export const EVENT_TYPES = [
  "checkout_viewed",
  "checkout_started",
  "payment_method_selected",
  "express_checkout_displayed",
  "apple_pay_available",
  "apple_pay_selected",
  "apple_pay_clicked",
  "apple_pay_success",
  "apple_pay_failed",
  "google_pay_available",
  "google_pay_selected",
  "google_pay_clicked",
  "google_pay_success",
  "google_pay_failed",
  "link_available",
  "link_unavailable",
  "link_selected",
  "link_clicked",
  "link_success",
  "link_failed",
  "card_selected",
  "payment_submitted",
  "payment_intent_created",
  "payment_processing",
  "payment_requires_action",
  "authentication_started",
  "authentication_succeeded",
  "authentication_failed",
  "payment_succeeded",
  "payment_failed",
  "payment_canceled",
  "payment_error",
  "checkout_abandoned",
  "webhook_received",
] as const;

export type AnalyticsEventType = (typeof EVENT_TYPES)[number];

/** Eventos que só podem ser gravados pelo servidor (estado financeiro). */
export const SERVER_ONLY_EVENTS: ReadonlySet<string> = new Set([
  "payment_succeeded",
  "payment_failed",
  "payment_canceled",
  "payment_intent_created",
  "webhook_received",
]);

export const clientEventSchema = z.object({
  eventId: z.string().min(8).max(80),
  type: z.enum(EVENT_TYPES),
  occurredAt: z.string().datetime().optional(),
  paymentMethod: z.string().max(40).optional(),
  errorCode: z.string().max(60).optional(),
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});

export const ingestSchema = z.object({
  publicToken: z.string().min(8).max(128).optional(),
  storeSlug: z.string().min(2).max(80).optional(),
  anonymousSessionId: z.string().min(8).max(80),
  checkoutSessionId: z.string().min(8).max(80),
  referrer: z.string().max(500).optional(),
  utm: z
    .object({
      source: z.string().max(120).optional(),
      medium: z.string().max(120).optional(),
      campaign: z.string().max(120).optional(),
      term: z.string().max(120).optional(),
      content: z.string().max(120).optional(),
    })
    .optional(),
  events: z.array(clientEventSchema).min(1).max(30),
});

export type IngestPayload = z.infer<typeof ingestSchema>;

/** Agrupamento de recusas exigido pelo relatório de declines. */
export function declineCategory(code: string | null | undefined): string {
  if (!code) return "other";
  const c = code.toLowerCase();
  if (["lost_card", "stolen_card", "fraudulent", "pickup_card", "do_not_honor"].includes(c)) {
    return "hard_decline";
  }
  if (
    ["insufficient_funds", "card_declined", "generic_decline", "try_again_later", "withdrawal_count_limit_exceeded"].includes(c)
  ) {
    return "soft_decline";
  }
  if (["authentication_required", "incorrect_cvc", "invalid_cvc", "expired_card", "incorrect_number"].includes(c)) {
    return "authentication_failure";
  }
  if (["processing_error", "api_error", "rate_limit"].includes(c)) return "processing_failure";
  return "other";
}
