import { createFileRoute } from "@tanstack/react-router";
import { DonationPolicyPage, donationPolicyHead } from "@/components/donations/DonationPolicyPage";

export const Route = createFileRoute("/donations/terms")({
  head: () => donationPolicyHead("Donation terms", "How donations to Hope Human Foundation are processed, held and released."),
  component: () => (
    <DonationPolicyPage title="Donation terms">
      <p>A donation is a voluntary gift to the Hope Human Foundation program shown on the campaign. You receive no goods or services in exchange.</p>
      <p>Your payment is processed by Stripe on Stripe's own hosted payment page and is charged when you donate. The program then holds the funds: they are sent to the campaign recipient only after a person on our team approves the release, or when the campaign ends.</p>
      <p>"Held" means the transfer is delayed after your payment is captured. It is not escrow, and holds are limited by Stripe's rules for our account's country.</p>
      <p>A release transfers the full original donation amount in US dollars to the recipient's Stripe balance. That is not a bank payout; the recipient's own payout schedule decides when money reaches their bank. Hope Human Foundation pays the payment processing and Connect fees; they are not deducted from the recipient.</p>
      <p>If Stripe offers you a price in your local currency, Stripe shows you that price and any currency conversion fee before you pay. That optional conversion is between you and Stripe and is not described here as free.</p>
      <p>We make no statement that your donation is tax deductible. Ask your own tax adviser.</p>
    </DonationPolicyPage>
  ),
});
