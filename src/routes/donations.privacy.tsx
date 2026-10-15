import { createFileRoute } from "@tanstack/react-router";
import { DonationPolicyPage, donationPolicyHead } from "@/components/donations/DonationPolicyPage";

export const Route = createFileRoute("/donations/privacy")({
  head: () => donationPolicyHead("Donation privacy", "What information Hope Human Foundation keeps about donations."),
  component: () => (
    <DonationPolicyPage title="Donation privacy">
      <p>We keep the donation amount, campaign, payment status and, if you give them, your name and email. We use them to process the donation and show its receipt.</p>
      <p>You enter card and wallet details on Stripe's page. We never receive or store them.</p>
    </DonationPolicyPage>
  ),
});
