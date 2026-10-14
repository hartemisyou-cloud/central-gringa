import { createFileRoute } from "@tanstack/react-router";
import { PolicyLayout, Bullets } from "@/components/policies/PolicyLayout";
import { policyHead } from "@/lib/policies";

export const Route = createFileRoute("/privacy-policy")({
  head: () =>
    policyHead(
      "/privacy-policy",
      "Privacy",
      "What personal data Hope Human Books collects, why, and who processes it.",
    ),
  component: Page,
});

function Page() {
  return (
    <PolicyLayout
      path="/privacy-policy"
      title="Privacy"
      intro={<p>We collect only what is needed to sell and deliver digital ebooks.</p>}
      sections={[
        {
          id: "data",
          title: "Data we collect",
          body: (
            <Bullets
              items={[
                "Your name and email address, to create the order and send your receipt.",
                "Order details: titles, prices and payment status.",
                "Technical data such as IP address, browser and pages visited, for security and measuring our ads.",
              ]}
            />
          ),
        },
        {
          id: "payments",
          title: "Payments",
          body: (
            <p>
              Card and wallet payments are processed by Stripe. Your full card number never reaches
              our servers.
            </p>
          ),
        },
        {
          id: "advertising",
          title: "Advertising measurement",
          body: (
            <p>
              If enabled, we may share purchase events with advertising partners (such as Meta) to
              measure ads. Email addresses are hashed before being sent.
            </p>
          ),
        },
        {
          id: "rights",
          title: "Your choices",
          body: <p>You can ask us to access, correct or delete your personal data at any time.</p>,
        },
      ]}
    />
  );
}
