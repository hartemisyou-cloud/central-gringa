import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { PaymentError } from "./errors";
import { stripeServiceFromIntegration, type IntegrationRow } from "./provider.server";
import { mergeAttributionIntoMetadata, normalizeAttribution, type Attribution } from "./attribution";
import type { StoreRow } from "./store-auth.server";
import type { StripeCheckoutSession, StripeParams } from "./stripe.server";

/**
 * Stripe Checkout Session (ui_mode: "custom") como EVOLUÇÃO do fluxo atual.
 *
 * Fonte de verdade continua sendo o pedido já criado pela Central
 * (orders + order_items + products + order_attribution). Nada aqui recalcula
 * preço, SKU, slug, nome ou quantidade: todos os valores vêm do pedido.
 *
 * O PaymentIntent clássico (`createOrderPayment`) permanece intacto.
 */

export interface CheckoutSessionResult {
  clientSecret: string;
  publishableKey: string;
  sessionId: string;
  publicToken: string;
  orderNumber: string;
}

async function integrationForStore(store: StoreRow): Promise<IntegrationRow> {
  if (!store.stripe_integration_id) {
    throw new PaymentError("CONFIG_ERROR", "Loja sem integração de pagamento configurada.");
  }
  const { data } = await supabaseAdmin
    .from("stripe_integrations")
    .select("*")
    .eq("id", store.stripe_integration_id)
    .maybeSingle();
  if (!data) throw new PaymentError("CONFIG_ERROR", "Integração de pagamento não encontrada.");
  if (data.status !== "ACTIVE") {
    throw new PaymentError("CONFIG_ERROR", "Integração de pagamento inativa.");
  }
  if (data.environment !== store.environment) {
    throw new PaymentError(
      "CONFIG_ERROR",
      "Ambiente da loja e da integração divergem (test/live não podem se misturar).",
    );
  }
  return data;
}

/** return_url precisa ser https e pertencer a uma origem autorizada da loja. */
function validateReturnUrl(store: StoreRow, raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new PaymentError("INVALID_INPUT", "returnUrl inválida.");
  }
  const local = /^(localhost|127\.0\.0\.1)$/i.test(url.hostname);
  if (url.protocol !== "https:" && !local) {
    throw new PaymentError("INVALID_INPUT", "returnUrl deve usar HTTPS.");
  }
  const allowed = store.allowed_origins ?? [];
  if (allowed.length > 0 && !allowed.includes(url.origin) && !local) {
    throw new PaymentError("FORBIDDEN", "returnUrl não pertence a uma origem autorizada da loja.");
  }
  return raw;
}

/** Metadata extra recebida da loja: allowlist de tamanho, nunca sobrescreve o base. */
function sanitizeExtraMetadata(input: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!input) return out;
  for (const [key, value] of Object.entries(input)) {
    if (typeof value !== "string") continue;
    const cleanKey = key.trim().slice(0, 40);
    const cleanValue = value.trim().slice(0, 500);
    if (cleanKey && cleanValue) out[cleanKey] = cleanValue;
  }
  return out;
}

interface OrderItemRow {
  product_id: string;
  product_name: string;
  sku: string;
  quantity: number;
  unit_price_cents: number;
  total_cents: number;
}

/**
 * Line items derivados EXCLUSIVAMENTE do pedido real.
 * A Central não usa Stripe Price IDs (os preços vivem em `products`), então o
 * equivalente 1:1 na Checkout Session é `price_data` + `product_data`, com
 * SKU, product ID e slug preservados em `product_data.metadata`.
 */
