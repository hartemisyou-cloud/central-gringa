import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { loadStripe, type Stripe, type StripeElementsOptions } from "@stripe/stripe-js";
import {
  AddressElement,
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
import { loadHostedPaymentSession, startHostedPaymentIntent } from "@/lib/hosted-pay.functions";

interface Session {
  orderNumber: string;
  publicToken: string;
  clientSecret: null;
  publishableKey: string;
  amountCents: number;
  currency: string;
  label: string;
  subtitle: string | null;
  items?: { name: string; sku: string; quantity: number; totalCents: number }[];
  customer?: {
    name: string;
    email: string;
    phone: string;
    address: {
      line1: string;
      line2: string;
      city: string;
      state: string;
      postalCode: string;
      country: string;
    } | null;
  };
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
            // Modo diferido: o PaymentIntent só é criado no submit, então a
            // Stripe não recebe cobranças de checkouts abandonados.
            mode: "payment" as const,
            amount: session.amountCents,
            currency: session.currency.toLowerCase(),
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

interface BillingSnapshot {
  complete: boolean;
  name: string;
  phone: string;
  address: {
    line1: string;
    line2?: string | null;
    city: string;
    state: string;
    postal_code: string;
    country: string;
  } | null;
}

function PaymentForm({ session }: { session: Session }) {
  const stripe = useStripe();
  const elements = useElements();
  const [processing, setProcessing] = useState(false);
  const [hasExpress, setHasExpress] = useState(false);
  const [email, setEmail] = useState(session.customer?.email ?? "");
  const [billing, setBilling] = useState<BillingSnapshot>({
    complete: false,
    name: session.customer?.name ?? "",
    phone: session.customer?.phone ?? "",
    address: null,
  });

  const returnUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/pedido/${session.publicToken}`
      : `/pedido/${session.publicToken}`;


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

  const confirmArgs = () => {
    const addr = billing.address;
    const fullAddress = addr
      ? {
          line1: addr.line1,
          line2: addr.line2 ?? "",
          city: addr.city,
          state: addr.state,
          postal_code: addr.postal_code,
          country: addr.country,
        }
      : undefined;
    const name = billing.name || session.customer?.name || "";
    const phone = billing.phone || session.customer?.phone || "";
    const mail = email || session.customer?.email || "";

    const confirmParams = {
      return_url: returnUrl,
      payment_method_data: {
        billing_details: {
          name,
          email: mail,
          phone,
          ...(fullAddress ? { address: fullAddress } : {}),
        },
      },
      ...(fullAddress ? { shipping: { name, phone, address: fullAddress } } : {}),
    };

    return {
      elements: elements!,
      redirect: "if_required" as const,
      confirmParams,
    };
  };


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
          options={{
            buttonHeight: 48,
            emailRequired: true,
            phoneNumberRequired: true,
            billingAddressRequired: true,
            shippingAddressRequired: true,
          }}
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
        <h2 className="text-base font-medium">E-mail</h2>
        <LinkAuthenticationElement
          options={{ defaultValues: { email: session.customer?.email ?? "" } }}
          onChange={(event) => setEmail(event.value.email)}
        />
      </div>

      <div className="space-y-3">
        <h2 className="text-base font-medium">Dados de cobrança e entrega</h2>
        <AddressElement
          options={{
            mode: "shipping",
            display: { name: "full" },
            fields: { phone: "always" },
            validation: { phone: { required: "always" } },
            autocomplete: { mode: "automatic" },
            defaultValues: {
              name: session.customer?.name ?? "",
              phone: session.customer?.phone ?? "",
              ...(session.customer?.address
                ? {
                    address: {
                      line1: session.customer.address.line1,
                      line2: session.customer.address.line2,
                      city: session.customer.address.city,
                      state: session.customer.address.state,
                      postal_code: session.customer.address.postalCode,
                      country: session.customer.address.country,
                    },
                  }
                : {}),
            },

          }}
          onChange={(event) =>
            setBilling({
              complete: event.complete,
              name: event.value.name ?? "",
              phone: event.value.phone ?? "",
              address: event.value.address as BillingSnapshot["address"],
            })
          }
        />
      </div>

      <div className="space-y-3">
        <h2 className="text-base font-medium">Forma de pagamento</h2>
        <PaymentElement
          options={{
            layout: "tabs",
            fields: { billingDetails: { name: "never", email: "never", phone: "never", address: "never" } },
          }}
        />
      </div>

      {session.items?.length ? (
        <ul className="space-y-1 border-t border-[#e6e6e6] pt-4 text-xs text-[#6d6e78]">
          {session.items.map((item) => (
            <li key={item.sku}>
              {item.name} — SKU {item.sku} x{item.quantity}
            </li>
          ))}
        </ul>
      ) : null}

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

