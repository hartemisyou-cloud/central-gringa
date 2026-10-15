# Hope Human Foundation — Stripe Connect configuration plan (DRAFT for human approval)

Status: **DRAFT. Every gate is OFF.** Nothing in this document has been activated. No Stripe account
was created, no setting changed, no session, transfer, refund or payout was made by the builder.

## 1. Model (as stated by the human operator)

| Item | Value | Verification |
| --- | --- | --- |
| Platform | Hope Human Foundation, United States | Stated by the user; **not independently verified** |
| Legal status | US nonprofit "501(c)" per user | **Not verified.** No EIN, subsection or tax-deductibility claim is made anywhere |
| Funds flow | Separate charges and transfers: the platform charges the donor, a human later transfers to the recipient | Code: no `transfer_data`, `on_behalf_of` or `application_fee_amount` |
| Capture | Automatic capture. "Hold" only delays the transfer | `capture_method` is never set to manual (it would break Adaptive Pricing) |
| Recipient amount | The full original base USD donation | Release always sends gross, never net |
| Fees | NGO pays processing, Connect, payout and transfer costs out of its own dedicated fee funding | Release blocked on any fee funding deficit |
| Donor FX | Optional Adaptive Pricing local-currency price, with the conversion fee disclosed by Stripe to the donor | Separate from NGO-paid fees; never described as zero |

## 2. Settings still PENDING (human only)

Each one is a gate in `/admin → Donations`. The builder never selected any of them.

1. **Stripe fundraising approval:** written confirmation from Stripe for this account.
2. **Connect approval:** for separate charges and transfers.
3. **Platform country and USD settlement eligibility.**
4. **Dashboard choice:** `EXPRESS` or `NONE` only. A full Stripe Dashboard is not compatible with platform-paid fees and platform-owned losses, so the app rejects it.
5. **Negative-balance liability:** `PLATFORM` only. The platform owns negative balances under separate charges and transfers; the app rejects Stripe-owned liability for this flow.
6. **Recipient country allowlist:** must be within what Stripe actually allows:
   - Same country as the platform; or
   - Self-serve cross-border regions (US, UK, EEA, CA, CH), and only for accounts under the **full** service agreement (Stripe: cross-border payouts are not available under the recipient service agreement); or
   - Countries Stripe has explicitly granted. Record these separately.
   General CountrySpecs availability is **not** enough.
7. **Manual payout schedule:** automatic bank payouts can remove the balance held for donations. The internal ledger does not segregate Stripe cash.
8. **Hold limit:** the actual maximum hold for the platform country. Donations held past it are blocked and need reconciliation. There is no unlimited hold and no escrow.
9. **Dedicated NGO fee funding:** verified own funds, recorded in cents.
10. **Legal account name:** `branding_settings.display_name` only changes the top of the Checkout page. Stripe still shows the legal account name on its terms and receipts, so check that name before going live.
11. **Human confirmation:** the typed full name of the person accepting these responsibilities.

## 3. Recipients

- Registry: display name, country, existing `acct_…` id and service agreement. No KYC documents or personal data are stored locally.
- Readiness is read live from Stripe through Accounts v2: `configuration.recipient.capabilities.stripe_balance.stripe_transfers.status === "active"`, the identity country must match, and the recipient configuration must be applied. It is checked before accepting a payment and again before any release. Values typed by an operator never count as readiness.
- Onboarding: Stripe-hosted Account Links (`account_onboarding`, configuration `recipient`) for an **existing** account. This requires the onboarding switch, Connect and fundraising approval, a compatible dashboard and liability choice, plus the operator's typed name and the phrase "OPEN STRIPE ONBOARDING". This build does not create accounts.

## 4. Release rules (enforced in code and database)

- The transfer is bound to the donation's original integration, environment and platform account.
- Blocked unless all of these hold:
  - The donation is PAID, with no refund or dispute.
  - The charge settled in USD and the funds are available.
  - The available USD balance covers the full gross after setting aside every other held principal in the same platform account (all stores, including partially refunded, disputed and in-flight releases).
  - The NGO fee budget covers the fee after all reserved and consumed coverage.
- Reservations are made under a database lock scoped to the platform account. The operation keeps one stable idempotency key, and its approved recipient, gross amount and source charge cannot change.
- Outcomes:
  - **Ambiguous** (timeout, network): the release becomes `UNKNOWN`, never "failed". Resume first lists transfers by `transfer_group`, then retries with the same key inside the idempotency window. Outside the window it needs manual reconciliation.
  - **Transfer succeeded but saving it locally failed:** Resume records the existing transfer and does not create another.
  - **Refund or dispute before or during a transfer:** the donation ends as `REVERSAL_REQUIRED` (recovery needed). Transfers are not reversed automatically, and funds are never reported as recovered unless they were.
- A transfer goes to the recipient's Stripe balance. It is not a bank payout.

## 5. Branding (donation Sessions only)

`branding_settings = { display_name: "Hope Human Foundation", logo: { type: "url", url: <official logo> }, button_color: "#08733D", background_color: "#FFFFFF", border_style: "rounded" }`, with no `icon`. The line item image is the same official logo. The account's global branding and the ebook checkouts are unchanged.

## 6. Primary references

- https://docs.stripe.com/connect/separate-charges-and-transfers
- https://docs.stripe.com/connect/cross-border-payouts
- https://docs.stripe.com/api/transfers/create
- https://docs.stripe.com/api/checkout/sessions/create
- https://docs.stripe.com/payments/checkout/adaptive-pricing
- https://raw.githubusercontent.com/stripe/stripe-node/v22.6.0/src/resources/Checkout/Sessions.ts
