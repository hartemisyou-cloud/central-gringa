import { createFileRoute } from "@tanstack/react-router";
import { PolicyLayout, Bullets } from "@/components/policies/PolicyLayout";
import { policyHead } from "@/lib/policies";

export const Route = createFileRoute("/delivery-policy")({
  head: () =>
    policyHead(
      "/delivery-policy",
      "Digital delivery",
      "How Hope Human Books delivers ebooks: instant downloads after payment confirmation, no shipping.",
    ),
  component: Page,
});

function Page() {
  return (
    <PolicyLayout
      path="/delivery-policy"
      title="Digital delivery"
      intro={<p>All products are digital. There is no shipping, no shipping fee and no physical address required.</p>}
      sections={[
        {
          id: "when",
          title: "When you get your files",
          body: (
            <p>
              Downloads appear on your order page as soon as our payment processor confirms the
              payment, usually within seconds. Keep the order page link: it is your receipt.
            </p>
          ),
        },
        {
          id: "format",
          title: "File format",
          body: (
            <Bullets
              items={[
                "Each title is delivered as a UTF-8 plain-text (.txt) file that opens on any device.",
                "Files contain the original text only: no modern introductions, translations or illustrations.",
                "Collections include one file per listed title.",
              ]}
            />
          ),
        },
        {
          id: "public-domain",
          title: "Public domain notice",
          body: (
            <p>
              These works are in the public domain in the United States. They may still be
              protected by copyright in other countries; check the law where you live before
              copying or sharing them.
            </p>
          ),
        },
      ]}
    />
  );
}
