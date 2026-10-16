import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { HHB_STORE_SLUG } from "@/lib/catalog/hhb";
import { purchaseProduct, safePurchaseCheckoutUrl } from "@/lib/catalog/purchase";
import { createOrder, buildItemsMetadata, pickOperationalMetadata } from "./orders.server";
import { StripeService, type StripeParams } from "./stripe.server";
import { resolveStoreStripeCredentials, resolveIntegrationStripeCredentials } from "./stripe-credentials.server";
import { logCheckoutFailure, type CheckoutFailureStage } from "./checkout-diagnostics.server";
import { PaymentError } from "./errors";
import type { Database } from "@/integrations/supabase/types";

type Product = Database["public"]["Tables"]["products"]["Row"];
type Order = Database["public"]["Tables"]["orders"]["Row"];

export function buildPurchaseSessionRequest(order: Order, product: Product, origin: string): StripeParams {
  const metadata = pickOperationalMetadata({
    store_id: order.store_id, order_id: order.id, order_number: order.order_number,
    environment: order.environment,
    ...buildItemsMetadata([{ product_id: product.id, product_name: product.name, sku: product.sku, quantity: 1 }], [product]),
  });
  return {
    mode: "payment", submit_type: "pay", client_reference_id: order.id,
    success_url: `${origin}/order/${order.public_token}`,
    cancel_url: `${origin}/order/${order.public_token}`,
    metadata, payment_intent_data: { metadata, description: `Order ${order.order_number}` },
    line_items: [{ quantity: 1, price_data: { currency: order.currency.toLowerCase(), unit_amount: order.total_cents,
      product_data: { name: product.name, description: product.description ?? undefined } } }],
  };
}

