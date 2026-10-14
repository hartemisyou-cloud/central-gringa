import { createFileRoute } from "@tanstack/react-router";
import { PolicyLayout, Bullets } from "@/components/policies/PolicyLayout";
import { policyHead } from "@/lib/policies";

export const Route = createFileRoute("/refund-policy")({
  head: () =>
    policyHead(
      "/refund-policy",
      "Refunds & cancellations",
      "How refunds and cancellations work for Hope Human Books digital ebooks and collections.",
    ),
  component: Page,
});

function Page() {
  return (
    <PolicyLayout
      path="/refund-policy"
      title="Refunds & cancellations"
      intro={
        <p>
          Hope Human Books sells digital ebooks only. Nothing is shipped. This page explains when
          an order can be cancelled or refunded.
        </p>
      }
      sections={[
        {
          id: "before-payment",
          title: "Before payment is confirmed",
          body: <p>An unpaid order can simply be abandoned. No charge is made and the order expires.</p>,
        },
        {
          id: "downloaded",
          title: "Ebooks already downloaded",
          body: (
            <p>
              Once a file has been downloaded and works as described, the purchase is final and is
              not refundable, except where the law where you live requires otherwise.
            </p>
          ),
        },
        {
          id: "not-downloaded",
          title: "Ebooks not yet downloaded",
          body: (
            <p>
              If you have not downloaded any file from your order, you can ask for a full refund
              within 14 days of purchase.
            </p>
          ),
        },
        {
          id: "file-problems",
          title: "Problems with a file",
          body: (
            <Bullets
              items={[
                "If a file will not download, is incomplete or is the wrong title, contact us.",
                "We will first send a working file. If we cannot fix it, we refund that item.",
              ]}
            />
          ),
        },
        {
          id: "collections",
          title: "Collections",
          body: (
            <p>
              Collections are sold as one item. A collection is treated as downloaded once any of
              its files has been downloaded.
            </p>
          ),
        },
        {
          id: "how",
          title: "How refunds are paid",
          body: <p>Approved refunds go back to the original payment method through our payment processor.</p>,
        },
      ]}
    />
  );
}