function buildLineItems(
  items: OrderItemRow[],
  productsById: Map<string, { slug: string | null; description: string | null; image_url: string | null }>,
  currency: string,
): StripeParams[] {
  return items.map((item) => {
    const product = productsById.get(item.product_id);
    const productData: StripeParams = {
      name: item.product_name,
      metadata: {
        sku: item.sku,
        product_id: item.product_id,
        ...(product?.slug ? { slug: product.slug } : {}),
      },
    };
    if (product?.description) productData["description"] = product.description.slice(0, 500);
    if (product?.image_url?.startsWith("http")) productData["images"] = [product.image_url];
    return {
      quantity: item.quantity,
      price_data: {
        currency: currency.toLowerCase(),
        unit_amount: item.unit_price_cents,
        product_data: productData,
      },
    };
  });
}

function sessionIsReusable(session: StripeCheckoutSession): boolean {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const notExpired = !session.expires_at || session.expires_at > nowSeconds + 60;
  return session.status === "open" && notExpired && Boolean(session.client_secret);
}

export async function createOrderCheckoutSession(input: {
  store: StoreRow;
  orderId: string;
  returnUrl?: string | undefined;
  customerEmail?: string | undefined;
  metadata?: Record<string, string> | undefined;
}): Promise<CheckoutSessionResult> {
  // Isolamento multi-loja (anti-IDOR): o pedido precisa pertencer à loja autenticada.
  const { data: order } = await supabaseAdmin
    .from("orders")
    .select("*, order_items(product_id, product_name, sku, quantity, unit_price_cents, total_cents)")
    .eq("id", input.orderId)
    .eq("store_id", input.store.id)
    .maybeSingle();
  if (!order) throw new PaymentError("NOT_FOUND", "Pedido não encontrado.");
  if (!["PENDING_PAYMENT", "PAYMENT_PROCESSING"].includes(order.status)) {
    throw new PaymentError("INVALID_STATE", "Este pedido não aceita novos pagamentos.");
  }

  const items = (order.order_items ?? []) as OrderItemRow[];
  if (items.length === 0) throw new PaymentError("INVALID_STATE", "Pedido sem itens.");

  const integration = await integrationForStore(input.store);
  const stripe = await stripeServiceFromIntegration(integration);

  // ── Reuso de sessão válida (idempotência) ────────────────────────────────
  const { data: existing } = await supabaseAdmin
    .from("stripe_checkout_sessions")
    .select("*")
    .eq("order_id", order.id)
    .eq("status", "open")
    .maybeSingle();

  if (existing) {
    const remote = await stripe.retrieveCheckoutSession(existing.session_id).catch(() => null);
    if (remote && sessionIsReusable(remote) && remote.amount_total === order.total_cents) {
      await supabaseAdmin
        .from("stripe_checkout_sessions")
        .update({
          status: remote.status ?? "open",
          amount_total: remote.amount_total ?? null,
          currency: remote.currency ?? null,
          presented_amount_total: remote.currency_conversion?.amount_total ?? null,
          presented_currency: remote.currency ?? null,
          expires_at: remote.expires_at ? new Date(remote.expires_at * 1000).toISOString() : null,
        })
        .eq("id", existing.id);
      return {
        clientSecret: remote.client_secret!,
        publishableKey: integration.publishable_key,
        sessionId: remote.id,
        publicToken: order.public_token,
        orderNumber: order.order_number,
      };
    }
    // Expirada/divergente: marca como encerrada e cria uma nova.
    await supabaseAdmin
      .from("stripe_checkout_sessions")
      .update({ status: remote?.status ?? "expired" })
      .eq("id", existing.id);
  }

  // ── Dados do produto (slug/descrição/imagem) do catálogo real ────────────
  const { data: products } = await supabaseAdmin
    .from("products")
    .select("id, slug, description, image_url")
    .eq("store_id", order.store_id)
    .in("id", [...new Set(items.map((item) => item.product_id))]);
  const productsById = new Map(
    (products ?? []).map((product) => [
      product.id,
      { slug: product.slug, description: product.description, image_url: product.image_url },
    ]),
  );

  const lineItems = buildLineItems(items, productsById, order.currency);
  // Frete: a Checkout Session não aceita "shipping_cents" solto no total, então
  // o valor é preservado como um line item explícito (nunca descartado).
  if (order.shipping_cents > 0) {
    lineItems.push({
      quantity: 1,
      price_data: {
        currency: order.currency.toLowerCase(),
        unit_amount: order.shipping_cents,
        product_data: {
          name: order.shipping_method ?? "Frete",
          metadata: { sku: "shipping", order_id: order.id },
        },
      },
    });
  }

  // ── Metadata: base atual + attribution persistida + extras da loja ───────
  const baseMetadata: Record<string, string> = {
    store_id: order.store_id,
    order_id: order.id,
    order_number: order.order_number,
    environment: order.environment,
  };

  const { getOrderAttribution } = await import("./attribution.server");
  const persisted = await getOrderAttribution(order.id).catch(() => ({}) as Attribution);
  const requestAttribution = normalizeAttribution(
    (input.metadata ?? {}) as unknown as Attribution,
  );
  // Attribution persistida tem precedência; a recebida agora só preenche lacunas.
  const attribution: Attribution = { ...requestAttribution, ...persisted };

  const extras = sanitizeExtraMetadata(input.metadata);
  const withExtras: Record<string, string> = { ...extras, ...baseMetadata };
  const metadata = mergeAttributionIntoMetadata(withExtras, attribution);

  // ── Cliente ──────────────────────────────────────────────────────────────
  let customerEmail = input.customerEmail;
  if (!customerEmail && order.customer_id) {
    const { data: customer } = await supabaseAdmin
      .from("customers")
      .select("email")
      .eq("id", order.customer_id)
      .maybeSingle();
    customerEmail = customer?.email ?? undefined;
  }

  const returnUrl = validateReturnUrl(input.store, input.returnUrl);

  const params: StripeParams = {
    mode: "payment",
    ui_mode: "custom",
    adaptive_pricing: { enabled: true },
    currency: order.currency.toLowerCase(),
    line_items: lineItems,
    automatic_payment_methods: { enabled: true },
    client_reference_id: order.public_token,
    metadata,
    payment_intent_data: { metadata, description: `Pedido ${order.order_number}` },
  };
  if (returnUrl) params["return_url"] = returnUrl;
  if (customerEmail) params["customer_email"] = customerEmail;
  if (integration.payment_method_configuration_id) {
    params["payment_method_configuration"] = integration.payment_method_configuration_id;
  }

  // Idempotência na Stripe: chamadas simultâneas para o mesmo pedido devolvem
  // a MESMA Checkout Session em vez de criar duplicatas.
  const session = await stripe.createCheckoutSession(params, `cs_${order.id}`);
  if (!session.client_secret) {
    throw new PaymentError("PROVIDER_ERROR", "Checkout Session criada sem client_secret.");
  }

  await supabaseAdmin.from("stripe_checkout_sessions").upsert(
    {
      store_id: order.store_id,
      order_id: order.id,
      integration_id: integration.id,
      session_id: session.id,
      client_secret: session.client_secret,
      status: session.status ?? "open",
      payment_intent_id:
        typeof session.payment_intent === "string" ? session.payment_intent : null,
      // O valor base do pedido nunca é substituído pelo valor convertido.
      base_amount_cents: order.total_cents,
      base_currency: order.currency,
      amount_total: session.amount_total ?? null,
      currency: session.currency ?? null,
      presented_amount_total: session.currency_conversion?.amount_total ?? null,
      presented_currency: session.currency ?? null,
      expires_at: session.expires_at ? new Date(session.expires_at * 1000).toISOString() : null,
    },
    { onConflict: "session_id" },
  );

  await supabaseAdmin.from("payment_events").insert({
    order_id: order.id,
    type: "CHECKOUT_SESSION_CREATED",
    message: "Checkout Session criada na Stripe",
    metadata: { session_id: session.id } as never,
  });

  return {
    clientSecret: session.client_secret,
    publishableKey: integration.publishable_key,
    sessionId: session.id,
    publicToken: order.public_token,
    orderNumber: order.order_number,
  };
}
