/** Allowlisted customer snapshot from a verified, locally bound Checkout Session. */
export type CheckoutCustomerDetails = {
  name: string | null;
  email: string | null;
  address: { country: string | null; city: string | null };
};

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}

export function normalizeCheckoutCustomerDetails(value: unknown): CheckoutCustomerDetails | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const address = input["address"] && typeof input["address"] === "object"
    ? input["address"] as Record<string, unknown> : {};
  const country = text(address["country"]);
  return {
    name: text(input["name"]),
    email: text(input["email"])?.toLowerCase() ?? null,
    address: {
      country: country && /^[a-z]{2}$/i.test(country) ? country.toLowerCase() : null,
      city: text(address["city"]),
    },
  };
}
