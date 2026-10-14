import { PaymentError } from "./errors";
import { decryptSecret } from "./crypto.server";
import { StripeService } from "./stripe.server";
import type { Database } from "@/integrations/supabase/types";

export type IntegrationRow = Database["public"]["Tables"]["stripe_integrations"]["Row"];
export type PaymentEnvironment = Database["public"]["Enums"]["payment_environment"];

export interface CreatePaymentInput {
  amountCents: number;
  currency: string;
  metadata: Record<string, string>;
  description?: string;
  receiptEmail?: string;
  idempotencyKey: string;
  paymentMethodConfiguration?: string;
}

export interface ProviderPayment {
  providerPaymentId: string;
  clientSecret: string | null;
  status: string;
  amountCents: number;
  currency: string;
  livemode: boolean;
}

export interface ProviderRefund {
  providerRefundId: string;
  status: string;
  amountCents: number;
}

/**
 * Contrato genérico de provedor de pagamento.
 * Pedidos, itens e estoque não conhecem "Stripe" — apenas este contrato.
 * Novos provedores (Mercado Pago, Pagar.me, Asaas) implementam esta interface.
 */
export interface PaymentProvider {
  readonly name: Database["public"]["Enums"]["payment_provider"];
  createPayment(input: CreatePaymentInput): Promise<ProviderPayment>;
  retrievePayment(providerPaymentId: string): Promise<ProviderPayment>;
  cancelPayment(providerPaymentId: string): Promise<ProviderPayment>;
  refundPayment(input: {
    providerPaymentId: string;
    amountCents?: number;
    reason?: string;
    idempotencyKey: string;
  }): Promise<ProviderRefund>;
}

export class StripePaymentProvider implements PaymentProvider {
  readonly name = "STRIPE" as const;
  private readonly stripe: StripeService;

  constructor(stripe: StripeService) {
    this.stripe = stripe;
  }

  async createPayment(input: CreatePaymentInput): Promise<ProviderPayment> {
    const intent = await this.stripe.createPaymentIntent(
      {
        amount: input.amountCents,
        currency: input.currency,
        metadata: input.metadata,
        ...(input.description ? { description: input.description } : {}),
        ...(input.receiptEmail ? { receipt_email: input.receiptEmail } : {}),
        ...(input.paymentMethodConfiguration
          ? { paymentMethodConfiguration: input.paymentMethodConfiguration }
          : {}),
      },
      input.idempotencyKey,
    );
    return {
      providerPaymentId: intent.id,
      clientSecret: intent.client_secret ?? null,
      status: intent.status,
      amountCents: intent.amount,
      currency: intent.currency,
      livemode: intent.livemode,
    };
  }

  async retrievePayment(providerPaymentId: string): Promise<ProviderPayment> {
    const intent = await this.stripe.retrievePaymentIntent(providerPaymentId);
    return {
      providerPaymentId: intent.id,
      clientSecret: intent.client_secret ?? null,
      status: intent.status,
      amountCents: intent.amount,
      currency: intent.currency,
      livemode: intent.livemode,
    };
  }

  async cancelPayment(providerPaymentId: string): Promise<ProviderPayment> {
    const intent = await this.stripe.cancelPaymentIntent(providerPaymentId);
    return {
      providerPaymentId: intent.id,
      clientSecret: null,
      status: intent.status,
      amountCents: intent.amount,
      currency: intent.currency,
      livemode: intent.livemode,
    };
  }

  async refundPayment(input: {
    providerPaymentId: string;
    amountCents?: number;
    reason?: string;
    idempotencyKey: string;
  }): Promise<ProviderRefund> {
    const refund = await this.stripe.refundPayment(
      {
        paymentIntentId: input.providerPaymentId,
        ...(input.amountCents ? { amount: input.amountCents } : {}),
        ...(input.reason ? { reason: input.reason } : {}),
      },
      input.idempotencyKey,
    );
    return {
      providerRefundId: refund.id,
      status: refund.status,
      amountCents: refund.amount,
    };
  }
}

/** Traduz o status do provedor para o status interno de pagamento. */
export function mapProviderStatus(
  providerStatus: string,
): Database["public"]["Enums"]["payment_status"] {
  switch (providerStatus) {
    case "succeeded":
      return "SUCCEEDED";
    case "processing":
      return "PROCESSING";
    case "canceled":
      return "CANCELLED";
    case "requires_payment_method":
    case "requires_confirmation":
    case "requires_action":
    case "requires_capture":
      return "REQUIRES_PAYMENT";
    default:
      return "REQUIRES_PAYMENT";
  }
}

export async function stripeServiceFromIntegration(
  integration: Pick<IntegrationRow, "secret_key_ciphertext" | "name">,
): Promise<StripeService> {
  if (!integration.secret_key_ciphertext) {
    throw new PaymentError("CONFIG_ERROR", "Stripe integration has no secret key configured.");
  }
  const secret = await decryptSecret(integration.secret_key_ciphertext);
  return new StripeService(secret);
}

export async function providerFromIntegration(
  integration: Pick<IntegrationRow, "secret_key_ciphertext" | "name">,
): Promise<PaymentProvider> {
  return new StripePaymentProvider(await stripeServiceFromIntegration(integration));
}
