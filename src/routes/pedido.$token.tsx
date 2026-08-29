import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, Clock, Loader2, XCircle } from "lucide-react";

import { getStorefrontOrderStatus } from "@/lib/storefront.functions";
import { formatMoney, ORDER_STATUS_LABEL } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { usePresence } from "@/hooks/usePresence";

export const Route = createFileRoute("/pedido/$token")({
  head: () => ({
    meta: [
      { title: "Acompanhe seu pedido — Livraria Cultura" },
      {
        name: "description",
        content:
          "Acompanhe o status do seu pedido na Livraria Cultura: confirmação de pagamento, valores e itens comprados.",
      },
      { property: "og:title", content: "Acompanhe seu pedido — Livraria Cultura" },
      {
        property: "og:description",
        content: "Status de pagamento e detalhes do seu pedido na Livraria Cultura.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: OrderStatusPage,
});

function OrderStatusPage() {
  const { token } = Route.useParams();
  const fetchStatus = useServerFn(getStorefrontOrderStatus);

  const { data, isPending, isError } = useQuery({
    queryKey: ["order-status", token],
    queryFn: () => fetchStatus({ data: { publicToken: token } }),
    refetchInterval: (query) =>
      query.state.data && ["PAID", "REFUNDED", "CANCELLED"].includes(query.state.data.status)
        ? false
        : 4000,
  });

  const status = data?.status ?? "PENDING_PAYMENT";
  const paid = status === "PAID";
  const presence = usePresence({ state: "CHECKOUT_VIEWED" });

  useEffect(() => {
    if (paid) presence.send("PAYMENT_SUCCEEDED");
  }, [paid, presence]);
  const failed = ["PAYMENT_FAILED", "CANCELLED"].includes(status);

  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-5 py-14">
      <div className="surface-card p-8 text-center">
        {isPending ? (
          <Loader2 className="mx-auto size-9 animate-spin text-muted-foreground" />
        ) : paid ? (
          <CheckCircle2 className="mx-auto size-10 text-primary" />
        ) : failed ? (
          <XCircle className="mx-auto size-10 text-destructive" />
        ) : (
          <Clock className="mx-auto size-10 text-accent" />
        )}

        <h1 className="mt-5 text-2xl font-semibold">
          {isError
            ? "Pedido não encontrado"
            : paid
              ? "Pagamento confirmado"
              : failed
                ? "Pagamento não concluído"
                : "Aguardando confirmação"}
        </h1>

        {data ? (
          <>
            <p className="mt-2 text-sm text-muted-foreground">
              Pedido {data.orderNumber} · {ORDER_STATUS_LABEL[data.status] ?? data.status}
            </p>
            <p className="mt-6 text-3xl font-semibold">
              {formatMoney(data.totalCents, data.currency)}
            </p>
            {data.items && data.items.length > 0 ? (
              <ul className="mt-6 space-y-2 border-t border-border pt-5 text-left text-sm">
                {data.items.map((item, index) => (
                  <li key={`${item.name}-${index}`} className="flex justify-between gap-3">
                    <span className="text-muted-foreground">
                      {item.quantity}× {item.name}
                    </span>
                    <span>{formatMoney(item.totalCents, data.currency)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="mt-6 text-xs text-muted-foreground">
              A confirmação é feita pelo webhook do provedor de pagamento. Esta página atualiza
              sozinha.
            </p>
          </>
        ) : isError ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Verifique o link recebido após a compra.
          </p>
        ) : null}

        <Button asChild variant="secondary" className="mt-8">
          <Link to="/">Voltar à loja</Link>
        </Button>
      </div>
    </div>
  );
}

/**
 * Nota de arquitetura: esta página NÃO dispara Purchase.
 * O Purchase é enviado exclusivamente pela Meta Conversions API (server-side)
 * quando orders.status = PAID, com event_id determinístico `purchase_{order_id}`.
 */
