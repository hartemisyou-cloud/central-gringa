import { createFileRoute } from "@tanstack/react-router";
import { DonationPolicyPage, donationPolicyHead } from "@/components/donations/DonationPolicyPage";

export const Route = createFileRoute("/donations/terms")({
  head: () => donationPolicyHead("Donation terms", "How donations to Hope Human Foundation are processed and received."),
  component: () => (
    <DonationPolicyPage title="Donation terms">
      <p>A donation is a voluntary gift to the Hope Human Foundation program shown on the campaign. You receive no goods or services in exchange.</p>
      <p>Your payment is processed by Stripe on Stripe's own hosted payment page and is charged when you donate. Hope Human Foundation receives your donation in support of the campaign you selected.</p>
      <p>No campaign recipient is paid automatically. Any future transfer to a recipient requires a separate verification and release process that is not active today. We do not describe this as escrow, and we make no promise about when or whether a transfer happens.</p>
      <p>Hope Human Foundation pays the payment processing fees for your donation.</p>
      <p>If Stripe offers you a price in your local currency, Stripe shows you that price and any currency conversion fee before you pay. That optional conversion is between you and Stripe and is not described here as free.</p>
      <p>We make no statement that your donation is tax deductible. Ask your own tax adviser.</p>
    </DonationPolicyPage>
  ),
});
