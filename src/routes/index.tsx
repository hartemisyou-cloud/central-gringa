import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { Download, ShieldCheck, BookOpen } from "lucide-react";

import { StoreFooter, BrandMark } from "@/components/policies/PolicyLinks";
import { BookCover, splitName } from "@/components/BookCover";
import { getCatalog, type CatalogProduct } from "@/lib/hhb-store.functions";
import { HHB_PRODUCTS, workById } from "@/lib/catalog/hhb";
import { formatMoney } from "@/lib/format";
import { useCart } from "@/hooks/useCart";
import { useStorefrontTracking } from "@/hooks/useStorefrontTracking";
import { Button } from "@/components/ui/button";

// Fail closed but never blank the page: a backend without its database
// configured shows an empty catalog (nothing purchasable) instead of crashing.
export const catalogQuery = queryOptions({
  queryKey: ["hhb", "catalog"],
  queryFn: async (): Promise<CatalogProduct[]> => {
    try {
      return await getCatalog();
    } catch (error) {
      console.error("Catalog unavailable:", (error as Error).message);
      return [];
    }
  },
});

const TITLE = "Hope Human Books — Curated American classics as ebooks";
const DESCRIPTION =
  "Curated digital editions of classic American literature, public domain in the United States. Instant download after payment.";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://hopehumanbooks.com/" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "canonical", href: "https://hopehumanbooks.com/" }],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(catalogQuery),
  component: Storefront,
});

function sourcesFor(sku: string) {
  const product = HHB_PRODUCTS.find((p) => p.sku === sku);
  return (product?.workIds ?? []).map((id) => workById(id)).filter((w) => w !== undefined);
}

function Storefront() {
  const { data: products } = useSuspenseQuery(catalogQuery);
  const { lines, hydrated, add } = useCart();
  const tracking = useStorefrontTracking();
  const itemCount = lines.reduce((sum, l) => sum + l.quantity, 0);
  const inCart = (id: string) => lines.some((l) => l.productId === id);

  const handleAdd = (p: CatalogProduct) => {
    add(p.id);
    const value = Number((p.priceCents / 100).toFixed(2));
    tracking.addToCart({ value, currency: p.currency, contents: [{ id: p.id, quantity: 1, item_price: value }], contentName: p.name });
  };

  const singles = products.filter((p) => p.category !== "collection");
  const collections = products.filter((p) => p.category === "collection");

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4">
          <BrandMark />
          <Button asChild size="sm" variant={itemCount ? "default" : "secondary"}>
            <Link to="/checkout">Cart{hydrated && itemCount > 0 ? ` · ${itemCount}` : ""}</Link>
          </Button>
        </div>
      </header>

      <section className="border-b border-border bg-secondary/50">
        <div className="mx-auto max-w-6xl px-5 py-16">
          <h1 className="max-w-3xl font-display text-4xl leading-tight font-semibold md:text-5xl">
            American classics, carefully prepared as clean digital editions.
          </h1>
          <p className="mt-5 max-w-2xl text-muted-foreground">
            Every title here is in the public domain in the United States, and the source texts are
            freely available — we link to each one. Our prices cover our curated, cleaned editions
            and collections. Hope Human Books is not affiliated with Project Gutenberg.
          </p>
          <div className="mt-8 flex flex-wrap gap-6 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-2"><Download className="size-4 text-primary" /> Instant download, no shipping</span>
            <span className="inline-flex items-center gap-2"><ShieldCheck className="size-4 text-primary" /> Secure payment with Stripe</span>
            <span className="inline-flex items-center gap-2"><BookOpen className="size-4 text-primary" /> Original text, no modern additions</span>
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-6xl space-y-14 px-5 py-12">
        <ProductGrid title="Single titles" products={singles} onAdd={handleAdd} inCart={inCart} hydrated={hydrated} />
        <ProductGrid title="Collections" products={collections} onAdd={handleAdd} inCart={inCart} hydrated={hydrated} offset={singles.length} />
      </main>
      <StoreFooter />
    </div>
  );
}

function ProductGrid({
  title,
  products,
  onAdd,
  inCart,
  hydrated,
  offset = 0,
}: {
  title: string;
  products: CatalogProduct[];
  onAdd: (p: CatalogProduct) => void;
  inCart: (id: string) => boolean;
  hydrated: boolean;
  offset?: number;
}) {
  if (products.length === 0) return null;
  return (
    <section>
      <h2 className="font-display text-2xl font-semibold">{title}</h2>
      <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {products.map((p, i) => {
          const { title: t, author } = splitName(p.name);
          const sources = sourcesFor(p.sku);
          const added = hydrated && inCart(p.id);
          return (
            <article key={p.id} className="surface-card flex flex-col overflow-hidden">
              <BookCover title={t} author={author || `${sources.length} ebooks`} index={i + offset} className="mx-auto mt-5 w-40 rounded-sm shadow-md" />
              <div className="flex flex-1 flex-col gap-3 p-5">
                <h3 className="font-display text-lg font-semibold">{p.name}</h3>
                {sources.length > 1 ? (
                  <ul className="list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">
                    {sources.map((w) => (
                      <li key={w.workId}>
                        {w.title.split(";")[0]} — {w.author} ({w.firstPublished}){" "}
                        <a className="underline" href={w.sourceUrl} target="_blank" rel="noreferrer">free source</a>
                      </li>
                    ))}
                  </ul>
                ) : sources[0] ? (
                  <p className="text-sm text-muted-foreground">
                    First published {sources[0].firstPublished}. Plain-text edition.{" "}
                    <a className="underline" href={sources[0].sourceUrl} target="_blank" rel="noreferrer">Free source text</a>
                  </p>
                ) : null}
                <p className="text-xs text-muted-foreground">Public domain in the United States.</p>
                <div className="mt-auto flex items-center justify-between gap-3 pt-2">
                  <p className="text-xl font-semibold">{formatMoney(p.priceCents, p.currency)}</p>
                  {added ? (
                    <Button asChild variant="secondary"><Link to="/checkout">In cart · Checkout</Link></Button>
                  ) : (
                    <Button onClick={() => onAdd(p)}>Add to cart</Button>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
