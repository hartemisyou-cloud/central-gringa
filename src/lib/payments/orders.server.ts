import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { PaymentError } from "./errors";
import { buildTotals, priceItems, type PriceableProduct, type RequestedItem } from "./pricing";
import { normalizePostalCode, resolveShippingService } from "./shipping";
import { mapProviderStatus, providerFromIntegration } from "./provider.server";
import { randomToken } from "./crypto.server";
import type { StoreRow } from "./store-auth.server";
import type { Database } from "@/integrations/supabase/types";

type IntegrationRow = Database["public"]["Tables"]["stripe_integrations"]["Row"];

export interface CustomerInput {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}

export interface AddressInput {
  postalCode: string;
  street: string;
  number: string;
  complement?: string | undefined;
  district: string;
  city: string;
  state: string;
  country?: string | undefined;
}

async function loadProducts(storeId: string, productIds: string[]): Promise<PriceableProduct[]> {
  const { data, error } = await supabaseAdmin
    .from("products")
    .select("id, name, sku, price_cents, currency, stock, reserved_stock, active, weight_grams")
    .eq("store_id", storeId)
    .in("id", productIds);
  if (error) throw new PaymentError("INVALID_INPUT", "Falha ao carregar produtos.");
  return data ?? [];
}

/** Opção usada quando não há entrega física (doações, itens digitais). */
const NO_SHIPPING_OPTION = {
  id: "no-shipping",
  label: "Sem entrega física",
  amountCents: 0,
  estimatedDays: 0,
  provider: "NONE",
};

function uniqueIds(items: RequestedItem[]): string[] {
  return [...new Set(items.map((item) => item.productId))];
}

/** Cotação server-side: preços, frete e total. O frontend nunca decide valores. */
export async function quoteCart(input: {
  store: StoreRow;
  items: RequestedItem[];
  postalCode?: string;
}) {
  const products = await loadProducts(input.store.id, uniqueIds(input.items));
  const priced = priceItems(input.items, products);

  let shippingOptions: Awaited<ReturnType<ReturnType<typeof resolveShippingService>["quote"]>> = [];
  if (priced.totalWeightGrams === 0) {
    // Pedido sem entrega física (doações/itens digitais): frete não se aplica.
    shippingOptions = [NO_SHIPPING_OPTION];
  } else if (input.postalCode) {
    shippingOptions = await resolveShippingService().quote({
      postalCode: normalizePostalCode(input.postalCode),
      totalWeightGrams: priced.totalWeightGrams,
      subtotalCents: priced.subtotalCents,
      currency: priced.currency,
    });
  }

  const totals = buildTotals({ ...priced, shippingCents: shippingOptions[0]?.amountCents ?? 0 });
  return { ...totals, shippingOptions };
}

