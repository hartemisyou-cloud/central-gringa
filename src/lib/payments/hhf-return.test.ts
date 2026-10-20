import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  consumeHhfEntry,
  checkoutEntryKey,
  HHF_RETURN_STORAGE_KEY,
  hhfThankYouUrl,
  scheduleHhfPaidReturn,
} from "./hhf-return";

function browser(href = "https://hopehumanbooks.com/pay/order-token") {
  const stored = new Map<string, string>();
  const location = { href, replace: vi.fn() };
  const historyState = { routerEntry: "unchanged" };
  const history = {
    state: historyState,
    replaceState: vi.fn((_state: unknown, _unused: string, next: string) => {
      location.href = next;
    }),
  };
  const sessionStorage = {
    getItem: vi.fn((key: string) => stored.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => stored.set(key, value)),
    removeItem: vi.fn((key: string) => stored.delete(key)),
  };
  const current = {
    location,
    history,
    sessionStorage,
    setTimeout: (callback: () => void, delay: number) => globalThis.setTimeout(callback, delay),
    clearTimeout: (timer: ReturnType<typeof setTimeout>) => globalThis.clearTimeout(timer),
  };
  vi.stubGlobal("window", current);
  return { ...current, stored, historyState };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("local Foundation checkout entry", () => {
  it("keeps readiness stable after local query cleanup but gates a new navigation or token", () => {
    const original = {
      pathname: "/pay/order-token",
      state: { __TSR_key: "entry-1" },
      href: "/pay/order-token?via=hhf&csid=session-id",
    };
    const readyEntry = checkoutEntryKey(original);
    const cleaned = { ...original, href: "/pay/order-token" };
    expect(checkoutEntryKey(cleaned)).toBe(readyEntry);
    expect(checkoutEntryKey({ ...original, state: { __TSR_key: "entry-2" } })).not.toBe(readyEntry);
    expect(checkoutEntryKey({ ...original, pathname: "/pay/new-token" })).not.toBe(readyEntry);
    expect(checkoutEntryKey({ pathname: "/pay/order-token", state: { key: "entry-1" } })).toBe(readyEntry);
  });

  it("records the exact hhf marker locally and strips it before tracking reads the URL", () => {
    const current = browser(
      "https://hopehumanbooks.com/pay/order-token?via=hhf&utm_source=book%20ad&fbclid=click-id&csid=session-id#payment",
    );
    consumeHhfEntry();
    expect(current.stored.get(HHF_RETURN_STORAGE_KEY)).toBe("1");
    const trackingUrl = new URL(current.location.href);
    expect(trackingUrl.searchParams.has("via")).toBe(false);
    expect(trackingUrl.searchParams.get("utm_source")).toBe("book ad");
    expect(trackingUrl.searchParams.get("fbclid")).toBe("click-id");
    expect(trackingUrl.searchParams.get("csid")).toBe("session-id");
    expect(trackingUrl.hash).toBe("#payment");
    expect(current.history.replaceState).toHaveBeenCalledWith(
      current.historyState,
      "",
      current.location.href,
    );
  });

  it.each(["", "?via=other", "?via=HHF", "?utm_source=hhf"])(
    "leaves non-hhf entry %s unchanged",
    (query) => {
      const href = `https://hopehumanbooks.com/pay/order-token${query}`;
      const current = browser(href);
      consumeHhfEntry();
      expect(current.sessionStorage.setItem).not.toHaveBeenCalled();
      expect(current.history.replaceState).not.toHaveBeenCalled();
      expect(current.location.href).toBe(href);
    },
  );

  it("removes only hhf values when an unrelated via parameter also exists", () => {
    const current = browser("https://hopehumanbooks.com/pay/order-token?via=other&via=hhf&via=hhf");
    consumeHhfEntry();
    expect(new URL(current.location.href).searchParams.getAll("via")).toEqual(["other"]);
    expect(current.stored.get(HHF_RETURN_STORAGE_KEY)).toBe("1");
  });

  it("still removes the local marker when sessionStorage is blocked", () => {
    const current = browser("https://hopehumanbooks.com/pay/order-token?via=hhf&utm_source=books");
    Object.defineProperty(window, "sessionStorage", {
      get: () => { throw new Error("SecurityError"); },
    });
    expect(() => consumeHhfEntry()).not.toThrow();
    expect(new URL(current.location.href).searchParams.has("via")).toBe(false);
    expect(new URL(current.location.href).searchParams.get("utm_source")).toBe("books");
  });

  it("does nothing during server rendering", () => {
    vi.stubGlobal("window", undefined);
    expect(() => consumeHhfEntry()).not.toThrow();
  });
});

describe("marked paid receipt return", () => {
  it.each([2000, 3000, 5000, 10000, 25000, 50000])(
    "uses the actual paid total %i in whole dollars",
    totalCents => {
      expect(hhfThankYouUrl(totalCents)).toBe(
        `https://www.hopehumanfoundation.org/thank-you?amount=${totalCents / 100}`,
      );
    },
  );

  it.each([[2049, 20], [2050, 21], [2051, 21]])(
    "rounds %i cents to %i dollars",
    (totalCents, amount) => {
      expect(hhfThankYouUrl(totalCents)).toBe(
        `https://www.hopehumanfoundation.org/thank-you?amount=${amount}`,
      );
    },
  );

  it.each([
    [false, false, "PENDING_PAYMENT", false],
    [false, false, "PAID", false],
    [false, true, "PENDING_PAYMENT", false],
    [false, true, "PAID", false],
    [true, false, "PENDING_PAYMENT", false],
    [true, false, "PAID", false],
    [true, true, "PENDING_PAYMENT", false],
    [true, true, "PAID", true],
  ] as const)("requires all conditions: marker=%s HHF=%s status=%s", (marker, hhf, status, returns) => {
    const current = browser(`https://hopehumanbooks.com/order/receipt-token${marker ? "?ret=1" : ""}`);
    // Old local state is deliberately present in every combination; it cannot authorize a return.
    current.stored.set(HHF_RETURN_STORAGE_KEY, "1");
    scheduleHhfPaidReturn(status, 3000, hhf);
    vi.advanceTimersByTime(600);
    expect(current.location.replace).toHaveBeenCalledTimes(returns ? 1 : 0);
  });

  it("shows the purchase for 600 ms, consumes only ret, then replaces with the correct destination", () => {
    const current = browser("https://hopehumanbooks.com/order/receipt-token?ret=1&view=receipt#downloads");
    scheduleHhfPaidReturn("PAID", 3000, true);
    vi.advanceTimersByTime(599);
    expect(current.location.replace).not.toHaveBeenCalled();
    expect(new URL(current.location.href).searchParams.get("ret")).toBe("1");
    vi.advanceTimersByTime(1);
    expect(current.location.replace).toHaveBeenCalledExactlyOnceWith(
      "https://www.hopehumanfoundation.org/thank-you?amount=30",
    );
    expect(current.location.href).toBe("https://hopehumanbooks.com/order/receipt-token?view=receipt#downloads");
    expect(current.history.replaceState).toHaveBeenCalledWith(current.historyState, "", current.location.href);
  });

  it.each([undefined, "PENDING_PAYMENT", "PAYMENT_PROCESSING", "PAYMENT_FAILED", "CANCELLED", "REFUNDED", "PARTIALLY_REFUNDED"])(
    "never returns a marked HHF receipt with status %s",
    status => {
      const current = browser("https://hopehumanbooks.com/order/receipt-token?ret=1");
      scheduleHhfPaidReturn(status, 3000, true);
      vi.advanceTimersByTime(1000);
      expect(current.location.replace).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each(["", "?ret=0", "?ret=true", "?ret=01", "?via=hhf", "?utm_source=hhf"])(
    "keeps a paid HHF receipt on its standard download view without ret=1 (%s)",
    query => {
      const current = browser(`https://hopehumanbooks.com/order/receipt-token${query}`);
      current.stored.set(HHF_RETURN_STORAGE_KEY, "1");
      scheduleHhfPaidReturn("PAID", 3000, true);
      vi.advanceTimersByTime(1000);
      expect(current.location.replace).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("keeps the unmarked email link after pending becomes PAID", () => {
    const current = browser("https://hopehumanbooks.com/order/receipt-token");
    current.stored.set(HHF_RETURN_STORAGE_KEY, "1");
    scheduleHhfPaidReturn("PAYMENT_PROCESSING", 3000, true);
    scheduleHhfPaidReturn("PAID", 3000, true);
    vi.advanceTimersByTime(1000);
    expect(current.location.replace).not.toHaveBeenCalled();
  });

  it("cancels the scheduled return when the receipt unmounts or changes", () => {
    const current = browser("https://hopehumanbooks.com/order/receipt-token?ret=1");
    const cancel = scheduleHhfPaidReturn("PAID", 3000, true);
    cancel();
    vi.advanceTimersByTime(1000);
    expect(current.location.replace).not.toHaveBeenCalled();
    expect(new URL(current.location.href).searchParams.get("ret")).toBe("1");
  });

  it("rechecks the current URL before returning", () => {
    const current = browser("https://hopehumanbooks.com/order/receipt-token?ret=1");
    scheduleHhfPaidReturn("PAID", 3000, true);
    current.location.href = "https://hopehumanbooks.com/order/receipt-token";
    vi.advanceTimersByTime(600);
    expect(current.location.replace).not.toHaveBeenCalled();
  });

  it("cannot return twice when another effect already consumed the marker", () => {
    const current = browser("https://hopehumanbooks.com/order/receipt-token?ret=1");
    scheduleHhfPaidReturn("PAID", 3000, true);
    scheduleHhfPaidReturn("PAID", 3000, true);
    vi.advanceTimersByTime(600);
    expect(current.location.replace).toHaveBeenCalledTimes(1);
  });

  it("does not require browser storage for an authorized return", () => {
    const current = browser("https://hopehumanbooks.com/order/receipt-token?ret=1");
    Object.defineProperty(window, "sessionStorage", { get: () => { throw new Error("SecurityError"); } });
    expect(() => scheduleHhfPaidReturn("PAID", 3000, true)).not.toThrow();
    vi.advanceTimersByTime(600);
    expect(current.location.replace).toHaveBeenCalledOnce();
  });

  it("does not schedule server-side navigation or a receipt without a total", () => {
    browser("https://hopehumanbooks.com/order/receipt-token?ret=1");
    scheduleHhfPaidReturn("PAID", undefined, true);
    vi.stubGlobal("window", undefined);
    expect(() => scheduleHhfPaidReturn("PAID", 3000, true)).not.toThrow();
    expect(vi.getTimerCount()).toBe(0);
  });
});
