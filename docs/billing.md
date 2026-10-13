# Billing (Stripe)

How the Stripe side is set up and what the app expects from it. For the token and refund rules as customers see them, read the terms page (`web/src/pages/terms.astro`).

Sellable Stripe items are **one Product each**: token pack 10, pack 50, pack 100, and **one** Pro product with monthly + yearly Prices. Do not put pack prices on the Pro product. Catalog amounts (€10 / €45 / €80 packs, €49 / €490 Pro) are **VAT-inclusive**; Prices use `tax_behavior: inclusive` so the incl-VAT total stays a round euro. Token packs use Checkout `mode: 'payment'`; Pro uses `mode: 'subscription'`. Fulfilment is from **webhooks**, not the success page. Prefer a [restricted API key](https://docs.stripe.com/keys.md#manage-your-api-keys) (`rk_`) over `sk_`. Never commit secrets.

Belgian Pro checkout needs **SEPA Direct Debit** enabled in the Dashboard payment methods (Bancontact is one-off; Stripe uses it to set up SEPA for subscriptions). Checkout always collects a billing address so Stripe Tax can locate subscription invoices.

On the VPS, put these in `/etc/accessibility.env` (see **[deploy/README.md](../deploy/README.md)**) and restart `accessibility.service`:

| Variable | Purpose |
| --- | --- |
| `STRIPE_SECRET_KEY` | Restricted sandbox key first (`rk_test_…`). |
| `STRIPE_WEBHOOK_SECRET` | Signing secret for `POST /api/stripe/webhook`. |
| `STRIPE_PRICE_PACK_10` / `_50` / `_100` | One-time pack Price IDs. |
| `STRIPE_PRICE_PRO_MONTHLY` / `STRIPE_PRICE_PRO_YEARLY` | Pro Price IDs on the single Pro product. |
| `STRIPE_AUTOMATIC_TAX` | Default `true`. Checkout in `NODE_ENV=production` returns **503** if this is `false`. Requires Tax Settings with a **head office** and **Collecting** registrations (Belgium domestic + Union OSS — confirm with your advisor). |
| `STRIPE_TAX_CODE` | Product tax code (catalog script default `txcd_10103001`). The server logs a warning at boot if unset. |
| `PUBLIC_BASE_URL` | Public origin (`https://wcag.about-us.be`). Required in production. |
| `SCAN_JOB_TTL_MS` | Optional. Default `86400000` (24h). Queued jobs older than this are dropped and consumed customer tokens are refunded. Not required in production. |

Create sandbox Products with `node scripts/stripe-catalog.mjs` (inclusive Prices, placeholder tax code `txcd_10103001` SaaS – Business Use until the advisor confirms). Re-run it whenever the catalog changes and put the printed Price IDs in `/etc/accessibility.env` — existing exclusive Prices cannot be converted. Point a webhook at `https://wcag.about-us.be/api/stripe/webhook` for `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `customer.subscription.*`, `invoice.paid`, `invoice.payment_failed`, `charge.refunded`, `charge.refund.updated`, `charge.dispute.created`, `charge.dispute.closed`. A pack refund removes tokens in proportion to the refunded amount (full refund: all of them; partial: the same share, rounded down). A dispute removes the whole pack until it is closed; a won dispute gives the tokens back. Duplicate deliveries of the same event id return 200 without granting again. Out-of-order `customer.subscription.deleted` events for an old subscription id are ignored when a newer id is already stored.

Pack Checkout sessions enable `invoice_creation` and print `COMPANY_LEGAL_NAME` / `COMPANY_VAT` on the invoice footer. **Set the subscription invoice template once in the Stripe Dashboard** (Settings → Billing → Invoices); the API does not attach that footer to `mode: 'subscription'` sessions.

Customer Portal: allow card update, monthly/yearly switch, and **cancel at period end**. Do not enable pause. Until keys are set, checkout and portal return **503**. `/pricing` still lists the catalog. Checkout requires the immediate-delivery withdrawal waiver and Stripe `consent_collection.terms_of_service`.

Us-diensten (manual AT, remediation, training) has **no Stripe SKU** — link to https://about-us.be/contact/.

To publish a change, follow **[deploy/README.md](../deploy/README.md)** as the `deploy` user (not `debian`): git pull, optional `npm ci`, Astro build, `systemctl restart accessibility.service`.

1. Put the Stripe variables above plus `COMPANY_LEGAL_NAME`, `COMPANY_KBO`, `COMPANY_VAT`, `COMPANY_ADDRESS`, and `COMPANY_EMAIL` in `/etc/accessibility.env` (`chmod 600`). Keep `STRIPE_AUTOMATIC_TAX=true` once Tax Settings have a Belgian head office and Collecting registrations. Production checkout refuses to start if automatic tax is off. Do not open Postgres `5432` to the internet.
2. In Stripe Dashboard → Developers → Webhooks, add `https://wcag.about-us.be/api/stripe/webhook` for the events listed above. Copy the signing secret into `STRIPE_WEBHOOK_SECRET`.
3. Dashboard → Tax: set the Belgian head office. Ask the advisor to record **Belgium domestic + Union OSS**. Dashboard → Settings → Billing → Invoices: set the subscription invoice footer to the company legal name and VAT. Threshold monitoring starts at the first **live** payment. Live Products/Prices and live `rk_` only after that confirmation.

## Testing Stripe locally

1. Put a sandbox restricted key (`rk_test_…`) in `.env.local` as `STRIPE_SECRET_KEY`.
2. Create the sandbox products and prices: `node scripts/stripe-catalog.mjs`. Copy the printed price ids into `.env.local`.
3. Forward webhooks to your machine with the Stripe CLI: `stripe listen --forward-to localhost:3456/api/stripe/webhook`. It prints a signing secret (`whsec_…`); set it as `STRIPE_WEBHOOK_SECRET` and restart the app.
4. Buy a pack with a [Stripe test card](https://docs.stripe.com/testing), for example `4242 4242 4242 4242`.

## Refunds and disputes

- A pack refund removes tokens in proportion to the refunded amount: a full refund removes all of them, a partial refund the same share of the pack, rounded down. Tokens already used are not charged back.
- A refund that later fails gives the tokens back.
- A dispute removes the whole pack until it is closed; a won dispute restores it. This needs the `charge.dispute.closed` event on the webhook.
