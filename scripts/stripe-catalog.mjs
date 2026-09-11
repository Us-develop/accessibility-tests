#!/usr/bin/env node
/**
 * Create sandbox Stripe Products/Prices for the commercial catalog.
 * Never logs secret keys. Prints price IDs for VPS env.
 *
 * Usage (sandbox key in the environment, not git):
 *   STRIPE_SECRET_KEY=rk_test_... STRIPE_TAX_CODE=txcd_10103001 node scripts/stripe-catalog.mjs
 */
import Stripe from 'stripe';

const TAX_CODE = String(process.env.STRIPE_TAX_CODE || 'txcd_10103001').trim();
const KEY = String(process.env.STRIPE_SECRET_KEY || process.env.STRIPE_API_KEY || '').trim();

const ITEMS = [
  {
    key: 'pack_10',
    name: 'WCAG tokens · 10',
    description: '10 URL-scans. Unused tokens expire after 12 months.',
    env: 'STRIPE_PRICE_PACK_10',
    price: { currency: 'eur', unit_amount: 1000 },
  },
  {
    key: 'pack_50',
    name: 'WCAG tokens · 50',
    description: '50 URL-scans (−10%). Unused tokens expire after 12 months.',
    env: 'STRIPE_PRICE_PACK_50',
    price: { currency: 'eur', unit_amount: 4500 },
  },
  {
    key: 'pack_100',
    name: 'WCAG tokens · 100',
    description: '100 URL-scans (−20%). Unused tokens expire after 12 months.',
    env: 'STRIPE_PRICE_PACK_100',
    price: { currency: 'eur', unit_amount: 8000 },
  },
  {
    key: 'pro',
    name: 'WCAG Pro',
    description: '300 page-scans / month, 50 URLs per run, full dashboard and deliverables.',
    prices: [
      { env: 'STRIPE_PRICE_PRO_MONTHLY', currency: 'eur', unit_amount: 4900, recurring: { interval: 'month' } },
      { env: 'STRIPE_PRICE_PRO_YEARLY', currency: 'eur', unit_amount: 49000, recurring: { interval: 'year' } },
    ],
  },
];

async function findProduct(stripe, key) {
  const listed = await stripe.products.list({ limit: 100, active: true });
  return listed.data.find((product) => product.metadata?.catalog_key === key) || null;
}

async function ensurePrice(stripe, productId, spec) {
  const listed = await stripe.prices.list({ product: productId, limit: 100, active: true });
  const match = listed.data.find((price) => {
    if (price.currency !== spec.currency || price.unit_amount !== spec.unit_amount) return false;
    if (spec.recurring) {
      return price.recurring?.interval === spec.recurring.interval && price.type === 'recurring';
    }
    return price.type === 'one_time';
  });
  if (match) return match;
  return stripe.prices.create({
    product: productId,
    currency: spec.currency,
    unit_amount: spec.unit_amount,
    tax_behavior: 'exclusive',
    recurring: spec.recurring,
    metadata: { catalog_env: spec.env },
  });
}

async function main() {
  if (!KEY) {
    console.error('Set STRIPE_SECRET_KEY (restricted rk_ preferred). Do not commit it.');
    process.exit(1);
  }
  if (KEY.startsWith('sk_live') || KEY.startsWith('rk_live')) {
    console.error('Refusing to run against a live key. Use a sandbox restricted key.');
    process.exit(1);
  }
  const stripe = new Stripe(KEY, { apiVersion: '2026-08-26.dahlia' });
  const lines = [];
  for (const item of ITEMS) {
    let product = await findProduct(stripe, item.key);
    if (!product) {
      product = await stripe.products.create({
        name: item.name,
        description: item.description,
        tax_code: TAX_CODE,
        metadata: { catalog_key: item.key },
      });
    } else if (!product.tax_code) {
      await stripe.products.update(product.id, { tax_code: TAX_CODE });
    }
    const specs = item.prices || [{ ...item.price, env: item.env }];
    for (const spec of specs) {
      const price = await ensurePrice(stripe, product.id, spec);
      lines.push(`${spec.env}=${price.id}`);
    }
  }
  console.log('Sandbox catalog ready. Put these in the VPS env (not git):\n');
  for (const line of lines) console.log(line);
  console.log('\nTax code placeholder:', TAX_CODE, '(confirm with your advisor before live).');
  console.log('Leave STRIPE_AUTOMATIC_TAX=false until Tax Settings have a head office and Collecting registrations.');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
