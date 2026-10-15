import { createFileRoute } from "@tanstack/react-router";
import { DonationPolicyPage, donationPolicyHead } from "@/components/donations/DonationPolicyPage";

export const Route = createFileRoute("/donations/refunds")({
  head: () => donationPolicyHead("Donation refunds", "How refund requests for donations are handled."),
  component: () => (
    <DonationPolicyPage title="Donation refunds">
      <p>If you think a donation was made by mistake, contact us through the site where you donated. A person reviews every refund request.</p>
      <p>Refunds are not guaranteed. If a refund or dispute happens after funds were transferred to the recipient, that transfer is not reversed automatically: the donation is flagged for recovery and handled by a person, and we do not say funds were recovered unless they actually were.</p>
    </DonationPolicyPage>
  ),
});
