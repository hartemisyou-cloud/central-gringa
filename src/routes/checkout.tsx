import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { ArrowLeft, Loader2, Lock } from "lucide-react";
import { toast } from "sonner";

import {
  getStorefrontProducts,
  quoteStorefrontCart,
  startStorefrontCheckout,
  type CheckoutDTO,
  type QuoteDTO,
  type StorefrontProduct,
} from "@/lib/storefront.functions";
import { formatMoney } from "@/lib/format";
import { useCart } from "@/hooks/useCart";
import { useStorefrontTracking } from "@/hooks/useStorefrontTracking";
import { usePresence } from "@/hooks/usePresence";
import { readAttribution } from "@/lib/tracking/attribution-client";
import { storePaymentSession } from "@/routes/pagamento.$token";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const productsQuery = queryOptions({
  queryKey: ["storefront", "products"],
  queryFn: () => getStorefrontProducts(),
});

export const Route = createFileRoute("/checkout")({
  head: () => ({
    meta: [
      { title: "Checkout seguro — Livraria Cultura" },
      {
        name: "description",
        content:
          "Finalize sua compra na Livraria Cultura com frete calculado por CEP e pagamento protegido pela API central de pagamentos.",
      },
      { property: "og:title", content: "Checkout seguro — Livraria Cultura" },
      {
        property: "og:description",
        content: "Frete calculado por CEP e pagamento protegido pela API central de pagamentos.",
      },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(productsQuery),
  component: CheckoutPage,
});

interface FormState {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  postalCode: string;
  street: string;
  number: string;
  complement: string;
  district: string;
  city: string;
  state: string;
}

const EMPTY_FORM: FormState = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  postalCode: "",
  street: "",
  number: "",
  complement: "",
  district: "",
  city: "",
  state: "",
};

function CheckoutPage() {
  const { data: products } = useSuspenseQuery(productsQuery);
  const { lines, hydrated, clear } = useCart();
  const navigate = useNavigate();
  const quote = useServerFn(quoteStorefrontCart);
  const checkout = useServerFn(startStorefrontCheckout);

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [quoteData, setQuoteData] = useState<QuoteDTO | null>(null);
  const [shippingOptionId, setShippingOptionId] = useState<string>("");
  const [quoting, setQuoting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [session, setSession] = useState<CheckoutDTO | null>(null);

  const items = useMemo(
    () => lines.map((line) => ({ productId: line.productId, quantity: line.quantity })),
    [lines],
  );

  const cartRows = lines
    .map((line) => {
      const product = products.find((p: StorefrontProduct) => p.id === line.productId);
      return product ? { product, quantity: line.quantity } : null;
    })
    .filter((row): row is { product: StorefrontProduct; quantity: number } => row !== null);

  const subtotal = cartRows.reduce((sum, row) => sum + row.product.priceCents * row.quantity, 0);
  const selectedShipping = quoteData?.shippingOptions.find((o) => o.id === shippingOptionId);
  const total = subtotal + (selectedShipping?.amountCents ?? 0);

  // Tracking da vitrine: Pixel + captura de UTMs (usadas depois pela UTMify).
  const tracking = useStorefrontTracking();
  usePresence({ state: "CHECKOUT_VIEWED" });
  const currency = cartRows[0]?.product.currency ?? "USD";
  const metaEvent = useMemo(
    () => ({
      value: Number((total / 100).toFixed(2)),
      currency,
      contents: cartRows.map((row) => ({
        id: row.product.id,
        quantity: row.quantity,
        item_price: Number((row.product.priceCents / 100).toFixed(2)),
      })),
      contentName: "Checkout Livraria Cultura",
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [total, currency, lines],
  );

  const viewedRef = useRef(false);
  useEffect(() => {
    if (viewedRef.current || cartRows.length === 0) return;
    viewedRef.current = true;
    tracking.viewContent(metaEvent);
  }, [tracking, metaEvent, cartRows.length]);


  const set = (key: keyof FormState) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  const digits = form.postalCode.replace(/\D/g, "");

  async function handleQuote() {
    if (digits.length !== 8 || items.length === 0) return;
    setQuoting(true);
    try {
      const result = await quote({ data: { items, postalCode: digits } });
      setQuoteData(result);
      setShippingOptionId(result.shippingOptions[0]?.id ?? "");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível calcular o frete.");
    } finally {
      setQuoting(false);
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!shippingOptionId) {
      toast.error("Calcule o frete antes de continuar.");
      return;
    }
    setSubmitting(true);
    tracking.initiateCheckout(metaEvent);
    try {
      const result = await checkout({
        data: {
          items,
          customer: {
            firstName: form.firstName.trim(),
            lastName: form.lastName.trim(),
            email: form.email.trim(),
            phone: form.phone.trim(),
          },
          address: {
            postalCode: digits,
            street: form.street.trim(),
            number: form.number.trim(),
            ...(form.complement.trim() ? { complement: form.complement.trim() } : {}),
            district: form.district.trim(),
            city: form.city.trim(),
            state: form.state.trim().toUpperCase(),
          },
          shippingOptionId,
          attribution: readAttribution(),
        },
      });
      setSession(result);
      storePaymentSession({
        orderNumber: result.orderNumber,
        publicToken: result.publicToken,
        clientSecret: result.clientSecret,
        publishableKey: result.publishableKey,
        amountCents: result.amountCents,
        currency: result.currency,
        label:
          cartRows.length === 1 && cartRows[0]
            ? `${cartRows[0].quantity}× ${cartRows[0].product.name}`
            : `${cartRows.reduce((sum, row) => sum + row.quantity, 0)} itens`,
        subtitle: "Pagamento seguro processado pela Stripe.",
      });
      clear();
      void navigate({ to: "/pagamento/$token", params: { token: result.publicToken } });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível criar o pedido.");
    } finally {
      setSubmitting(false);
    }
  }

  if (hydrated && cartRows.length === 0 && !session) {
    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-5 text-center">
        <h1 className="text-2xl font-semibold">Seu carrinho está vazio</h1>
        <p className="text-sm text-muted-foreground">
          Escolha um produto no catálogo para iniciar o checkout.
        </p>
        <Button asChild>
          <Link to="/">Ver catálogo</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-5 py-4">
          <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            <ArrowLeft className="size-4" /> Voltar ao catálogo
          </Link>
        </div>
      </header>

      <main className="mx-auto grid max-w-5xl gap-8 px-5 py-10 lg:grid-cols-[1.4fr_1fr]">
        <div>
          <h1 className="text-3xl font-semibold">Checkout</h1>

          {session ? (
            <PaymentStep session={session} onPaid={clear} />
          ) : (
            <form className="mt-8 space-y-8" onSubmit={handleSubmit}>
              <section className="space-y-4">
                <h2 className="font-display text-lg font-semibold">Seus dados</h2>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Nome" value={form.firstName} onChange={set("firstName")} required />
                  <Field
                    label="Sobrenome"
                    value={form.lastName}
                    onChange={set("lastName")}
                    required
                  />
                  <Field
                    label="E-mail"
                    type="email"
                    value={form.email}
                    onChange={set("email")}
                    required
                  />
                  <Field label="Telefone" value={form.phone} onChange={set("phone")} required />
                </div>
              </section>

              <section className="space-y-4">
                <h2 className="font-display text-lg font-semibold">Endereço de entrega</h2>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="flex items-end gap-2">
                    <Field
                      label="CEP"
                      value={form.postalCode}
                      onChange={set("postalCode")}
                      required
                      className="flex-1"
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={handleQuote}
                      disabled={quoting || digits.length !== 8}
                    >
                      {quoting ? <Loader2 className="size-4 animate-spin" /> : "Calcular"}
                    </Button>
                  </div>
                  <Field label="Bairro" value={form.district} onChange={set("district")} required />
                  <Field label="Rua" value={form.street} onChange={set("street")} required />
                  <Field label="Número" value={form.number} onChange={set("number")} required />
                  <Field
                    label="Complemento (opcional)"
                    value={form.complement}
                    onChange={set("complement")}
                  />
                  <Field label="Cidade" value={form.city} onChange={set("city")} required />
                  <Field
                    label="UF"
                    value={form.state}
                    onChange={set("state")}
                    required
                    maxLength={2}
                  />
                </div>
              </section>

              {quoteData && quoteData.shippingOptions.length > 0 ? (
                <section className="space-y-3">
                  <h2 className="font-display text-lg font-semibold">Frete</h2>
                  <div className="space-y-2">
                    {quoteData.shippingOptions.map((option) => (
                      <label
                        key={option.id}
                        className="flex cursor-pointer items-center justify-between rounded-lg border border-border bg-card p-4 text-sm has-[:checked]:border-primary"
                      >
                        <span className="flex items-center gap-3">
                          <input
                            type="radio"
                            name="shipping"
                            className="accent-[var(--color-primary)]"
                            checked={shippingOptionId === option.id}
                            onChange={() => setShippingOptionId(option.id)}
                          />
                          <span>
                            <span className="block font-medium">{option.label}</span>
                            <span className="text-muted-foreground">
                              até {option.estimatedDays} dias úteis
                            </span>
                          </span>
                        </span>
                        <span className="font-semibold">
                          {option.amountCents === 0 ? "Grátis" : formatMoney(option.amountCents)}
                        </span>
                      </label>
                    ))}
                  </div>
                </section>
              ) : null}

              <Button type="submit" size="lg" className="w-full" disabled={submitting}>
                {submitting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <>
                    <Lock className="size-4" /> Ir para o pagamento
                  </>
                )}
              </Button>
            </form>
          )}
        </div>

        <aside className="h-fit surface-card p-5 lg:sticky lg:top-6">
          <h2 className="font-display text-lg font-semibold">Resumo</h2>
          <ul className="mt-4 space-y-3 text-sm">
            {cartRows.map((row) => (
              <li key={row.product.id} className="flex justify-between gap-3">
                <span className="text-muted-foreground">
                  {row.quantity}× {row.product.name}
                </span>
                <span>{formatMoney(row.product.priceCents * row.quantity)}</span>
              </li>
            ))}
          </ul>
          <dl className="mt-5 space-y-2 border-t border-border pt-4 text-sm">
            <Row label="Subtotal" value={formatMoney(subtotal)} />
            <Row
              label="Frete"
              value={
                selectedShipping
                  ? selectedShipping.amountCents === 0
                    ? "Grátis"
                    : formatMoney(selectedShipping.amountCents)
                  : "Informe o CEP"
              }
            />
            <div className="flex justify-between border-t border-border pt-3 text-base font-semibold">
              <dt>Total</dt>
              <dd>{formatMoney(session?.amountCents ?? total)}</dd>
            </div>
          </dl>
          <p className="mt-4 text-xs text-muted-foreground">
            Valores confirmados pelo servidor no momento do pedido.
          </p>
        </aside>
      </main>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function Field({
  label,
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const id = `field-${label.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <div className={className}>
      <Label htmlFor={id} className="mb-1.5 block text-xs text-muted-foreground">
        {label}
      </Label>
      <Input id={id} {...props} />
    </div>
  );
}

function PaymentStep({ session, onPaid }: { session: CheckoutDTO; onPaid: () => void }) {
  const [stripe, setStripe] = useState<Stripe | null>(null);

  useEffect(() => {
    let active = true;
    void loadStripe(session.publishableKey).then((instance) => {
      if (active) setStripe(instance);
    });
    return () => {
      active = false;
    };
  }, [session.publishableKey]);

  if (!stripe) {
    return (
      <div className="mt-8 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Carregando pagamento seguro…
      </div>
    );
  }

  return (
    <div className="mt-8">
      <h2 className="font-display text-lg font-semibold">
        Pagamento · pedido {session.orderNumber}
      </h2>
      <Elements
        stripe={stripe}
        options={{ clientSecret: session.clientSecret, locale: "pt-BR" }}
      >
        <PaymentForm session={session} onPaid={onPaid} />
      </Elements>
    </div>
  );
}

function PaymentForm({ session, onPaid }: { session: CheckoutDTO; onPaid: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const navigate = useNavigate();
  const [processing, setProcessing] = useState(false);

  async function confirm(event: React.FormEvent) {
    event.preventDefault();
    if (!stripe || !elements) return;
    setProcessing(true);
    const { error } = await stripe.confirmPayment({
      elements,
      redirect: "if_required",
      confirmParams: {
        return_url: `${window.location.origin}/pedido/${session.publicToken}`,
      },
    });
    setProcessing(false);
    if (error) {
      toast.error(error.message ?? "Pagamento não autorizado.");
      return;
    }
    onPaid();
    void navigate({ to: "/pedido/$token", params: { token: session.publicToken } });
  }

  return (
    <form className="mt-5 space-y-5" onSubmit={confirm}>
      <PaymentElement />
      <Button type="submit" size="lg" className="w-full" disabled={!stripe || processing}>
        {processing ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <>
            <Lock className="size-4" /> Pagar {formatMoney(session.amountCents, session.currency)}
          </>
        )}
      </Button>
      <p className="text-xs text-muted-foreground">
        Os dados do cartão vão diretamente para o provedor de pagamento. A loja não os armazena.
      </p>
    </form>
  );
}
