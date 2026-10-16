import { HHB_PRODUCTS, type HhbProduct } from "@/lib/catalog/hhb";

/** Only these catalog entries have the server-side /comprar entry point. */
export const PURCHASE_ENTRY_SLUGS = [
  "the-adventures-of-tom-sawyer",
  "little-women",
  "adventures-of-huckleberry-finn",
  "moby-dick",
  "american-classics-collection",
  "american-classics-library",
] as const;

const entryProducts = new Map<string, HhbProduct>(
  HHB_PRODUCTS.filter((product) =>
    (PURCHASE_ENTRY_SLUGS as readonly string[]).includes(product.slug),
  ).map((product) => [product.slug, product]),
);

export function purchaseEntryProduct(slug: string): HhbProduct | undefined {
  return entryProducts.get(slug);
}

/** Referer controls only the local browser handoff; it is never attribution. */
export function purchasePaymentPath(publicToken: string, referer: string | null): string {
  return `/pay/${encodeURIComponent(publicToken)}${referer?.includes("hopehumanfoundation.org") ? "?via=hhf" : ""}`;
}

/** Same host check as the local handoff; selects only the post-payment destination. */
export function isHhfEntryReferer(referer: string | null): boolean {
  return referer?.includes("hopehumanfoundation.org") ?? false;
}
