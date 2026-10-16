import { createFileRoute, notFound } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { purchaseProduct, safePurchaseCheckoutUrl } from "@/lib/catalog/purchase";
import { preparePurchase } from "@/lib/purchase.functions";
import { initPixel, trackInitiateCheckout, trackPageView } from "@/lib/meta/pixel";

export const Route = createFileRoute("/comprar/$slug")({
  loader: ({ params }) => { const product = purchaseProduct(params.slug); if (!product) throw notFound(); return product; },
  head: ({ loaderData }) => ({ meta: [
    { title: `${loaderData?.name ?? "Ebook purchase"} — Hope Human Books` },
    { name: "description", content: "Complete your ebook order at Hope Human Books. Digital downloads become available after confirmed payment." },
    { property: "og:title", content: "Ebook purchase — Hope Human Books" },
    { property: "og:description", content: "Secure ebook purchase and digital delivery from Hope Human Books." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
    { name: "robots", content: "noindex" }, { name: "referrer", content: "origin" },
  ] }),
  component: PurchasePage,
});

function PurchasePage() {
  const product = Route.useLoaderData();
  const prepare = useServerFn(preparePurchase);
  const started = useRef(false);
  const [message, setMessage] = useState("Preparando seu pedido...");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const key = `hhb-purchase:${product.slug}`;
    let token: string | undefined;
    try {
      token = sessionStorage.getItem(key) ?? undefined;
      // Flag local-only: nunca entra em API, Stripe, Meta ou UTMify.
      if (document.referrer.includes("hopehumanfoundation.org")) sessionStorage.setItem("hbb_from_hhf", "1");
    } catch { /* Storage can be blocked. */ }
    void prepare({ data: { slug: product.slug, ...(token ? { token } : {}) } }).then((result) => {
      if (!result.ok) { setMessage(result.message); setFailed(true); return; }
      // Meta Pixel: PageView no carregamento e InitiateCheckout quando a
      // sessão de pagamento existe. Somente dados do livro — nada de campanha,
      // fundação ou doação. O Purchase sai só pela Conversions API (webhook PAID).
      if ("metaPixelId" in result && result.metaPixelId) {
        initPixel(result.metaPixelId);
        trackPageView();
        if ("url" in result && result.url && "product" in result && result.product) {
          trackInitiateCheckout({
            value: Number((result.product.priceCents / 100).toFixed(2)),
            currency: result.product.currency,
            contents: [{ id: result.product.id, quantity: 1, item_price: Number((result.product.priceCents / 100).toFixed(2)) }],
            contentName: result.product.name,
          });
        }
      }
      try { sessionStorage.setItem(key, result.publicToken); } catch { /* Payment does not depend on browser storage. */ }
      if ("url" in result && result.url) window.location.replace(safePurchaseCheckoutUrl(result.url));
      else window.location.replace(`/order/${encodeURIComponent(result.publicToken)}`);
    }).catch(() => { setMessage("Secure checkout is unavailable. Please try again later."); setFailed(true); });
  }, [prepare, product.slug]);
  return <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center text-foreground">
    <h1 className="font-display text-2xl font-semibold">Hope Human Books</h1>
    <p className="text-sm text-muted-foreground">{product.name}</p>
    {!failed && <Loader2 aria-hidden="true" className="size-5 animate-spin motion-reduce:animate-none" />}
    <p role={failed ? "alert" : "status"}>{message}</p>
  </main>;
}