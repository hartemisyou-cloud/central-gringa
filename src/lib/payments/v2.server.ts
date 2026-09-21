import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { PaymentError } from "./errors";
import type { StoreRow } from "./store-auth.server";
import type { Database } from "@/integrations/supabase/types";

/**
 * Camada Checkout V2 (PREVIEW/TESTE) — aditiva e isolada.
 *
 * Reutiliza a mesma autenticação (`withStore`), a mesma resolução de loja e os
 * mesmos serviços internos de pagamento do V1. Nada aqui altera o contrato,
 * o comportamento ou as respostas dos endpoints `/api/public/v1/*`.
 */

type IntegrationRow = Database["public"]["Tables"]["stripe_integrations"]["Row"];

/**
 * Bootstrap READ-ONLY: só consulta. Não cria pedido, não reserva estoque,
 * não cria PaymentIntent, não dispara Meta/UTMify, não grava nada.
 */
export async function bootstrapCheckoutV2(input: { store: StoreRow; sku: string }) {
  const sku = input.sku.trim();
  if (!sku) throw new PaymentError("INVALID_INPUT", "SKU obrigatório.");

  const { data: product } = await supabaseAdmin
    .from("products")
    .select("id, name, sku, price_cents, currency, stock, reserved_stock, active")
    .eq("store_id", input.store.id)
    .eq("sku", sku)
    .maybeSingle();

  if (!product) throw new PaymentError("SKU_NOT_FOUND", "SKU não encontrado para esta loja.");

  const available = product.active === true && product.stock - product.reserved_stock > 0;
  if (!available) {
    return { sku: product.sku, available: false as const };
  }

  // Publishable key resolvida dinamicamente: loja -> integração Stripe ACTIVE
  // do mesmo ambiente. Nenhuma chave é hardcodada.
  if (!input.store.stripe_integration_id) {
    throw new PaymentError("CONFIG_ERROR", "Loja sem integração de pagamento configurada.");
  }
  const { data: integrationRow } = await supabaseAdmin
    .from("stripe_integrations")
    .select("id, status, environment, publishable_key")
    .eq("id", input.store.stripe_integration_id)
    .maybeSingle();

  const integration = integrationRow as Pick<
    IntegrationRow,
    "id" | "status" | "environment" | "publishable_key"
  > | null;

  if (!integration) throw new PaymentError("CONFIG_ERROR", "Integração de pagamento não encontrada.");
  if (integration.status !== "ACTIVE") {
    throw new PaymentError("CONFIG_ERROR", "Integração de pagamento inativa.");
  }
  if (integration.environment !== input.store.environment) {
    throw new PaymentError(
      "CONFIG_ERROR",
      "Ambiente da loja e da integração divergem (test/live não podem se misturar).",
    );
  }

  // Somente dados públicos. Nunca secret key, webhook secret, api key ou client_secret.
  return {
    sku: product.sku,
    productId: product.id,
    name: product.name,
    amount: product.price_cents,
    currency: product.currency.toLowerCase(),
    available: true as const,
    publishableKey: integration.publishable_key,
  };
}

/** Status normalizado esperado pelo Checkout V2 (não altera o banco). */
export type CheckoutV2Status =
  | "PENDING_PAYMENT"
  | "PAYMENT_PROCESSING"
  | "PAID"
  | "PAYMENT_FAILED"
  | "EXPIRED";

function normalizeStatusV2(internal: string): CheckoutV2Status {
  switch (internal) {
    case "PAID":
    case "REFUNDED":
    case "PARTIALLY_REFUNDED":
      return "PAID";
    case "PAYMENT_PROCESSING":
      return "PAYMENT_PROCESSING";
    case "PAYMENT_FAILED":
      return "PAYMENT_FAILED";
    case "CANCELLED":
      return "EXPIRED";
    default:
      return "PENDING_PAYMENT";
  }
}

/**
 * Status V2: lê APENAS o banco da Central. Nunca consulta a Stripe.
 * O webhook Stripe existente continua sendo a única fonte de atualização.
 */
export async function getCheckoutV2Status(input: { store: StoreRow; publicToken: string }) {
  const { data: order } = await supabaseAdmin
    .from("orders")
    .select("id, order_number, status, currency, total_cents")
    .eq("public_token", input.publicToken)
    .eq("store_id", input.store.id) // isolamento entre lojas (anti-IDOR)
    .maybeSingle();

  if (!order) throw new PaymentError("NOT_FOUND", "Pedido não encontrado.");

  const { data: payment } = await supabaseAdmin
    .from("payments")
    .select("status")
    .eq("order_id", order.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return {
    orderNumber: order.order_number,
    status: normalizeStatusV2(order.status),
    paymentStatus: payment?.status ?? null,
    amount: order.total_cents,
    currency: order.currency.toLowerCase(),
  };
}
