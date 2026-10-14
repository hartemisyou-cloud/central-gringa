import { BrandMark, PolicyLinks } from "@/components/policies/PolicyLinks";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

import { formatMoney } from "@/lib/format";
import { captureHostedAttribution, loadHostedPaymentSession } from "@/lib/hosted-pay.functions";
import { createCheckoutTracker } from "@/lib/analytics/client";
import { usePresence } from "@/hooks/usePresence";
import { captureAttribution } from "@/lib/tracking/attribution-client";
import {
  initPixel,
  trackInitiateCheckout,
  trackPageView,
  trackViewContent,
} from "@/lib/meta/pixel";

/** Normaliza o tipo do botão expresso da Stripe para o vocabulário de eventos. */
function normalizeExpress(type: string): string {
  if (type === "apple_pay") return "apple_pay";
  if (type === "google_pay") return "google_pay";
  if (type === "link") return "link";
  return "card";
}

interface Session {
  orderNumber: string;
  publicToken: string;
  clientSecret: string;
  publishableKey: string;
  amountCents: number;
  currency: string;
  label: string;
  subtitle: string | null;
  metaPixelId: string | null;
  items: Array<{ id: string; name: string; quantity: number; unitAmount: number }>;
}

export const Route = createFileRoute("/pay/$token")({
  loader: ({ params }) => loadHostedPaymentSession({ data: { token: params.token } }),
  head: () => ({
    meta: [
      { title: "Secure payment — Hope Human Books" },
      {
        name: "description",
        content:
          "Complete your ebook purchase with card, Apple Pay or Google Pay in a secure checkout processed by Stripe.",
      },
      { property: "og:title", content: "Secure payment — Hope Human Books" },
      {
        property: "og:description",
        content: "Secure checkout processed by Stripe.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
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
            locale: "en",
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
          <div className="flex justify-center"><BrandMark /></div>
          <h1 className="text-xl font-semibold text-[#30313d]">Payment unavailable</h1>
          <p className="text-sm text-[#6d6e78]">{result.ok ? "" : result.message}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white text-[#30313d] lg:grid lg:grid-cols-2">
      <section className="px-6 pt-10 pb-8 lg:border-r lg:border-[#e6e6e6] lg:px-16 lg:pt-16">
        <div className="mx-auto w-full max-w-[420px] lg:mr-8 lg:ml-auto">
          <BrandMark />
          <div className="mt-10 space-y-1">
            <p className="text-[15px] text-[#6d6e78]">{session.label}</p>
            <p className="text-[36px] leading-none font-semibold tracking-tight">
              {formatMoney(session.amountCents, session.currency)}
            </p>
            {session.subtitle ? (
              <p className="pt-1 text-[15px] text-[#6d6e78]">{session.subtitle}</p>
            ) : null}
          </div>
          <p className="mt-8 text-xs text-[#8b8c96]">Order {session.orderNumber} · Digital delivery, no shipping</p>
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
              Terms
            </a>
            <a href="https://stripe.com/privacy" target="_blank" rel="noreferrer">
              Privacy
            </a>
          </div>
          <PolicyLinks className="mt-4 opacity-70" />
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
  usePresence({ state: "CHECKOUT_VIEWED" });

  // Telemetria de conversão: totalmente assíncrona e sem dados de cartão.
  const tracker = useMemo(
    () => createCheckoutTracker({ publicToken: session.publicToken }),
    [session.publicToken],
  );

  useEffect(() => {
    tracker.track("checkout_viewed");
    tracker.track("checkout_started");
    return () => tracker.dispose();
  }, [tracker]);

  // Meta Pixel (navegador): apenas o pixel público da loja, e somente quando
  // a loja tem Meta Tracking habilitado. Nenhum Access Token chega ao browser.
  const metaEvent = useMemo(
    () => ({
      value: Number((session.amountCents / 100).toFixed(2)),
      currency: session.currency,
      contents: (session.items ?? []).map((item) => ({
        id: item.id,
        quantity: item.quantity,
        item_price: item.unitAmount,
      })),
      contentName: session.label,
    }),
    [session.amountCents, session.currency, session.items, session.label],
  );

  // PageView + ViewContent uma única vez por carregamento da página.
  useEffect(() => {
    if (!session.metaPixelId) return;
    initPixel(session.metaPixelId);
    trackPageView();
    trackViewContent(metaEvent);
  }, [session.metaPixelId, metaEvent]);

  // Atribuição no checkout hospedado: preserva fbclid/UTMs que chegam direto
  // nesta URL e envia fbp/fbc + URL real da conversão ao servidor, que também
  // registra IP e User-Agent reais para o Purchase da CAPI.
  const captured = useRef(false);
  useEffect(() => {
    // pequeno atraso: dá tempo do Pixel gravar os cookies _fbp/_fbc.
    const timer = window.setTimeout(() => {
      if (captured.current) return;
      captured.current = true;
      const attribution = captureAttribution();
      void captureHostedAttribution({
        data: {
          token: session.publicToken,
          attribution,
          pageUrl: window.location.href.slice(0, 2000),
        },
      }).catch(() => undefined);
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [session.publicToken]);


  // InitiateCheckout só com intenção real de pagamento (submit/carteira),
  // uma única vez — nunca a cada render.
  const initiated = useRef(false);
  const fireInitiateCheckout = useCallback(() => {
    if (!session.metaPixelId || initiated.current) return;
    initiated.current = true;
    trackInitiateCheckout(metaEvent);
    tracker.track("meta_initiate_checkout");
  }, [session.metaPixelId, metaEvent, tracker]);

  const returnUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/order/${session.publicToken}`
      : undefined;

  async function finish(
    method: string,
    confirm: () => Promise<{ error?: { message?: string; code?: string } | undefined }>,
  ) {
    setProcessing(true);
    fireInitiateCheckout();
    tracker.track("payment_submitted", { paymentMethod: method });
    const { error } = await confirm();
    setProcessing(false);
    if (error) {
      tracker.track(method === "card" ? "payment_error" : `${method}_failed`, {
        paymentMethod: method,
        errorCode: error.code,
      });
      tracker.flush();
      toast.error(error.message ?? "Payment not authorized.");
      return;
    }
    tracker.track(method === "card" ? "payment_processing" : `${method}_success`, {
      paymentMethod: method,
    });
    tracker.flush();
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
        void finish("card", () => stripe.confirmPayment(confirmArgs()));
      }}
    >
      <div className={hasExpress ? "space-y-5" : ""}>
        <ExpressCheckoutElement
          options={{ buttonHeight: 48 }}
          onReady={({ availablePaymentMethods }) => {
            setHasExpress(Boolean(availablePaymentMethods));
            if (availablePaymentMethods) {
              tracker.track("express_checkout_displayed");
              if (availablePaymentMethods.applePay) tracker.track("apple_pay_available");
              if (availablePaymentMethods.googlePay) tracker.track("google_pay_available");
              if (availablePaymentMethods.link) tracker.track("link_available");
              else tracker.track("link_unavailable");
            }
          }}
          onClick={({ expressPaymentType, resolve }) => {
            tracker.track(`${normalizeExpress(expressPaymentType)}_clicked`);
            fireInitiateCheckout();
            resolve();
          }}
          onConfirm={({ expressPaymentType }) => {
            if (!stripe || !elements) return;
            const method = normalizeExpress(expressPaymentType);
            tracker.track(`${method}_selected`);
            void finish(method, () => stripe.confirmPayment(confirmArgs()));
          }}
        />

        {hasExpress ? (
          <div className="flex items-center gap-4 text-xs text-[#6d6e78]">
            <span className="h-px flex-1 bg-[#e6e6e6]" />
            OR
            <span className="h-px flex-1 bg-[#e6e6e6]" />
          </div>
        ) : null}
      </div>

      <div className="space-y-3">
        <h2 className="text-base font-medium">Contact</h2>
        <LinkAuthenticationElement />
      </div>

      <div className="space-y-3">
        <h2 className="text-base font-medium">Payment method</h2>
        <PaymentElement
          options={{ layout: "tabs" }}
          onChange={(event) => {
            const method = event.value.type === "card" ? "card" : event.value.type;
            tracker.track("payment_method_selected", { paymentMethod: method });
            if (method === "card") tracker.track("card_selected");
            if (method === "link") tracker.track("link_selected");
          }}
        />
      </div>

      <button
        type="submit"
        disabled={!stripe || processing}
        className="flex h-11 w-full items-center justify-center rounded-md bg-[#0570de] text-[15px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {processing ? <Loader2 className="size-4 animate-spin" /> : "Pay now"}
      </button>
    </form>
  );
}
