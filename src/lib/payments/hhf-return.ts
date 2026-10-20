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

/** All three conditions are required; a stale local storage flag grants nothing. */
export function scheduleHhfPaidReturn(
  status: string | undefined,
  totalCents: number | undefined,
  originHhf: boolean,
): () => void {
  const idle = () => {};
  if (typeof window === "undefined" || !originHhf || status !== "PAID" || totalCents === undefined) return idle;
  const marked = () => new URL(window.location.href).searchParams.getAll("ret").includes("1");
  if (!marked()) return idle;

  const timer = window.setTimeout(() => {
    // Navigation or another effect may have consumed the marker while waiting.
    if (!marked()) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("ret");
    window.history.replaceState(window.history.state, "", url.toString());
    window.location.replace(hhfThankYouUrl(totalCents));
  }, 600);

  return () => window.clearTimeout(timer);
}
