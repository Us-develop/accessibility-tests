/**
 * Creates one Stripe Product + monthly Price per paid WCAG plan.
 * Prints env lines for STRIPE_PRICE_*. Confirm the tax code with your advisor:
 * https://docs.stripe.com/tax/tax-codes
 *
 * Usage: STRIPE_SECRET_KEY=rk_test_... node scripts/stripe-catalog.mjs
 */
import Stripe from 'stripe';
import { DEFAULT_PLANS } from '../server/plan-catalog.mjs';

const TAX_CODE = String(process.env.STRIPE_TAX_CODE || '').trim();
const key = String(process.env.STRIPE_SECRET_KEY || process.env.STRIPE_API_KEY || '').trim();

if (!key) {
  console.error('Set STRIPE_SECRET_KEY (prefer a restricted key, rk_) before running this script.');
  process.exit(1);
}

if (!TAX_CODE) {
  console.error(
    'Set STRIPE_TAX_CODE to a code from https://docs.stripe.com/tax/tax-codes (SaaS is often listed as txcd_10103001 — confirm with your tax advisor).'
  );
  process.exit(1);
}

const stripe = new Stripe(key, { apiVersion: '2026-08-26.dahlia' });
const paid = DEFAULT_PLANS.filter((plan) => plan.id !== 'free' && plan.priceCents > 0);

for (const plan of paid) {
  const product = await stripe.products.create({
    name: `Us accessibility ${plan.name}`,
    description: `${plan.maxScansPerMonth ?? 'Unlimited'} scans / month, ${plan.maxPagesPerScan ?? 'unlimited'} page(s) per scan.`,
    tax_code: TAX_CODE,
    metadata: { planId: plan.id },
  });
  const price = await stripe.prices.create({
    product: product.id,
    currency: 'eur',
    unit_amount: plan.priceCents,
    recurring: { interval: 'month' },
    tax_behavior: 'exclusive',
    metadata: { planId: plan.id },
  });
  console.log(`STRIPE_PRICE_${plan.id.toUpperCase()}=${price.id}`);
}
