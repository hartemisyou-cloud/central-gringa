import { createFileRoute, Link } from "@tanstack/react-router";
import { getDonationReceipt } from "@/lib/donations.functions";

const STATUS_COPY: Record<string, { title: string; body: string }> = {
  PENDING: { title: "Donation not completed yet", body: "We have not received a confirmed payment for this donation." },
  PROCESSING: { title: "Payment processing", body: "Your payment method is still processing. This page updates once Stripe confirms the result." },
  PAID: { title: "Thank you for your donation", body: "Your donation payment is confirmed." },
  RELEASED: { title: "Thank you for your donation", body: "Your donation payment is confirmed and has been released to the program recipient." },
  FAILED: { title: "Payment failed", body: "The payment did not go through. You were not charged." },
  EXPIRED: { title: "Payment session expired", body: "The payment page expired before a payment was made. You were not charged." },
  CANCELLED: { title: "Payment cancelled", body: "The payment was cancelled. You were not charged." },
  REFUNDED: { title: "Donation refunded", body: "This donation was refunded." },
  PARTIALLY_REFUNDED: { title: "Donation partially refunded", body: "Part of this donation was refunded." },
  DISPUTED: { title: "Payment under dispute", body: "A dispute was opened with the card issuer for this payment." },
  REVERSAL_REQUIRED: { title: "Donation under review", body: "This donation was refunded or disputed after release and is being reviewed." },
};

export const Route = createFileRoute("/donations/receipt/$token")({
  loader: ({ params }) => getDonationReceipt({ data: { token: params.token } }),
  head: () => ({
    meta: [
      { title: "Donation receipt — Hope Human Foundation" },
      { name: "description", content: "Status of your donation to Hope Human Foundation." },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "Donation receipt — Hope Human Foundation" },
      { property: "og:description", content: "Status of your donation to Hope Human Foundation." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Receipt,
});

function usd(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

function Receipt() {
  const d = Route.useLoaderData();
  if (!d) {
    return <main className="mx-auto max-w-xl px-5 py-16"><h1 className="text-2xl font-semibold">Donation not found</h1></main>;
  }
  const copy = STATUS_COPY[d.status] ?? STATUS_COPY.PENDING!;
  return (
    <main className="mx-auto max-w-xl space-y-6 px-5 py-16">
      <p className="text-sm uppercase tracking-wide text-muted-foreground">Donation · {d.donationNumber}</p>
      <h1 className="text-3xl font-semibold">{copy.title}</h1>
      <p className="text-muted-foreground">{copy.body}</p>
      <dl className="grid grid-cols-2 gap-3 rounded-lg border border-border p-5 text-sm">
        <dt className="text-muted-foreground">Amount</dt><dd>{usd(d.baseAmountCents)} USD</dd>
        {d.presentment ? (<><dt className="text-muted-foreground">Charged as</dt><dd>{(d.presentment.amount / 100).toFixed(2)} {d.presentment.currency}</dd></>) : null}
        <dt className="text-muted-foreground">Recipient</dt><dd>{d.recipient.name} ({d.recipient.country})</dd>
        {d.campaign ? (<><dt className="text-muted-foreground">Campaign</dt><dd>{d.campaign.title}</dd></>) : null}
        {d.recipient.useOfFunds ? (<><dt className="text-muted-foreground">Use of funds</dt><dd>{d.recipient.useOfFunds}</dd></>) : null}
        <dt className="text-muted-foreground">Status</dt><dd>{d.status}</dd>
      </dl>
      <p className="text-xs text-muted-foreground">
        This is a payment receipt for a donation, not a purchase. No goods or services are provided in exchange.
        This receipt makes no statement about tax deductibility. See <Link to="/donation-policy" className="underline">donation terms</Link>.
      </p>
    </main>
  );
}
