import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
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

export interface PaymentSessionPayload {
  orderNumber: string;
  publicToken: string;
  clientSecret: string;
  publishableKey: string;
  amountCents: number;
  currency: string;
  label: string;
  subtitle?: string;
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


export const paymentSessionKey = (token: string) => `loja1.payment.${token}`;

export function storePaymentSession(payload: PaymentSessionPayload) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(paymentSessionKey(payload.publicToken), JSON.stringify(payload));
}

export const Route = createFileRoute("/pagamento/$token")({
  head: () => ({
    meta: [
      { title: "Pagamento seguro — Human Unity Foundation" },
      {
        name: "description",
        content:
          "Conclua seu pagamento com cartão, Apple Pay ou Google Pay em um checkout seguro processado pela Stripe.",
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
  component: PaymentPage,
});

function PaymentPage() {
  const { token } = Route.useParams();
  const [payload, setPayload] = useState<PaymentSessionPayload | null>(null);
  const [ready, setReady] = useState(false);
  const [stripe, setStripe] = useState<Stripe | null>(null);

  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(paymentSessionKey(token));
      if (raw) setPayload(JSON.parse(raw) as PaymentSessionPayload);
    } catch {
      /* ignore */
    }
    setReady(true);
  }, [token]);

  useEffect(() => {
    if (!payload) return;
    let active = true;
    void loadStripe(payload.publishableKey).then((instance) => {
      if (active) setStripe(instance);
    });
    return () => {
      active = false;
    };
  }, [payload]);

  const options = useMemo<StripeElementsOptions | null>(
    () =>
      payload
        ? {
            clientSecret: payload.clientSecret,
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
    [payload],
  );

  if (!ready) return <CenterLoader />;

  if (!payload) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white px-6 text-center">
        <div className="space-y-3">
          <img src={logoAsset.url} alt="Human Unity Foundation" className="mx-auto h-12" />
          <h1 className="text-xl font-semibold text-[#30313d]">Sessão de pagamento expirada</h1>
          <p className="text-sm text-[#6d6e78]">
            Reinicie o checkout para gerar um novo pagamento seguro.
          </p>
          <Link to="/checkout" className="inline-block text-sm font-medium text-[#0570de]">
            Voltar ao checkout
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white text-[#30313d] lg:grid lg:grid-cols-2">
      {/* Coluna esquerda — resumo */}
      <section className="px-6 pt-10 pb-8 lg:border-r lg:border-[#e6e6e6] lg:px-16 lg:pt-16">
        <div className="mx-auto w-full max-w-[420px] lg:ml-auto lg:mr-8">
          <img src={logoAsset.url} alt="Human Unity Foundation" className="h-11 w-auto" />
          <div className="mt-10 space-y-1">
            <p className="text-[15px] text-[#6d6e78]">{payload.label}</p>
            <p className="text-[36px] leading-none font-semibold tracking-tight">
              {formatMoney(payload.amountCents, payload.currency)}
            </p>
            {payload.subtitle ? (
              <p className="pt-1 text-[15px] text-[#6d6e78]">{payload.subtitle}</p>
            ) : null}
          </div>
          <p className="mt-8 text-xs text-[#8b8c96]">Pedido {payload.orderNumber}</p>
        </div>
      </section>

      {/* Coluna direita — pagamento */}
      <section className="px-6 pb-12 lg:px-16 lg:pt-16">
        <div className="mx-auto w-full max-w-[420px] lg:mr-auto lg:ml-8">
          {stripe && options ? (
            <Elements stripe={stripe} options={options}>
              <PaymentForm payload={payload} />
            </Elements>
          ) : (
            <CenterLoader />
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

function CenterLoader() {
  return (
    <div className="flex min-h-[240px] items-center justify-center text-[#6d6e78]">
      <Loader2 className="size-5 animate-spin" />
    </div>
  );
}

interface BillingSnapshot {
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

function PaymentForm({ payload }: { payload: PaymentSessionPayload }) {
  const stripe = useStripe();
  const elements = useElements();
  const navigate = useNavigate();
  const [processing, setProcessing] = useState(false);
  const [hasExpress, setHasExpress] = useState(false);
  const [email, setEmail] = useState(payload.customer?.email ?? "");
  const [billing, setBilling] = useState<BillingSnapshot>({
    name: payload.customer?.name ?? "",
    phone: payload.customer?.phone ?? "",
    address: null,
  });

  const returnUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/pedido/${payload.publicToken}`
      : `/pedido/${payload.publicToken}`;

  async function finish(confirm: () => Promise<{ error?: { message?: string } | undefined }>) {
    setProcessing(true);
    const { error } = await confirm();
    setProcessing(false);
    if (error) {
      toast.error(error.message ?? "Pagamento não autorizado.");
      return;
    }
    window.sessionStorage.removeItem(paymentSessionKey(payload.publicToken));
    void navigate({ to: "/pedido/$token", params: { token: payload.publicToken } });
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
    const name = billing.name || payload.customer?.name || "";
    const phone = billing.phone || payload.customer?.phone || "";
    const mail = email || payload.customer?.email || "";

    return {
      elements: elements!,
      redirect: "if_required" as const,
      confirmParams: {
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
      },
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
          options={{ defaultValues: { email: payload.customer?.email ?? "" } }}
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
              name: payload.customer?.name ?? "",
              phone: payload.customer?.phone ?? "",
              ...(payload.customer?.address
                ? {
                    address: {
                      line1: payload.customer.address.line1,
                      line2: payload.customer.address.line2,
                      city: payload.customer.address.city,
                      state: payload.customer.address.state,
                      postal_code: payload.customer.address.postalCode,
                      country: payload.customer.address.country,
                    },
                  }
                : {}),
            },
          }}
          onChange={(event) =>
            setBilling({
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
            fields: {
              billingDetails: { name: "never", email: "never", phone: "never", address: "never" },
            },
          }}
        />
      </div>

      {payload.items?.length ? (
        <ul className="space-y-1 border-t border-[#e6e6e6] pt-4 text-xs text-[#6d6e78]">
          {payload.items.map((item) => (
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
