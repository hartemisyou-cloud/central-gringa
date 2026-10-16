import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { HHB_STORE_SLUG } from "@/lib/catalog/hhb";
import { purchaseProduct, safePurchaseCheckoutUrl } from "@/lib/catalog/purchase";
import { createOrder, buildItemsMetadata, pickOperationalMetadata } from "./orders.server";
import { StripeService, type StripeParams } from "./stripe.server";
import { decryptSecret } from "./crypto.server";
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
  const expected = purchaseProduct(slug);
  if (!expected) throw new PaymentError("NOT_FOUND", "Book not found.");
  const storeResult = await supabaseAdmin.from("stores").select("*").eq("slug", HHB_STORE_SLUG).maybeSingle();
  const store = storeResult.data;
  if (storeResult.error || !store || store.status !== "ACTIVE" || !store.stripe_integration_id) {
    throw new PaymentError("CONFIG_ERROR", "The store is not ready for checkout.");
  }
  const [productResult, integrationResult] = await Promise.all([
    supabaseAdmin.from("products").select("*").eq("store_id", store.id).eq("id", expected.id).maybeSingle(),
    supabaseAdmin.from("stripe_integrations").select("*").eq("id", store.stripe_integration_id).maybeSingle(),
  ]);
  const product = productResult.data;
  const integration = integrationResult.data;
  if (productResult.error || !product || !product.active || product.weight_grams !== 0 || product.sku !== expected.sku || product.currency !== "USD" || product.price_cents !== expected.priceCents) {
    throw new PaymentError("CONFIG_ERROR", "This ebook is unavailable.");
  }
  if (integrationResult.error || !integration || integration.status !== "ACTIVE" || integration.environment !== store.environment || !integration.secret_key_ciphertext || !integration.webhook_secret_ciphertext) {
    throw new PaymentError("CONFIG_ERROR", "Secure checkout is not configured yet.");
  }
  const stripe = new StripeService(await decryptSecret(integration.secret_key_ciphertext));
  // Apenas o Pixel ID público (seguro para o navegador); o token nunca sai do servidor.
  const { getPublicMetaConfig } = await import("@/lib/meta/config.server");
  const meta = await getPublicMetaConfig(store.id).catch(() => ({ pixelId: null }));
  const tracking = {
    metaPixelId: meta.pixelId,
    product: { id: product.id, name: product.name, priceCents: product.price_cents, currency: product.currency },
  };
  if (publicToken) {
    const { data: order, error } = await supabaseAdmin.from("orders").select("*, order_items(product_id, quantity)").eq("store_id", store.id).eq("public_token", publicToken).maybeSingle();
    if (error || !order || order.environment !== store.environment || order.order_items.length !== 1 || order.order_items[0]?.product_id !== product.id || order.order_items[0]?.quantity !== 1 || order.total_cents !== product.price_cents) throw new PaymentError("NOT_FOUND", "Order not found.");
    if (!["PENDING_PAYMENT", "PAYMENT_PROCESSING"].includes(order.status)) return { publicToken, receipt: true as const };
    const { data: saved, error: savedError } = await supabaseAdmin.from("stripe_checkout_sessions").select("*").eq("order_id", order.id).eq("integration_id", integration.id).maybeSingle();
    if (savedError || !saved) throw new PaymentError("INVALID_STATE", "Checkout could not be resumed.");
    const session = await stripe.retrieveCheckoutSession(saved.session_id);
    if (session.livemode !== (store.environment === "live") || session.metadata?.["order_id"] !== order.id) throw new PaymentError("INVALID_STATE", "Checkout binding mismatch.");
    if (session.status !== "open" || session.expires_at * 1000 <= Date.now()) return { publicToken, receipt: true as const };
    return { publicToken, url: safePurchaseCheckoutUrl(session.url), ...tracking };
  }
  const result = await createOrder({ store, items: [{ productId: product.id, quantity: 1 }], collectCustomerAtCheckout: true, shippingOptionId: "no-shipping" });
  const order = result.order;
  const key = `ebook-checkout:${order.id}:1`;
  const { data: payment, error: paymentError } = await supabaseAdmin.from("payments").insert({
    store_id: store.id, order_id: order.id, integration_id: integration.id, environment: store.environment,
    amount_cents: order.total_cents, currency: order.currency, attempt: 1, idempotency_key: key,
  }).select("id").single();
  if (paymentError || !payment) throw new PaymentError("INVALID_STATE", "Could not prepare payment.");
  const session = await stripe.createCheckoutSession(buildPurchaseSessionRequest(order, product, origin), key);
  if (session.livemode !== (store.environment === "live") || session.metadata?.["order_id"] !== order.id || session.status !== "open") throw new PaymentError("INVALID_STATE", "Checkout binding mismatch.");
  const url = safePurchaseCheckoutUrl(session.url);
  const saved = await supabaseAdmin.from("stripe_checkout_sessions").insert({ store_id: store.id, order_id: order.id, integration_id: integration.id,
    session_id: session.id, status: session.status, base_amount_cents: order.total_cents, base_currency: order.currency,
    expires_at: new Date(session.expires_at * 1000).toISOString(), payment_intent_id: session.payment_intent });
  if (saved.error) throw new PaymentError("INVALID_STATE", "Could not persist checkout.");
  if (session.payment_intent) {
    const linked = await supabaseAdmin.from("payments").update({ provider_payment_id: session.payment_intent }).eq("id", payment.id);
    if (linked.error) throw new PaymentError("INVALID_STATE", "Could not persist payment binding.");
  }
  return { publicToken: order.public_token, url, ...tracking };
}

