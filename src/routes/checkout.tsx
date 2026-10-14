import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Loader2, Lock, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { BrandMark, PolicyLinks } from "@/components/policies/PolicyLinks";
import { catalogQuery } from "@/routes/index";
import { createDigitalOrder } from "@/lib/hhb-store.functions";
import { formatMoney } from "@/lib/format";
import { useCart } from "@/hooks/useCart";
import { readAttribution } from "@/lib/tracking/attribution-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/checkout")({
  head: () => ({
    meta: [
      { title: "Checkout — Hope Human Books" },
      { name: "description", content: "Review your ebooks and enter your name and email to pay securely." },
      { property: "og:title", content: "Checkout — Hope Human Books" },
      { property: "og:description", content: "Digital checkout: no shipping, instant download after payment." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(catalogQuery),
  component: CheckoutPage,
});

function CheckoutPage() {
  const { data: products } = useSuspenseQuery(catalogQuery);
  const { lines, hydrated, setQuantity, clear } = useCart();
  const create = useServerFn(createDigitalOrder);
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "" });
  const [busy, setBusy] = useState(false);

  const rows = lines
    .map((l) => ({ line: l, product: products.find((p) => p.id === l.productId) }))
    .filter((r): r is { line: typeof r.line; product: NonNullable<typeof r.product> } => Boolean(r.product));
  const total = rows.reduce((s, r) => s + r.product.priceCents * r.line.quantity, 0);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (rows.length === 0) return;
    setBusy(true);
    const result = await create({
      data: {
        items: rows.map((r) => ({ productId: r.product.id, quantity: r.line.quantity })),
        ...form,
        attribution: readAttribution(),
      },
    }).catch((err: Error) => ({ ok: false as const, message: err.message }));
    if (!result.ok) {
      setBusy(false);
      toast.error(result.message || "Could not create the order.");
      return;
    }
    clear();
    window.location.href = `/pay/${result.publicToken}`;
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-border">
        <div className="mx-auto max-w-4xl px-5 py-4"><BrandMark /></div>
      </header>
      <main className="mx-auto grid max-w-4xl gap-10 px-5 py-10 md:grid-cols-2">
        <section>
          <h1 className="font-display text-2xl font-semibold">Your cart</h1>
          {!hydrated ? null : rows.length === 0 ? (
            <p className="mt-4 text-muted-foreground">
              Your cart is empty. <Link to="/" className="underline">Browse the catalog</Link>
            </p>
          ) : (
            <ul className="mt-5 divide-y divide-border border-y border-border">
              {rows.map(({ line, product }) => (
                <li key={product.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                  <span>{product.name}{line.quantity > 1 ? ` × ${line.quantity}` : ""}</span>
                  <span className="flex items-center gap-2">
                    {formatMoney(product.priceCents * line.quantity, product.currency)}
                    <Button variant="ghost" size="icon" aria-label={`Remove ${product.name}`} onClick={() => setQuantity(product.id, 0)}>
                      <Trash2 className="size-4" />
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {rows.length > 0 ? (
            <div className="mt-4 space-y-1 text-sm">
              <p className="flex justify-between text-muted-foreground"><span>Shipping</span><span>None — digital delivery</span></p>
              <p className="flex justify-between text-lg font-semibold"><span>Total</span><span>{formatMoney(total, "USD")}</span></p>
              <p className="text-xs text-muted-foreground">The final amount is calculated by our server.</p>
            </div>
          ) : null}
        </section>

        <section>
          <form onSubmit={submit} className="surface-card space-y-4 p-6">
            <h2 className="font-display text-lg font-semibold">Your details</h2>
            <p className="text-sm text-muted-foreground">We only need your name and email to deliver your ebooks.</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="firstName">First name</Label>
                <Input id="firstName" required maxLength={80} value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lastName">Last name</Label>
                <Input id="lastName" required maxLength={80} value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" required maxLength={160} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <Button type="submit" className="w-full" disabled={busy || rows.length === 0}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <><Lock className="size-4" /> Continue to secure payment</>}
            </Button>
          </form>
          <PolicyLinks className="mt-6 text-muted-foreground" />
        </section>
      </main>
    </div>
  );
}
