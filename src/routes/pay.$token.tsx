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

import logoAsset from "@/assets/human-unity-logo.png.asset.json";
import { formatMoney } from "@/lib/format";
import { loadHostedPaymentSession } from "@/lib/hosted-pay.functions";

interface Session {
  orderNumber: string;
  publicToken: string;
  clientSecret: string;
  publishableKey: string;
  amountCents: number;
  currency: string;
  label: string;
  subtitle: string | null;
}

export const Route = createFileRoute("/pay/$token")({
  loader: ({ params }) => loadHostedPaymentSession({ data: { token: params.token } }),
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
  component: HostedPayPage,
});

function HostedPayPage() {
  const result = Route.useLoaderData();
  const [stripe, setStripe] = useState<Stripe | null>(null);
  const session = result.ok ? (result.session as Session) : null;

  useEffect(() => {
    if (!session) return;
    let active = true;
    void loadStripe(session.publishableKey).then((instance) => {
      if (active) setStripe(instance);
    });
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
          <img src={logoAsset.url} alt="Human Unity Foundation" className="mx-auto h-12" />
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
          <img src={logoAsset.url} alt="Human Unity Foundation" className="h-11 w-auto" />
          <div className="mt-10 space-y-1">
            <p className="text-[15px] text-[#6d6e78]">{session.label}</p>
            <p className="text-[36px] leading-none font-semibold tracking-tight">
              {formatMoney(session.amountCents, session.currency)}
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

function PaymentForm({ session }: { session: Session }) {
  const stripe = useStripe();
  const elements = useElements();
  const [processing, setProcessing] = useState(false);
  const [hasExpress, setHasExpress] = useState(false);

  const returnUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/pedido/${session.publicToken}`
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
