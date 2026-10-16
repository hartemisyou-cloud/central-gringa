import { HHB_PRODUCTS } from "./hhb";

export const PURCHASE_SLUGS = [
  "the-adventures-of-tom-sawyer", "little-women", "adventures-of-huckleberry-finn",
  "moby-dick", "american-classics-collection", "american-classics-library",
] as const;

export function purchaseProduct(slug: string) {
  if (!PURCHASE_SLUGS.some((value) => value === slug)) return undefined;
  return HHB_PRODUCTS.find((product) => product.slug === slug);
}

export function safePurchaseCheckoutUrl(value: string | null): string {
  if (!value) throw new Error("Checkout URL is unavailable.");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "checkout.stripe.com" || url.port || url.username || url.password) {
    throw new Error("Invalid checkout URL.");
  }
  return url.href;
}