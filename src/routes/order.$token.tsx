import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { CheckCircle2, Clock, Download, Loader2, XCircle } from "lucide-react";

import { BrandMark, PolicyLinks } from "@/components/policies/PolicyLinks";
import { getReceipt } from "@/lib/hhb-store.functions";
import { formatMoney, ORDER_STATUS_LABEL } from "@/lib/format";
import { usePresence } from "@/hooks/usePresence";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/order/$token")({
  validateSearch: (search: Record<string, unknown>): { via: string } => ({ via: typeof search["via"] === "string" ? search["via"] : "" }),
  head: () => ({
    meta: [
      { title: "Your order — Hope Human Books" },
      { name: "description", content: "Order receipt and ebook downloads from Hope Human Books." },
      { property: "og:title", content: "Your order — Hope Human Books" },
      { property: "og:description", content: "Receipt and downloads for your Hope Human Books order." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ReceiptPage,
});

const FINAL = ["PAID", "REFUNDED", "PARTIALLY_REFUNDED", "CANCELLED", "PAYMENT_FAILED"];

function ReceiptPage() {
  const { token } = Route.useParams();
  const fetchReceipt = useServerFn(getReceipt);
  const { data, isPending } = useQuery({
    queryKey: ["receipt", token],
    queryFn: () => fetchReceipt({ data: { token } }),
    refetchInterval: (q) => {
      const r = q.state.data;
      return r?.ok && FINAL.includes(r.receipt.status) ? false : 3000;
    },
  });
  const receipt = data?.ok ? data.receipt : null;
  const paid = receipt?.status === "PAID";
  const failed = receipt ? ["PAYMENT_FAILED", "CANCELLED"].includes(receipt.status) : false;
  const presence = usePresence({ state: "CHECKOUT_VIEWED" });
  // Retorno à Fundação ativado pelo parâmetro via=hhf gravado na success_url
  // quando a entrada em /comprar veio com Referer da Fundação.
  const { via } = Route.useSearch();
  const fromFoundation = via === "hhf";
  useEffect(() => {
    if (paid) presence.send("PAYMENT_SUCCEEDED");
  }, [paid, presence]);
  useEffect(() => {
    // Bounce does not wait for PAID: nobody reaches success_url without an
    // approved charge, and the PAID webhook can lag a few seconds.
    if (!fromFoundation || !receipt) return;
    const timer = setTimeout(() => {
      try { sessionStorage.removeItem("hbb_from_hhf"); } catch { /* Storage can be blocked. */ }
      window.location.replace(`https://www.hopehumanfoundation.org/thank-you?amount=${Math.round(receipt.totalCents / 100)}`);
    }, 600);
    return () => clearTimeout(timer);
  }, [fromFoundation, receipt]);

  return (
    <div className="min-h-screen">
      <header className="border-b border-border"><div className="mx-auto max-w-2xl px-5 py-4"><BrandMark /></div></header>
      <main className="mx-auto max-w-2xl px-5 py-12">
        <div className="surface-card p-8">
          <div className="text-center">
            {isPending ? <Loader2 className="mx-auto size-9 animate-spin text-muted-foreground" />
              : paid ? <CheckCircle2 className="mx-auto size-10 text-primary" />
              : failed ? <XCircle className="mx-auto size-10 text-destructive" />
              : <Clock className="mx-auto size-10 text-muted-foreground" />}
            <h1 className="mt-4 font-display text-2xl font-semibold">
              {data && !data.ok ? "Order not found" : fromFoundation && receipt ? "Order confirmed" : paid ? "Thank you — your ebooks are ready" : failed ? "Payment not completed" : "Waiting for payment confirmation"}
            </h1>
            {receipt ? (
              <p className="mt-2 text-sm text-muted-foreground">
                Order {receipt.orderNumber} · {ORDER_STATUS_LABEL[receipt.status] ?? receipt.status} · {formatMoney(receipt.totalCents, receipt.currency)}
              </p>
            ) : null}
          </div>

          {receipt ? (
            <ul className="mt-6 space-y-1 border-t border-border pt-5 text-sm">
              {receipt.items.map((i, idx) => (
                <li key={idx} className="flex justify-between gap-3">
                  <span className="text-muted-foreground">{i.quantity}× {i.name}</span>
                  <span>{formatMoney(i.totalCents, receipt.currency)}</span>
                </li>
              ))}
            </ul>
          ) : null}

          {paid && receipt ? (
            <section className="mt-8">
              <h2 className="font-display text-lg font-semibold">Downloads</h2>
              <ul className="mt-3 divide-y divide-border border-y border-border">
                {receipt.works.map((w) => (
                  <li key={w.workId} className="flex items-center justify-between gap-3 py-3 text-sm">
                    <span>
                      <span className="font-medium">{w.title}</span>
                      <span className="block text-xs text-muted-foreground">{w.author} · {w.firstPublished} · {(w.bytes / 1024).toFixed(0)} KB plain text</span>
                    </span>
                    <Button asChild size="sm" variant="secondary">
                      <a href={w.downloadPath} download><Download className="size-4" /> Download</a>
                    </Button>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-muted-foreground">
                Keep this page's link — it is your receipt and download page. Works are in the public domain in the United States.
              </p>
            </section>
          ) : receipt && !failed ? (
            <p className="mt-6 text-center text-xs text-muted-foreground">
              Downloads unlock automatically once Stripe confirms your payment. This page refreshes on its own.
            </p>
          ) : null}

          <div className="mt-8 text-center">
            <Button asChild variant="secondary"><Link to="/">Back to the shop</Link></Button>
          </div>
        </div>
        <PolicyLinks className="mt-6 text-muted-foreground" />
      </main>
    </div>
  );
}
