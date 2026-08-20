# Checkout estilo Stripe hospedado na própria loja

A loja renderiza a página `/pay/$token` no domínio dela, mas todo o processamento
(pedido, PaymentIntent, chaves Stripe) continua na API central.

## Endpoints usados

| Método | Rota                                                    | Uso                          |
| ------ | ------------------------------------------------------- | ---------------------------- |
| POST   | `/api/public/v1/orders`                                 | cria o pedido → `publicToken` |
| GET    | `/api/public/v1/checkout/session/{publicToken}`         | client_secret + resumo        |
| GET    | `/api/public/v1/orders/status/{publicToken}`            | status pós-pagamento          |

Base: `https://livrariacristaglobal.com`
Headers: `x-store-api-key: <STORE_API_KEY>` e `x-store-slug: livraria-crista`.
**A chave nunca vai para o browser** — as chamadas saem do servidor (server function).

Resposta de `checkout/session`:

```json
{
  "data": {
    "orderNumber": "ORD-000123",
    "publicToken": "...",
    "clientSecret": "pi_..._secret_...",
    "publishableKey": "pk_live_...",
    "amountCents": 5000,
    "currency": "BRL",
    "label": "Doação $50",
    "subtitle": "Livraria Cristã",
    "storeName": "Livraria Cristã"
  }
}
```

---

## Arquivos para criar em "Remix of Corações Unidos"

### 1. `src/lib/central-pay.server.ts`

```ts
const BASE = "https://livrariacristaglobal.com";

export async function callCentralApi<T>(
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const apiKey = process.env["STORE_API_KEY"];
  if (!apiKey) throw new Error("STORE_API_KEY não configurada no servidor.");
  const slug = process.env["STORE_SLUG"]?.trim().toLowerCase() ?? "livraria-crista";

  const response = await fetch(`${BASE}/api/public/v1${path}`, {
    method: init?.method ?? "GET",
    headers: {
      "content-type": "application/json",
      "x-store-api-key": apiKey,
      "x-store-slug": slug,
    },
    ...(init?.body ? { body: JSON.stringify(init.body) } : {}),
  });

  const payload = (await response.json().catch(() => null)) as
    | { data?: T; error?: { message?: string } }
    | null;

  if (!response.ok || payload?.data === undefined) {
    throw new Error(payload?.error?.message ?? "Não foi possível concluir a operação.");
  }
  return payload.data;
}
```

### 2. `src/lib/central-pay.functions.ts`

```ts
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export interface CheckoutSession {
  orderNumber: string;
  publicToken: string;
  clientSecret: string;
  publishableKey: string;
  amountCents: number;
  currency: string;
  label: string;
  subtitle: string | null;
}

export const loadCheckoutSession = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => z.object({ token: z.string().min(10).max(128) }).parse(data))
  .handler(async ({ data }) => {
    const { callCentralApi } = await import("./central-pay.server");
    try {
      const session = await callCentralApi<CheckoutSession>(
        `/checkout/session/${encodeURIComponent(data.token)}`,
      );
      return { ok: true as const, session };
    } catch (error) {
      return { ok: false as const, message: (error as Error).message };
    }
  });
```

### 3. `src/routes/pay.$token.tsx`

