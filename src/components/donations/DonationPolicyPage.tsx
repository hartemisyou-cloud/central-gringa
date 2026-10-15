import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";

/** Fixed policy date (set by the operator, America/Bahia), not the server clock. */
export const POLICY_DATE = "October 14, 2026";

export function donationPolicyHead(title: string, description: string) {
  return {
    meta: [
      { title: `${title} — Hope Human Foundation` },
      { name: "description", content: description },
      { property: "og:title", content: `${title} — Hope Human Foundation` },
      { property: "og:description", content: description },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  };
}

export function DonationPolicyPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mx-auto max-w-3xl space-y-6 px-5 py-16">
      <nav className="flex gap-4 text-sm text-muted-foreground">
        <Link to="/donations/terms" className="hover:text-foreground">Donation terms</Link>
        <Link to="/donations/privacy" className="hover:text-foreground">Donation privacy</Link>
        <Link to="/donations/refunds" className="hover:text-foreground">Donation refunds</Link>
      </nav>
      <h1 className="text-3xl font-semibold">{title}</h1>
      <p className="text-sm text-muted-foreground">Last updated: {POLICY_DATE}</p>
      <p className="text-muted-foreground">
        These pages apply only to donations to Hope Human Foundation. Ebook purchases are separate and covered by the store policies.
      </p>
      <div className="space-y-4">{children}</div>
    </main>
  );
}