function orderNumber(): string {
  const now = new Date();
  const stamp = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}${String(now.getUTCDate()).padStart(2, "0")}`;
  return `ORD-${stamp}-${randomToken(6).toUpperCase()}`;
}

export async function createOrder(input: {
  store: StoreRow;
  items: RequestedItem[];
  customer: CustomerInput;
  address: AddressInput;
  shippingOptionId: string;
}) {
  const products = await loadProducts(input.store.id, uniqueIds(input.items));
  const priced = priceItems(input.items, products);

  const options = await resolveShippingService().quote({
    postalCode: normalizePostalCode(input.address.postalCode),
    totalWeightGrams: priced.totalWeightGrams,
    subtotalCents: priced.subtotalCents,
    currency: priced.currency,
  });
  const option = options.find((entry) => entry.id === input.shippingOptionId);
  if (!option) throw new PaymentError("INVALID_INPUT", "Opção de frete inválida.");

  const totals = buildTotals({ ...priced, shippingCents: option.amountCents });

  const { data: customer, error: customerError } = await supabaseAdmin
    .from("customers")
    .upsert(
      {
        store_id: input.store.id,
        email: input.customer.email.toLowerCase(),
        first_name: input.customer.firstName,
        last_name: input.customer.lastName,
        phone: input.customer.phone,
      },
      { onConflict: "store_id,email" },
    )
    .select("id")
    .single();
  if (customerError || !customer) {
    throw new PaymentError("INVALID_INPUT", "Não foi possível registrar os dados do cliente.");
  }

  const { data: address, error: addressError } = await supabaseAdmin
    .from("addresses")
    .insert({
      store_id: input.store.id,
      customer_id: customer.id,
      recipient_name: `${input.customer.firstName} ${input.customer.lastName}`.trim(),
      phone: input.customer.phone,
      postal_code: normalizePostalCode(input.address.postalCode),
      street: input.address.street,
      number: input.address.number,
      complement: input.address.complement ?? null,
      district: input.address.district,
      city: input.address.city,
      state: input.address.state,
      country: input.address.country ?? "BR",
    })
    .select("id")
    .single();
  if (addressError || !address) {
    throw new PaymentError("INVALID_INPUT", "Endereço de entrega inválido.");
  }

  const { data: order, error: orderError } = await supabaseAdmin
    .from("orders")
    .insert({
      store_id: input.store.id,
      order_number: orderNumber(),
      customer_id: customer.id,
      shipping_address_id: address.id,
      environment: input.store.environment,
      currency: totals.currency,
      subtotal_cents: totals.subtotalCents,
      shipping_cents: totals.shippingCents,
      discount_cents: totals.discountCents,
      total_cents: totals.totalCents,
      shipping_method: option.label,
      public_token: randomToken(32),
    })
    .select("*")
    .single();
  if (orderError || !order) {
    throw new PaymentError("INVALID_INPUT", "Não foi possível criar o pedido.");
  }

  const { error: itemsError } = await supabaseAdmin.from("order_items").insert(
    totals.items.map((item) => ({
      order_id: order.id,
      product_id: item.productId,
      product_name: item.productName,
      sku: item.sku,
      unit_price_cents: item.unitPriceCents,
      quantity: item.quantity,
      total_cents: item.totalCents,
    })),
  );
  if (itemsError) {
    await supabaseAdmin.from("orders").delete().eq("id", order.id);
    throw new PaymentError("INVALID_INPUT", "Não foi possível registrar os itens do pedido.");
  }

  // Reserva de estoque atômica (evita condição de corrida / oversell).
  for (const item of totals.items) {
    const { data: reserved } = await supabaseAdmin.rpc("reserve_stock", {
      _product_id: item.productId,
      _qty: item.quantity,
    });
    if (reserved !== true) {
      await supabaseAdmin.rpc("release_order_stock", { _order_id: order.id });
      await supabaseAdmin.from("orders").delete().eq("id", order.id);
      throw new PaymentError("OUT_OF_STOCK", `Estoque insuficiente para "${item.productName}".`);
    }
  }
  await supabaseAdmin.from("orders").update({ stock_reserved: true }).eq("id", order.id);
  await supabaseAdmin.from("payment_events").insert({
    order_id: order.id,
    type: "ORDER_CREATED",
    message: "Pedido criado",
    metadata: { total_cents: totals.totalCents } as never,
  });

  return { order, totals, publicToken: order.public_token };
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

/**
 * Cria (ou reaproveita) o pagamento de um pedido.
 * Idempotente: chave estável `payment:create:{order_id}:{attempt}` na Stripe e
 * índice único no banco impedem cobranças duplicadas.
 */
export async function createOrderPayment(input: { store: StoreRow; orderId: string }) {
  const { data: order } = await supabaseAdmin
    .from("orders")
    .select("*")
    .eq("id", input.orderId)
    .eq("store_id", input.store.id) // isolamento entre lojas (anti-IDOR)
    .maybeSingle();
  if (!order) throw new PaymentError("NOT_FOUND", "Pedido não encontrado.");
  if (!["PENDING_PAYMENT", "PAYMENT_PROCESSING"].includes(order.status)) {
    throw new PaymentError("INVALID_STATE", "Este pedido não aceita novos pagamentos.");
  }

  const integration = await integrationForStore(input.store);
  const provider = await providerFromIntegration(integration);

  const { data: existing } = await supabaseAdmin
    .from("payments")
    .select("*")
    .eq("order_id", order.id)
    .in("status", ["REQUIRES_PAYMENT", "PROCESSING"])
    .maybeSingle();

  if (existing?.provider_payment_id) {
    const remote = await provider.retrievePayment(existing.provider_payment_id);
    if (remote.amountCents === order.total_cents && remote.clientSecret) {
      return {
        paymentId: existing.id,
        clientSecret: remote.clientSecret,
        publishableKey: integration.publishable_key,
        environment: order.environment,
        amountCents: order.total_cents,
        currency: order.currency,
        orderId: order.id,
      };
    }
    // Valor divergente: cancela e recria numa nova tentativa.
    await provider.cancelPayment(existing.provider_payment_id).catch(() => undefined);
    await supabaseAdmin.from("payments").update({ status: "CANCELLED" }).eq("id", existing.id);
  }

  const { count } = await supabaseAdmin
    .from("payments")
    .select("id", { count: "exact", head: true })
    .eq("order_id", order.id);
  const attempt = (count ?? 0) + 1;
  const idempotencyKey = `payment:create:${order.id}:${attempt}`;

  const { data: payment, error: paymentError } = await supabaseAdmin
    .from("payments")
    .insert({
      store_id: order.store_id,
      order_id: order.id,
      integration_id: integration.id,
      amount_cents: order.total_cents,
      currency: order.currency,
      environment: order.environment,
      attempt,
      idempotency_key: idempotencyKey,
    })
    .select("*")
    .single();
  if (paymentError || !payment) {
    throw new PaymentError("INVALID_STATE", "Já existe um pagamento em andamento para este pedido.");
  }

  let created;
  try {
    created = await provider.createPayment({
      amountCents: order.total_cents,
      currency: order.currency,
      idempotencyKey,
      description: `Pedido ${order.order_number}`,
      metadata: {
        store_id: order.store_id,
        order_id: order.id,
        order_number: order.order_number,
        environment: order.environment,
      },
    });
  } catch (error) {
    await supabaseAdmin
      .from("payments")
      .update({ status: "FAILED", last_error: (error as Error).message })
      .eq("id", payment.id);
    throw error;
  }

  await supabaseAdmin
    .from("payments")
    .update({
      provider_payment_id: created.providerPaymentId,
      status: mapProviderStatus(created.status),
    })
    .eq("id", payment.id);

  await supabaseAdmin.from("orders").update({ status: "PAYMENT_PROCESSING" }).eq("id", order.id);
  await supabaseAdmin.from("payment_events").insert({
    order_id: order.id,
    payment_id: payment.id,
    type: "PAYMENT_CREATED",
    message: "Pagamento criado no provedor",
    metadata: { attempt } as never,
  });

  return {
    paymentId: payment.id,
    clientSecret: created.clientSecret,
    publishableKey: integration.publishable_key,
    environment: order.environment,
    amountCents: order.total_cents,
    currency: order.currency,
    orderId: order.id,
  };
}

/** Status público do pedido — sem dados internos da Stripe. */
export async function getOrderPublicStatus(input: { store: StoreRow; publicToken: string }) {
  const { data: order } = await supabaseAdmin
    .from("orders")
    .select(
      "id, order_number, status, currency, subtotal_cents, shipping_cents, discount_cents, total_cents, shipping_method, created_at, paid_at, order_items(product_name, quantity, unit_price_cents, total_cents), addresses:shipping_address_id(recipient_name, street, number, complement, district, city, state, postal_code)",
    )
    .eq("public_token", input.publicToken)
    .eq("store_id", input.store.id)
    .maybeSingle();
  if (!order) throw new PaymentError("NOT_FOUND", "Pedido não encontrado.");

  const { data: payment } = await supabaseAdmin
    .from("payments")
    .select("status, payment_method, updated_at")
    .eq("order_id", order.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return { order, paymentStatus: payment?.status ?? null };
}