/** Called only inside the already signature-verified ebook webhook pipeline. */
export async function bindPurchaseIntent(object: Record<string, unknown>, ctx?: { integrationId: string; livemode: boolean }) {
  const metadata = object["metadata"] as Record<string, string> | undefined;
  if (!ctx || !metadata?.["order_id"] || typeof object["id"] !== "string") return null;
  const { data: saved, error } = await supabaseAdmin.from("stripe_checkout_sessions").select("*").eq("order_id", metadata["order_id"]).eq("integration_id", ctx.integrationId).maybeSingle();
  if (error) throw new Error("Checkout binding lookup failed.");
  if (!saved) return null;
  const { data: integration } = await supabaseAdmin.from("stripe_integrations").select("environment, secret_key_ciphertext").eq("id", ctx.integrationId).maybeSingle();
  if (!integration?.secret_key_ciphertext || (integration.environment === "live") !== ctx.livemode) throw new Error("Checkout integration mismatch.");
  const stripe = new StripeService(await decryptSecret(integration.secret_key_ciphertext));
  const session = await stripe.retrieveCheckoutSession(saved.session_id);
  if (session.payment_intent !== object["id"] || session.livemode !== ctx.livemode || session.metadata?.["order_id"] !== saved.order_id || object["amount"] !== saved.base_amount_cents || object["currency"] !== saved.base_currency.toLowerCase()) throw new Error("Checkout payment mismatch.");
  const { data: payment, error: paymentError } = await supabaseAdmin.from("payments").select("*").eq("order_id", saved.order_id).eq("integration_id", ctx.integrationId).eq("idempotency_key", `ebook-checkout:${saved.order_id}:1`).maybeSingle();
  if (paymentError || !payment || payment.environment !== integration.environment || (payment.provider_payment_id && payment.provider_payment_id !== object["id"])) throw new Error("Local checkout payment mismatch.");
  const linked = await supabaseAdmin.from("payments").update({ provider_payment_id: object["id"] }).eq("id", payment.id);
  if (linked.error) throw new Error("Checkout payment binding failed.");
  return { ...payment, provider_payment_id: object["id"] };
}