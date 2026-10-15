import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/donation-policy")({
  head: () => ({
    meta: [
      { title: "Donation terms, privacy and refunds — Hope Human Foundation" },
      { name: "description", content: "How donations to Hope Human Foundation are processed, held, released and refunded." },
      { property: "og:title", content: "Donation terms — Hope Human Foundation" },
      { property: "og:description", content: "How donations are processed, held, released and refunded." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <main className="mx-auto max-w-3xl space-y-8 px-5 py-16">
      <h1 className="text-3xl font-semibold">Donation terms, privacy and refunds</h1>
      <p className="text-muted-foreground">
        These terms apply only to donations. Ebook purchases are separate and covered by the store policies.
      </p>
      <section className="space-y-2">
        <h2 className="text-xl font-semibold">Terms</h2>
        <p>A donation is a voluntary gift to the Hope Human Foundation program shown on the campaign. You receive no goods or services in exchange.</p>
        <p>Payments are processed by Stripe on Stripe's own hosted payment page. Donated funds are held by the program and are released to the campaign recipient only after a person on our team manually approves the release or the campaign ends. The recipient receives the full original donation amount in US dollars; payment processing fees are covered by Hope Human Foundation, not deducted from the recipient.</p>
        <p>We do not state that your donation is tax deductible. Ask your own tax adviser.</p>
      </section>
      <section className="space-y-2">
        <h2 className="text-xl font-semibold">Privacy</h2>
        <p>We store the amount, campaign, payment status and, if you provide them, your name and email, to process the donation and send you its receipt. Card and wallet details are entered on Stripe's page and are never received or stored by us.</p>
      </section>
      <section className="space-y-2">
        <h2 className="text-xl font-semibold">Refunds</h2>
        <p>If you believe a donation was made in error, contact us through the site where you donated. Refund requests are reviewed by a person; refunds are not guaranteed once funds have been released to the recipient.</p>
      </section>
    </main>
  );
}
