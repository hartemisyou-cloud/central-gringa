import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { ShoppingBag, ShieldCheck, Truck, Minus, Plus } from "lucide-react";

import { getStorefrontProducts, type StorefrontProduct } from "@/lib/storefront.functions";
import { formatMoney } from "@/lib/format";
import { useCart } from "@/hooks/useCart";
import { useStorefrontTracking } from "@/hooks/useStorefrontTracking";
import { Button } from "@/components/ui/button";

const productsQuery = queryOptions({
  queryKey: ["storefront", "products"],
  queryFn: () => getStorefrontProducts(),
});

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Livraria Cultura — Livros de todas as categorias" },
      {
        name: "description",
        content:
          "Literatura, romance, ficção, negócios, história, infantil, HQs e mais. Frete calculado por CEP, estoque em tempo real e pagamento seguro com Stripe.",
      },
      { property: "og:title", content: "Livraria Cultura — Livros de todas as categorias" },
      {
        property: "og:description",
        content:
          "Catálogo amplo de livros com frete calculado, estoque em tempo real e pagamento seguro processado pela API central.",
      },

      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(productsQuery),
  component: Storefront,
});

function Storefront() {
  const { data: products } = useSuspenseQuery(productsQuery);
  const { lines, hydrated, add, setQuantity } = useCart();
  const tracking = useStorefrontTracking();

  const handleAdd = (product: StorefrontProduct) => {
    add(product.id);
    tracking.addToCart({
      value: Number((product.priceCents / 100).toFixed(2)),
      currency: product.currency,
      contents: [
        { id: product.id, quantity: 1, item_price: Number((product.priceCents / 100).toFixed(2)) },
      ],
      contentName: product.name,
    });
  };

  const quantityOf = (id: string) => lines.find((line) => line.productId === id)?.quantity ?? 0;
  const itemCount = lines.reduce((sum, line) => sum + line.quantity, 0);
  const subtotal = lines.reduce((sum, line) => {
    const product = products.find((p: StorefrontProduct) => p.id === line.productId);
    return sum + (product ? product.priceCents * line.quantity : 0);
  }, 0);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4">
          <Link to="/" className="flex items-center gap-2">
            <span className="grid size-9 place-items-center rounded-lg bg-primary text-primary-foreground">
              <ShoppingBag className="size-4" />
            </span>
            <span className="font-display text-lg font-semibold tracking-tight">Livraria Cultura</span>
          </Link>
          <Button asChild size="sm" disabled={itemCount === 0}>
            <Link to="/checkout">
              Carrinho{hydrated && itemCount > 0 ? ` · ${itemCount}` : ""}
            </Link>
          </Button>
        </div>
      </header>

      <section className="border-b border-border bg-secondary/50">
        <div className="mx-auto max-w-6xl px-5 py-14">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Produtos físicos · envio para todo o Brasil
          </p>
          <h1 className="mt-3 max-w-2xl text-4xl font-semibold leading-tight md:text-5xl">
            Compre com preço, frete e estoque validados no servidor.
          </h1>
          <p className="mt-4 max-w-xl text-muted-foreground">
            Todo o checkout desta loja é processado pela API central de pagamentos: o navegador nunca
            define valores nem enxerga chaves do provedor.
          </p>
          <div className="mt-8 flex flex-wrap gap-6 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-2">
              <ShieldCheck className="size-4 text-primary" /> Pagamento com Stripe
            </span>
            <span className="inline-flex items-center gap-2">
              <Truck className="size-4 text-primary" /> Frete calculado por CEP
            </span>
            <span className="inline-flex items-center gap-2">
              <ShoppingBag className="size-4 text-primary" /> Estoque reservado no pedido
            </span>
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-6xl px-5 py-12">
        <h2 className="text-2xl font-semibold">Catálogo</h2>
        <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {products.map((product: StorefrontProduct) => {
            const quantity = hydrated ? quantityOf(product.id) : 0;
            const soldOut = product.available <= 0;
            return (
              <article key={product.id} className="surface-card flex flex-col overflow-hidden">
                <div className="aspect-square bg-secondary">
                  {product.imageUrl ? (
                    <img
                      src={product.imageUrl}
                      alt={product.name}
                      loading="lazy"
                      width={1024}
                      height={1024}
                      className="size-full object-cover"
                    />
                  ) : (
                    <div className="grid size-full place-items-center text-muted-foreground">
                      <ShoppingBag className="size-8" />
                    </div>
                  )}
                </div>
                <div className="flex flex-1 flex-col gap-3 p-4">
                  <div>
                    {product.category && product.category.toLowerCase() !== "parceiros" ? (
                      <p className="text-xs uppercase tracking-wider text-muted-foreground">
                        {product.category}
                      </p>
                    ) : null}
                    <h3 className="mt-1 font-display text-base font-semibold">{product.name}</h3>
                    <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                      {product.description}
                    </p>
                  </div>
                  <div className="mt-auto space-y-3">
                    <p className="text-xl font-semibold">
                      {formatMoney(product.priceCents, product.currency)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {soldOut ? "Sem estoque" : `${product.available} em estoque`}
                    </p>
                    {quantity > 0 ? (
                      <div className="flex items-center justify-between rounded-lg border border-border p-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Remover uma unidade"
                          onClick={() => setQuantity(product.id, quantity - 1)}
                        >
                          <Minus className="size-4" />
                        </Button>
                        <span className="text-sm font-medium">{quantity}</span>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Adicionar uma unidade"
                          disabled={quantity >= product.available}
                          onClick={() => setQuantity(product.id, quantity + 1)}
                        >
                          <Plus className="size-4" />
                        </Button>
                      </div>
                    ) : (
                      <Button
                        className="w-full"
                        disabled={soldOut}
                        onClick={() => handleAdd(product)}
                      >
                        {soldOut ? "Indisponível" : "Adicionar"}
                      </Button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </main>

      {hydrated && itemCount > 0 ? (
        <div className="sticky bottom-0 z-30 border-t border-border bg-background/95 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4">
            <div>
              <p className="text-xs text-muted-foreground">
                {itemCount} {itemCount === 1 ? "item" : "itens"} · subtotal estimado
              </p>
              <p className="text-lg font-semibold">{formatMoney(subtotal)}</p>
            </div>
            <Button asChild>
              <Link to="/checkout">Finalizar compra</Link>
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
