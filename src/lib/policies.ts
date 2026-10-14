/**
 * Public policy data for Hope Human Books.
 * `null` fields are not yet provided — pages say so instead of inventing them.
 */
export const POLICY_STORE = {
  brandName: "Hope Human Books",
  siteUrl: "https://hopehumanbooks.com",
  legalName: null as string | null,
  address: null as string | null,
  supportEmail: null as string | null,
  revisionDate: "October 14, 2026",
  revisionDateISO: "2026-10-14",
};

export const POLICY_PAGES = [
  { to: "/refund-policy", label: "Refunds & cancellations" },
  { to: "/delivery-policy", label: "Digital delivery" },
  { to: "/privacy-policy", label: "Privacy" },
  { to: "/cookie-policy", label: "Cookies" },
  { to: "/terms", label: "Terms of use" },
] as const;

export type PolicyPath = (typeof POLICY_PAGES)[number]["to"];

export function policyHead(path: PolicyPath, title: string, description: string) {
  const url = `${POLICY_STORE.siteUrl}${path}`;
  const fullTitle = `${title} — ${POLICY_STORE.brandName}`;
  return {
    meta: [
      { title: fullTitle },
      { name: "description", content: description },
      { property: "og:title", content: fullTitle },
      { property: "og:description", content: description },
      { property: "og:type", content: "article" },
      { property: "og:url", content: url },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "canonical", href: url }],
  };
}
