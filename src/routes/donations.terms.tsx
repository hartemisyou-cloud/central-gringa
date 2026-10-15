import { createFileRoute } from "@tanstack/react-router";
import { DonationPolicyPage, donationPolicyHead } from "@/components/donations/DonationPolicyPage";

export const Route = createFileRoute("/donations/terms")({
  head: () => donationPolicyHead("Donation terms", "How donations to Hope Human Foundation are processed, held and released."),
  component: () => (
    <DonationPolicyPage title="Donation terms">
      <p>A donation is a voluntary gift to the Hope Human Foundation program shown on the campaign. You receive no goods or services in exchange.</p>
      <p>Your payment is processed by Stripe on Stripe's own hosted payment page and is charged when you donate. The program then holds the funds: they are sent to the campaign recipient only after a person on our team approves the release, or when the campaign ends.</p>
      <p>The recipient receives the full original donation amount in US dollars. Hope Human Foundation pays the payment processing fees; they are not deducted from the recipient.</p>
      <p>We make no statement that your donation is tax deductible. Ask your own tax adviser.</p>
    </DonationPolicyPage>
  ),
});
