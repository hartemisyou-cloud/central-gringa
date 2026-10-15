import { createFileRoute } from "@tanstack/react-router";
import { DonationPolicyPage, donationPolicyHead } from "@/components/donations/DonationPolicyPage";

export const Route = createFileRoute("/donations/refunds")({
  head: () => donationPolicyHead("Donation refunds", "How refund requests for donations are handled."),
  component: () => (
    <DonationPolicyPage title="Donation refunds">
      <p>If you think a donation was made by mistake, contact us through the site where you donated. A person reviews every refund request.</p>
      <p>Refunds are not guaranteed, especially after the funds have been released to the recipient.</p>
    </DonationPolicyPage>
  ),
});
