import { createFileRoute } from "@tanstack/react-router";
import { PolicyLayout, Bullets } from "@/components/policies/PolicyLayout";
import { policyHead } from "@/lib/policies";

export const Route = createFileRoute("/cookie-policy")({
  head: () =>
    policyHead("/cookie-policy", "Cookies", "Which cookies and similar storage Hope Human Books uses and why."),
  component: Page,
});

function Page() {
  return (
    <PolicyLayout
      path="/cookie-policy"
      title="Cookies"
      intro={<p>We use a small number of cookies and browser storage entries.</p>}
      sections={[
        {
          id: "essential",
          title: "Essential",
          body: (
            <Bullets
              items={[
                "Your cart, stored in your browser.",
                "Stripe cookies on the payment page, used for fraud prevention.",
              ]}
            />
          ),
        },
        {
          id: "measurement",
          title: "Measurement",
          body: (
            <p>
              When advertising measurement is enabled, the Meta Pixel may set cookies to measure
              ad performance. Campaign parameters from links (such as utm_source) are stored to
              attribute purchases.
            </p>
          ),
        },
        {
          id: "control",
          title: "Controlling cookies",
          body: <p>You can block or delete cookies in your browser settings. The payment page needs Stripe cookies to work.</p>,
        },
      ]}
    />
  );
}