export async function startPurchase(slug: string, origin: string, publicToken?: string) {
  let operation = "startPurchase.catalog";
  let stage: CheckoutFailureStage = "db_unreachable";
  try {
    const expected = purchaseProduct(slug);
    if (!expected) throw new PaymentError("NOT_FOUND", "Book not found.");
    operation = "startPurchase.store_lookup";
    const storeResult = await supabaseAdmin.from("stores").select("*").eq("slug", HHB_STORE_SLUG).maybeSingle();
    if (storeResult.error) throw storeResult.error;
    const store = storeResult.data;
    stage = "no_stripe_integration";
    if (!store || store.status !== "ACTIVE") throw new PaymentError("CONFIG_ERROR", "The store is not ready for checkout.");
    operation = "startPurchase.product_and_integration_lookup";
    stage = "db_unreachable";
    const [productResult, integrationResult] = await Promise.all([
      supabaseAdmin.from("products").select("*").eq("store_id", store.id).eq("id", expected.id).maybeSingle(),
      store.stripe_integration_id
        ? supabaseAdmin.from("stripe_integrations").select("*").eq("id", store.stripe_integration_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
    if (productResult.error) throw productResult.error;
    if (integrationResult.error) throw integrationResult.error;
    const product = productResult.data;
    operation = "startPurchase.product_validation";
    if (!product || !product.active || product.weight_grams !== 0 || product.sku !== expected.sku || product.currency !== "USD" || product.price_cents !== expected.priceCents) {
      throw new PaymentError("CONFIG_ERROR", "This ebook is unavailable.");
    }
    operation = "startPurchase.stripe_credentials";
    stage = "no_stripe_integration";
    const credentials = await resolveStoreStripeCredentials(store, integrationResult.data);
    const stripe = new StripeService(credentials.secretKey);
    // Apenas o Pixel ID público (seguro para o navegador); o token nunca sai do servidor.
    const { getPublicMetaConfig } = await import("@/lib/meta/config.server");
    const meta = await getPublicMetaConfig(store.id).catch(() => ({ pixelId: null }));
    const tracking = {
      metaPixelId: meta.pixelId,
      product: { id: product.id, name: product.name, priceCents: product.price_cents, currency: product.currency },
    };
    if (publicToken) {
      operation = "startPurchase.order_lookup"; stage = "db_unreachable";
      const { data: order, error } = await supabaseAdmin.from("orders").select("*, order_items(product_id, quantity)").eq("store_id", store.id).eq("public_token", publicToken).maybeSingle();
      if (error) throw error;
      if (!order || order.environment !== store.environment || order.order_items.length !== 1 || order.order_items[0]?.product_id !== product.id || order.order_items[0]?.quantity !== 1 || order.total_cents !== product.price_cents) throw new PaymentError("NOT_FOUND", "Order not found.");
      if (!["PENDING_PAYMENT", "PAYMENT_PROCESSING"].includes(order.status)) return { publicToken, receipt: true as const };
      operation = "startPurchase.saved_session_lookup";
      const { data: saved, error: savedError } = await supabaseAdmin.from("stripe_checkout_sessions").select("*").eq("order_id", order.id).eq("integration_id", credentials.integrationId).maybeSingle();
      if (savedError) throw savedError;
      if (!saved) throw new PaymentError("INVALID_STATE", "Checkout could not be resumed.");
      operation = "startPurchase.session_retrieve"; stage = "stripe_error";
      const session = await stripe.retrieveCheckoutSession(saved.session_id);
      operation = "startPurchase.session_validation";
      if (session.livemode !== (store.environment === "live") || session.metadata?.["order_id"] !== order.id) throw new PaymentError("INVALID_STATE", "Checkout binding mismatch.");
      if (session.status !== "open" || session.expires_at * 1000 <= Date.now()) return { publicToken, receipt: true as const };
      return { publicToken, url: safePurchaseCheckoutUrl(session.url), ...tracking };
    }
    operation = "startPurchase.order_create"; stage = "db_unreachable";
    const result = await createOrder({ store, items: [{ productId: product.id, quantity: 1 }], collectCustomerAtCheckout: true, shippingOptionId: "no-shipping" });
    const order = result.order;
    const key = `ebook-checkout:${order.id}:1`;
    operation = "startPurchase.payment_insert";
    const { data: payment, error: paymentError } = await supabaseAdmin.from("payments").insert({
      store_id: store.id, order_id: order.id, integration_id: credentials.integrationId, environment: store.environment,
      amount_cents: order.total_cents, currency: order.currency, attempt: 1, idempotency_key: key,
    }).select("id").single();
    if (paymentError) throw paymentError;
    if (!payment) throw new PaymentError("INVALID_STATE", "Could not prepare payment.");
    operation = "startPurchase.session_create"; stage = "stripe_error";
    const session = await stripe.createCheckoutSession(buildPurchaseSessionRequest(order, product, origin), key);
    operation = "startPurchase.session_validation";
    if (session.livemode !== (store.environment === "live") || session.metadata?.["order_id"] !== order.id || session.status !== "open") throw new PaymentError("INVALID_STATE", "Checkout binding mismatch.");
    const url = safePurchaseCheckoutUrl(session.url);
    operation = "startPurchase.session_insert"; stage = "db_unreachable";
    const saved = await supabaseAdmin.from("stripe_checkout_sessions").insert({ store_id: store.id, order_id: order.id, integration_id: credentials.integrationId,
      session_id: session.id, status: session.status, base_amount_cents: order.total_cents, base_currency: order.currency,
      expires_at: new Date(session.expires_at * 1000).toISOString(), payment_intent_id: session.payment_intent });
    if (saved.error) throw saved.error;
    if (session.payment_intent) {
      operation = "startPurchase.payment_binding";
      const linked = await supabaseAdmin.from("payments").update({ provider_payment_id: session.payment_intent }).eq("id", payment.id);
      if (linked.error) throw linked.error;
    }
    return { publicToken: order.public_token, url, ...tracking };
  } catch (error) {
    logCheckoutFailure(error, operation, stage);
    throw error;
  }
}

/** Called only inside the already signature-verified ebook webhook pipeline. */
export async function bindPurchaseIntent(object: Record<string, unknown>, ctx?: { integrationId: string; livemode: boolean }) {
  const metadata = object["metadata"] as Record<string, string> | undefined;
  if (!ctx || !metadata?.["order_id"] || typeof object["id"] !== "string") return null;
  const { data: saved, error } = await supabaseAdmin.from("stripe_checkout_sessions").select("*").eq("order_id", metadata["order_id"]).eq("integration_id", ctx.integrationId).maybeSingle();
  if (error) throw new Error("Checkout binding lookup failed.");
  if (!saved) return null;
  const credentials = await resolveIntegrationStripeCredentials(ctx.integrationId);
  if ((credentials.environment === "live") !== ctx.livemode) throw new Error("Checkout integration mismatch.");
  const stripe = new StripeService(credentials.secretKey);
  const session = await stripe.retrieveCheckoutSession(saved.session_id);
  if (session.payment_intent !== object["id"] || session.livemode !== ctx.livemode || session.metadata?.["order_id"] !== saved.order_id || object["amount"] !== saved.base_amount_cents || object["currency"] !== saved.base_currency.toLowerCase()) throw new Error("Checkout payment mismatch.");
  const { data: payment, error: paymentError } = await supabaseAdmin.from("payments").select("*").eq("order_id", saved.order_id).eq("integration_id", ctx.integrationId).eq("idempotency_key", `ebook-checkout:${saved.order_id}:1`).maybeSingle();
  if (paymentError || !payment || payment.environment !== credentials.environment || (payment.provider_payment_id && payment.provider_payment_id !== object["id"])) throw new Error("Local checkout payment mismatch.");
  const linked = await supabaseAdmin.from("payments").update({ provider_payment_id: object["id"] }).eq("id", payment.id);
  if (linked.error) throw new Error("Checkout payment binding failed.");
  return { ...payment, provider_payment_id: object["id"] };
}