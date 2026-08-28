import { PaymentError } from "./errors";

/**
 * Cálculo de totais — função PURA e a única autoridade sobre valores.
 * O frontend nunca envia preços: envia apenas productId + quantity.
 */

export interface PriceableProduct {
  id: string;
  name: string;
  sku: string;
  price_cents: number;
  currency: string;
  stock: number;
  reserved_stock: number;
  active: boolean;
  weight_grams: number;
}

export interface RequestedItem {
  productId: string;
  quantity: number;
}

export interface PricedItem {
  productId: string;
  productName: string;
  sku: string;
  unitPriceCents: number;
  quantity: number;
  totalCents: number;
}

export interface OrderTotals {
  items: PricedItem[];
  currency: string;
  subtotalCents: number;
  shippingCents: number;
  discountCents: number;
  totalCents: number;
  totalWeightGrams: number;
}

export const MAX_ITEM_QUANTITY = 50;
export const MAX_DISTINCT_ITEMS = 30;

export function priceItems(
  requested: RequestedItem[],
  products: PriceableProduct[],
): { items: PricedItem[]; currency: string; subtotalCents: number; totalWeightGrams: number } {
  if (!Array.isArray(requested) || requested.length === 0) {
    throw new PaymentError("INVALID_INPUT", "O carrinho está vazio.");
  }
  if (requested.length > MAX_DISTINCT_ITEMS) {
    throw new PaymentError("INVALID_INPUT", "Quantidade de itens distintos acima do limite.");
  }

  const byId = new Map(products.map((p) => [p.id, p]));
  const merged = new Map<string, number>();
  for (const item of requested) {
    if (!item || typeof item.productId !== "string") {
      throw new PaymentError("INVALID_INPUT", "Item inválido no carrinho.");
    }
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > MAX_ITEM_QUANTITY) {
      throw new PaymentError("INVALID_INPUT", "Quantidade inválida para um dos itens.");
    }
    merged.set(item.productId, (merged.get(item.productId) ?? 0) + item.quantity);
  }

  const items: PricedItem[] = [];
  let subtotalCents = 0;
  let totalWeightGrams = 0;
  let currency: string | null = null;

  for (const [productId, quantity] of merged) {
    const product = byId.get(productId);
    if (!product) {
      throw new PaymentError("NOT_FOUND", "Produto não encontrado nesta loja.", { productId });
    }
    if (!product.active) {
      throw new PaymentError("PRODUCT_INACTIVE", `O produto "${product.name}" não está disponível.`, {
        productId,
      });
    }
    const available = product.stock - product.reserved_stock;
    if (available < quantity) {
      throw new PaymentError("OUT_OF_STOCK", `Estoque insuficiente para "${product.name}".`, {
        productId,
        available: Math.max(available, 0),
      });
    }
    if (currency === null) currency = product.currency;
    if (currency !== product.currency) {
      throw new PaymentError("INVALID_INPUT", "Itens com moedas diferentes no mesmo pedido.");
    }

    const totalCents = product.price_cents * quantity;
    subtotalCents += totalCents;
    totalWeightGrams += product.weight_grams * quantity;
    items.push({
      productId: product.id,
      productName: product.name,
      sku: product.sku,
      unitPriceCents: product.price_cents,
      quantity,
      totalCents,
    });
  }

  return { items, currency: currency ?? "BRL", subtotalCents, totalWeightGrams };
}

export function buildTotals(input: {
  items: PricedItem[];
  currency: string;
  subtotalCents: number;
  totalWeightGrams: number;
  shippingCents: number;
  discountCents?: number;
}): OrderTotals {
  const discountCents = Math.max(0, Math.min(input.discountCents ?? 0, input.subtotalCents));
  const shippingCents = Math.max(0, input.shippingCents);
  const totalCents = input.subtotalCents + shippingCents - discountCents;
  if (totalCents < 0) {
    throw new PaymentError("INVALID_INPUT", "Total inválido para o pedido.");
  }
  return {
    items: input.items,
    currency: input.currency,
    subtotalCents: input.subtotalCents,
    shippingCents,
    discountCents,
    totalCents,
    totalWeightGrams: input.totalWeightGrams,
  };
}

export function formatMoney(cents: number, currency = "USD"): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(cents / 100);
}