Página idêntica à da central (2 colunas no desktop, empilhada no mobile, logo no topo,
Apple Pay / Google Pay / Link / cartão).

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { loadStripe, type Stripe, type StripeElementsOptions } from "@stripe/stripe-js";
import {
  Elements,
  ExpressCheckoutElement,
  LinkAuthenticationElement,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { loadCheckoutSession, type CheckoutSession } from "@/lib/central-pay.functions";

const LOGO =
  "https://livrariacristaglobal.com/__l5e/assets-v1/fb6340ab-ba41-4846-903a-4572a6a113ef/human-unity-logo.png";

const money = (cents: number, currency: string) =>
  new Intl.NumberFormat(currency === "BRL" ? "pt-BR" : "en-US", {
    style: "currency",
    currency,
  }).format(cents / 100);

export const Route = createFileRoute("/pay/$token")({
  loader: ({ params }) => loadCheckoutSession({ data: { token: params.token } }),
  head: () => ({
    meta: [
      { title: "Pagamento seguro — Human Unity Foundation" },
      {
        name: "description",
        content:
          "Finalize sua doação com cartão, Apple Pay, Google Pay ou Link em um checkout seguro processado pela Stripe.",
      },
      { property: "og:title", content: "Pagamento seguro — Human Unity Foundation" },
      {
        property: "og:description",
        content: "Checkout seguro com cartão, Apple Pay e Google Pay processado pela Stripe.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PayPage,
});

function PayPage() {
  const result = Route.useLoaderData();
  const session = result.ok ? result.session : null;
  const [stripe, setStripe] = useState<Stripe | null>(null);

  useEffect(() => {
    if (!session) return;
    let active = true;
    void loadStripe(session.publishableKey).then((i) => active && setStripe(i));
    return () => {
      active = false;
    };
  }, [session]);

  const options = useMemo<StripeElementsOptions | null>(
    () =>
      session
        ? {
            clientSecret: session.clientSecret,
            locale: "pt-BR",
            appearance: {
              theme: "stripe",
              variables: {
                colorPrimary: "#0570de",
                borderRadius: "6px",
                fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
              },
            },
          }
        : null,
    [session],
  );

  if (!session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white px-6 text-center">
        <div className="space-y-3">
          <img src={LOGO} alt="Human Unity Foundation" className="mx-auto h-12" />
          <h1 className="text-xl font-semibold text-[#30313d]">Pagamento indisponível</h1>
          <p className="text-sm text-[#6d6e78]">{result.ok ? "" : result.message}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white text-[#30313d] lg:grid lg:grid-cols-2">
      <section className="px-6 pt-10 pb-8 lg:border-r lg:border-[#e6e6e6] lg:px-16 lg:pt-16">
        <div className="mx-auto w-full max-w-[420px] lg:mr-8 lg:ml-auto">
          <img src={LOGO} alt="Human Unity Foundation" className="h-11 w-auto" />
          <div className="mt-10 space-y-1">
            <p className="text-[15px] text-[#6d6e78]">{session.label}</p>
            <p className="text-[36px] leading-none font-semibold tracking-tight">
              {money(session.amountCents, session.currency)}
            </p>
            {session.subtitle ? (
              <p className="pt-1 text-[15px] text-[#6d6e78]">{session.subtitle}</p>
            ) : null}
          </div>
          <p className="mt-8 text-xs text-[#8b8c96]">Pedido {session.orderNumber}</p>
        </div>
      </section>

      <section className="px-6 pb-12 lg:px-16 lg:pt-16">
        <div className="mx-auto w-full max-w-[420px] lg:mr-auto lg:ml-8">
          {stripe && options ? (
            <Elements stripe={stripe} options={options}>
              <PaymentForm session={session} />
            </Elements>
          ) : (
            <div className="flex min-h-[240px] items-center justify-center text-[#6d6e78]">
              <Loader2 className="size-5 animate-spin" />
            </div>
          )}
          <div className="mt-8 flex items-center justify-center gap-3 text-xs text-[#8b8c96]">
            <span>
              Powered by <span className="font-semibold text-[#6d6e78]">stripe</span>
            </span>
            <span className="text-[#e6e6e6]">|</span>
            <a href="https://stripe.com/legal" target="_blank" rel="noreferrer">
              Termos
            </a>
            <a href="https://stripe.com/privacy" target="_blank" rel="noreferrer">
              Privacidade
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}

function PaymentForm({ session }: { session: CheckoutSession }) {
  const stripe = useStripe();
  const elements = useElements();
  const [processing, setProcessing] = useState(false);
  const [hasExpress, setHasExpress] = useState(false);

  const returnUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/donation/success?token=${session.publicToken}`
      : undefined;

  async function finish(confirm: () => Promise<{ error?: { message?: string } | undefined }>) {
    setProcessing(true);
    const { error } = await confirm();
    setProcessing(false);
    if (error) {
      toast.error(error.message ?? "Pagamento não autorizado.");
      return;
    }
    if (returnUrl) window.location.href = returnUrl;
  }

  const confirmArgs = () => ({
    elements: elements!,
    redirect: "if_required" as const,
    confirmParams: returnUrl ? { return_url: returnUrl } : {},
  });

  return (
    <form
      className="space-y-6"
      onSubmit={(event) => {
        event.preventDefault();
        if (!stripe || !elements) return;
        void finish(() => stripe.confirmPayment(confirmArgs()));
      }}
    >
      <div className={hasExpress ? "space-y-5" : ""}>
        <ExpressCheckoutElement
          options={{ buttonHeight: 48 }}
          onReady={({ availablePaymentMethods }) => setHasExpress(Boolean(availablePaymentMethods))}
          onConfirm={() => {
            if (!stripe || !elements) return;
            void finish(() => stripe.confirmPayment(confirmArgs()));
          }}
        />
        {hasExpress ? (
          <div className="flex items-center gap-4 text-xs text-[#6d6e78]">
            <span className="h-px flex-1 bg-[#e6e6e6]" />
            OU
            <span className="h-px flex-1 bg-[#e6e6e6]" />
          </div>
        ) : null}
      </div>

      <div className="space-y-3">
        <h2 className="text-base font-medium">Dados para contato</h2>
        <LinkAuthenticationElement />
      </div>

      <div className="space-y-3">
        <h2 className="text-base font-medium">Forma de pagamento</h2>
        <PaymentElement options={{ layout: "tabs" }} />
      </div>

      <button
        type="submit"
        disabled={!stripe || processing}
        className="flex h-11 w-full items-center justify-center rounded-md bg-[#0570de] text-[15px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {processing ? <Loader2 className="size-4 animate-spin" /> : "Pagar"}
      </button>
    </form>
  );
}
```

### 4. Criar o pedido e redirecionar (server function na loja)

```ts
// src/lib/central-pay.functions.ts (adicionar)
export const createDonationOrder = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        productId: z.string().uuid(),
        customer: z.object({
          firstName: z.string(),
          lastName: z.string(),
          email: z.string().email(),
          phone: z.string(),
        }),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { callCentralApi } = await import("./central-pay.server");
    return callCentralApi<{ publicToken: string }>("/orders", {
      method: "POST",
      body: {
        items: [{ productId: data.productId, quantity: 1 }],
        customer: data.customer,
        address: {
          postalCode: "00000-000",
          street: "Doação online",
          number: "0",
          district: "Online",
          city: "Online",
          state: "SP",
          country: "BR",
        },
        shippingOptionId: "no-shipping",
      },
    });
  });
```

No botão "Doar":

```ts
const { publicToken } = await createDonationOrder({ data: { productId, customer } });
window.location.assign(`/pay/${publicToken}`); // página hospedada na própria loja
```

### 5. Variáveis de ambiente na loja

```
STORE_API_KEY=<chave unificada>
STORE_SLUG=livraria-crista
```
