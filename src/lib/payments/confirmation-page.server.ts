import { loadReceipt } from "./receipt.server";
import { confirmPaidReceiptFromProvider } from "./receipt-refresh.server";

const THANK_YOU_BASE = "https://www.hopehumanfoundation.org/thank-you";
const WAITING_STATUSES = ["PAYMENT_PROCESSING", "PENDING_PAYMENT"];
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{8,120}$/;

interface PageState {
  token: string;
  status: string;
  totalCents: number;
  hhf: boolean;
  notFound: boolean;
}

/** Inline client logic: polls the light status endpoint and returns the buyer
 *  to the foundation thank-you page the moment the provider confirms. */
function pageScript(state: PageState): string {
  return `(function () {
  var token = ${JSON.stringify(state.token)};
  var total = ${state.totalCents};
  var hhf = ${state.hhf ? "true" : "false"};
  var status = ${JSON.stringify(state.status)};
  var attempts = 0;
  var MAX_ATTEMPTS = 75;
  var endUrl = hhf
    ? ${JSON.stringify(THANK_YOU_BASE)} + "?amount=" + Math.round(total / 100)
    : "/order/" + encodeURIComponent(token);
  var fallbackUrl = "/order/" + encodeURIComponent(token) + "?ret=1";
  var waitingStatuses = ${JSON.stringify(WAITING_STATUSES)};
  var heading = document.getElementById("heading");
  var spinner = document.getElementById("spinner");
  var fallback = document.getElementById("fallback");
  function readSessionId() {
    try {
      var raw = window.localStorage.getItem("csp_presence_session");
      if (raw) { var parsed = JSON.parse(raw); if (parsed && typeof parsed.id === "string") return parsed.id; }
    } catch (e) {}
    try { return window.crypto.randomUUID(); } catch (e) { return "confirm-" + Date.now() + "-" + Math.random().toString(36).slice(2, 12); }
  }
  function beacon(event) {
    try {
      var payload = JSON.stringify({ sessionId: readSessionId(), event: event, page: "/confirmar/" + token });
      navigator.sendBeacon("/api/public/v1/analytics/presence", new Blob([payload], { type: "application/json" }));
    } catch (e) {}
  }
  function finish(success) {
    if (success) {
      heading.textContent = "Thank you for your support";
      spinner.style.display = "none";
      beacon("PAYMENT_SUCCEEDED");
      setTimeout(function () { window.location.replace(endUrl); }, 250);
    } else {
      spinner.style.display = "none";
      heading.textContent = "Payment confirmation pending";
      fallback.style.display = "block";
    }
  }
  beacon("CHECKOUT_VIEWED");
  if (status === "PAID") { finish(true); return; }
  if (waitingStatuses.indexOf(status) < 0) { finish(false); return; }
  (function tick() {
    fetch("/api/public/v1/confirm/" + encodeURIComponent(token), { cache: "no-store" })
      .then(function (response) { return response.json(); })
      .then(function (data) {
        attempts = attempts + 1;
        if (data && typeof data.status === "string") status = data.status;
        if (status === "PAID") { finish(true); return; }
        if (waitingStatuses.indexOf(status) < 0) { finish(false); return; }
        if (attempts >= MAX_ATTEMPTS) { finish(false); return; }
        setTimeout(tick, 400);
      })
      .catch(function () {
        attempts = attempts + 1;
        if (attempts >= MAX_ATTEMPTS) { finish(false); return; }
        setTimeout(tick, 600);
      });
  })();
})();`;
}

function pageStyle(): string {
  return `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #faf8f5; color: #1f2937; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "DM Sans", sans-serif; }
  .card { width: min(92vw, 26rem); background: #ffffff; border: 1px solid #e7e2da; border-radius: 16px; padding: 2.5rem 2rem 2rem; text-align: center; box-shadow: 0 10px 30px rgba(31, 27, 22, 0.07); }
  h1 { margin: 1rem 0 0.25rem; font-size: 1.5rem; line-height: 1.25; }
  p.amount { margin: 0; color: #6b7280; font-size: 0.95rem; }
  p.hint { margin: 1.1rem 0 0; color: #9ca3af; font-size: 0.8rem; display: none; }
  a { color: #b45309; font-weight: 600; text-decoration: none; }
  .spinner { width: 40px; height: 40px; margin: 0 auto; border-radius: 50%; border: 3px solid #ece5db; border-top-color: #b45309; animation: spin 0.9s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }`.trim();
}

function shell(title: string, inner: string, extraHead = ""): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="robots" content="noindex">
<link rel="icon" href="/favicon.ico" type="image/x-icon">
<style>${pageStyle()}</style>${extraHead}
</head>
<body>${inner}</body>
</html>`;
}

function amountLabel(totalCents: number): string {
  const dollars = Math.round(totalCents) / 100;
  return `$${Number.isInteger(dollars) ? dollars : dollars.toFixed(2)}`;
}

function confirmationBody(state: PageState): string {
  const heading =
    state.status === "PAID" ? "Thank you for your support" : "Confirming your support\u2026";
  return `<main class="card" aria-live="polite">
  <div class="spinner" id="spinner" aria-hidden="true"></div>
  <h1 id="heading">${heading}</h1>
  <p class="amount">${amountLabel(state.totalCents)}</p>
  <p class="hint" id="fallback"><a href="/order/${encodeURIComponent(state.token)}?ret=1">View your order</a></p>
  <noscript><style>p.hint{display:block!important}</style></noscript>
</main>
<script>${pageScript(state)}</script>`;
}

function notFoundBody(): string {
  return `<main class="card">
  <h1>We couldn&rsquo;t find this order</h1>
  <p class="hint" style="display:block;margin-top:1rem"><a href="/">Back to the shop</a></p>
</main>`;
}

/** Renders the ultra-light confirmation page (no storefront bundle). */
export async function renderConfirmationPage(rawToken: string): Promise<Response> {
  const headers = {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "x-robots-tag": "noindex",
  };
  let token = "";
  try { token = decodeURIComponent(rawToken ?? ""); } catch { token = ""; }
  if (!TOKEN_PATTERN.test(token)) {
    return new Response(shell("Order confirmation", notFoundBody()), { status: 404, headers });
  }
  try {
    let receipt = await loadReceipt(token);
    // The Stripe redirect arrives before the signed webhook; ask the provider
    // directly once so the page can already land on "paid" without polling.
    if (receipt.hhf && WAITING_STATUSES.includes(receipt.status)) {
      try {
        await confirmPaidReceiptFromProvider(token);
        receipt = await loadReceipt(token);
      } catch {
        // Best effort; keep the database view and let the client keep polling.
      }
    }
    const state: PageState = {
      token,
      status: receipt.status,
      totalCents: receipt.totalCents,
      hhf: receipt.hhf,
      notFound: false,
    };
    return new Response(shell("Order confirmation", confirmationBody(state)), { headers });
  } catch {
    return new Response(shell("Order confirmation", notFoundBody()), { status: 404, headers });
  }
}
