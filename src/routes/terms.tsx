import { createFileRoute } from "@tanstack/react-router";
import { PolicyLayout, Bullets, ExtLink } from "@/components/policies/PolicyLayout";
import { policyHead } from "@/lib/policies";

export const Route = createFileRoute("/terms")({
  head: () =>
    policyHead("/terms", "Terms of use", "Terms for buying curated public-domain ebook editions from Hope Human Books."),
  component: Page,
});

function Page() {
  return (
    <PolicyLayout
      path="/terms"
      title="Terms of use"
      intro={<p>By placing an order you agree to these terms.</p>}
      sections={[
        {
          id: "what",
          title: "What you are buying",
          body: (
            <p>
              Hope Human Books sells curated digital editions and collections of classic American
              works. These are purchases, not charitable donations, and are not tax-deductible.
            </p>
          ),
        },
        {
          id: "free-sources",
          title: "Free source texts",
          body: (
            <>
              <p>
                The underlying texts are in the public domain in the United States and are freely
                available elsewhere, for example from Project Gutenberg. Our price covers our
                selection, preparation and delivery of the files. Hope Human Books is not affiliated
                with or endorsed by Project Gutenberg.
              </p>
              <p>
                Each product page links to its free source, e.g.{" "}
                <ExtLink href="https://www.gutenberg.org/ebooks/2701">Moby-Dick</ExtLink>.
              </p>
            </>
          ),
        },
        {
          id: "territory",
          title: "Copyright outside the United States",
          body: (
            <p>
              Public domain status in the United States does not mean the works are public domain
              everywhere. You are responsible for following the law where you live.
            </p>
          ),
        },
        {
          id: "prices",
          title: "Prices and payment",
          body: (
            <Bullets
              items={[
                "Prices are in US dollars and set by our servers at checkout.",
                "Payment is processed by Stripe. An order is confirmed only when Stripe confirms the payment.",
              ]}
            />
          ),
        },
      ]}
    />
  );
}
