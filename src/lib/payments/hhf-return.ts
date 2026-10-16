/** SSR-safe module; browser effects hold local navigation state only. */
export const HHF_RETURN_STORAGE_KEY = "hbb_from_hhf";

/** Native URL cleanup preserves history state and must not remount tracking. */
export function checkoutEntryKey(location: {
  pathname: string;
  state: { __TSR_key?: string; key?: string };
}): string {
  return `${location.pathname}:${location.state.__TSR_key ?? location.state.key ?? ""}`;
}

/** Run before Stripe.js or any checkout events can read the payment page URL. */
export function consumeHhfEntry(): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (!url.searchParams.getAll("via").includes("hhf")) return;

  try {
    window.sessionStorage.setItem(HHF_RETURN_STORAGE_KEY, "1");
  } catch {
    // A blocked browser store must not prevent payment.
  }
  url.searchParams.delete("via", "hhf");
  window.history.replaceState(window.history.state, "", url.toString());
}

export function hhfThankYouUrl(totalCents: number): string {
  return `https://www.hopehumanfoundation.org/thank-you?amount=${Math.round(totalCents / 100)}`;
}

/** Only a webhook-confirmed receipt may trigger the optional local return. */
export function scheduleHhfPaidReturn(
  status: string | undefined,
  totalCents: number | undefined,
): () => void {
  const idle = () => {};
  if (typeof window === "undefined" || status !== "PAID" || totalCents === undefined) return idle;

  try {
    if (!window.sessionStorage.getItem(HHF_RETURN_STORAGE_KEY)) return idle;
  } catch {
    return idle;
  }

  const timer = window.setTimeout(() => {
    try {
      // Recheck so that remounts or another completed receipt cannot return twice.
      if (!window.sessionStorage.getItem(HHF_RETURN_STORAGE_KEY)) return;
      window.sessionStorage.removeItem(HHF_RETURN_STORAGE_KEY);
    } catch {
      return;
    }
    window.location.replace(hhfThankYouUrl(totalCents));
  }, 600);

  return () => window.clearTimeout(timer);
}
