import Stripe from "stripe";
import { DONATION_STRIPE_API_VERSION } from "./rules";

/**
 * Separate Stripe SDK instance used ONLY for donations (Checkout Sessions,
 * Connect transfers). The ebook raw-API service (2024-06-20) is untouched.
 */
export function donationStripe(secretKey: string): Stripe {
  return new Stripe(secretKey, {
    apiVersion: DONATION_STRIPE_API_VERSION as Stripe.LatestApiVersion,
    httpClient: Stripe.createFetchHttpClient(),
    maxNetworkRetries: 2,
  });
}

export async function donationStripeFromIntegration(integration: {
  secret_key_ciphertext: string | null;
}): Promise<Stripe> {
  const { PaymentError } = await import("@/lib/payments/errors");
  if (!integration.secret_key_ciphertext) {
    throw new PaymentError("CONFIG_ERROR", "Donation configuration pending.");
  }
  const { decryptSecret } = await import("@/lib/payments/crypto.server");
  return donationStripe(await decryptSecret(integration.secret_key_ciphertext));
}
