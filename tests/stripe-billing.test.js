import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const tmp = mkdtempSync(join(tmpdir(), 'wcag-stripe-'));
process.env.REPORTS_BASE = tmp;
process.env.AUTH_ENABLED = 'true';
process.env.APP_USERNAME = 'root';
process.env.APP_PASSWORD = 'staff-secret-pass';
process.env.SESSION_SECRET = 'unit-test-session-secret';
process.env.AUTH_EMAIL_VERIFY = 'auto';
process.env.DEFER_ROOT_LOGIN_TO_SHELL = 'true';
process.env.STRIPE_PRICE_PACK_10 = 'price_pack10_test';
process.env.STRIPE_PRICE_PACK_50 = 'price_pack50_test';
process.env.STRIPE_PRICE_PACK_100 = 'price_pack100_test';
process.env.STRIPE_PRICE_PRO_MONTHLY = 'price_pro_month_test';
process.env.STRIPE_PRICE_PRO_YEARLY = 'price_pro_year_test';
delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_API_KEY;
delete process.env.STRIPE_WEBHOOK_SECRET;

const { createUser } = await import('../server/users.mjs');
const { assertCustomerCanScan, getSubscription, incrementUsage, listPayments, upsertSubscription } =
  await import('../server/billing.mjs');
const { consumeTokens, getTokenBalance, grantTokenPack } = await import('../server/tokens.mjs');
const {
  applyStripeSubscription,
  automaticTaxEnabled,
  fulfillCheckoutSession,
  handleStripeEvent,
  packIdFromPrice,
  priceIdForPack,
  priceIdForPro,
  proIntervalFromPrice,
  recordStripeInvoice,
  stripeConfigured,
} = await import('../server/stripe.mjs');
const { createAccessibilityApp } = await import('../server/create-app.mjs');
const { setQueueExecutor } = await import('../server/queue.mjs');

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

after(() => {
  rmSync(tmp, { recursive: true, force: true });
});

class CookieJar {
  constructor() {
    this.map = new Map();
  }

  store(headers) {
    const lines = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [];
    for (const line of lines) {
      const pair = String(line).split(';')[0];
      const idx = pair.indexOf('=');
      if (idx === -1) continue;
      const name = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();
      if (!name) continue;
      if (value === '') this.map.delete(name);
      else this.map.set(name, value);
    }
  }

  header() {
    return [...this.map.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  get(name) {
    return this.map.get(name) || '';
  }
}

function listen(app) {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({ server, origin: `http://127.0.0.1:${addr.port}` });
    });
  });
}

function fakeSub({ userId, status = 'active', price = 'price_pro_month_test', customer = 'cus_test' }) {
  return {
    id: 'sub_test',
    status,
    customer,
    cancel_at_period_end: false,
    metadata: { userId, planId: 'pro' },
    current_period_start: 1_700_000_000,
    current_period_end: 1_702_592_000,
    items: { data: [{ price: { id: price, recurring: { interval: price.includes('year') ? 'year' : 'month' } } }] },
  };
}

describe('stripe catalog mapping', () => {
  it('maps env price ids onto packs and Pro intervals', () => {
    assert.equal(priceIdForPack('pack_10'), 'price_pack10_test');
    assert.equal(packIdFromPrice('price_pack50_test'), 'pack_50');
    assert.equal(priceIdForPro('monthly'), 'price_pro_month_test');
    assert.equal(proIntervalFromPrice('price_pro_year_test'), 'yearly');
    assert.equal(automaticTaxEnabled(), false);
    assert.equal(stripeConfigured(), false);
  });
});

describe('stripe fulfillment', () => {
  it('upgrades to Pro from a subscription webhook and records an invoice once', async () => {
    const { user } = await createUser({
      email: 'stripe-user@example.com',
      password: 'longenough1',
      name: 'Stripe',
    });
    await applyStripeSubscription(fakeSub({ userId: user.id }));
    const upgraded = await getSubscription(user.id);
    assert.equal(upgraded.planId, 'pro');
    assert.equal(upgraded.status, 'active');
    assert.equal(upgraded.billingInterval, 'monthly');

    const invoice = {
      id: 'in_test',
      amount_paid: 4900,
      currency: 'eur',
      customer: 'cus_test',
      subscription: 'sub_test',
      payment_intent: 'pi_test',
      hosted_invoice_url: 'https://invoice.stripe.com/test',
      created: 1_700_000_100,
      lines: { data: [{ description: 'Us accessibility Pro' }] },
    };
    await recordStripeInvoice(invoice);
    await recordStripeInvoice(invoice);
    const payments = await listPayments(user.id);
    assert.equal(payments.length, 1);
    assert.equal(payments[0].amountCents, 4900);
  });

  it('returns a canceled Stripe subscription to none', async () => {
    const { user } = await createUser({
      email: 'stripe-cancel@example.com',
      password: 'longenough1',
    });
    await applyStripeSubscription(fakeSub({ userId: user.id }));
    await handleStripeEvent({
      type: 'customer.subscription.deleted',
      data: { object: fakeSub({ userId: user.id, status: 'canceled' }) },
    });
    const sub = await getSubscription(user.id);
    assert.equal(sub.planId, 'none');
    assert.equal(sub.status, 'canceled');
  });

  it('grants tokens from a paid checkout session and ignores unpaid ones', async () => {
    const { user } = await createUser({
      email: 'stripe-tokens@example.com',
      password: 'longenough1',
    });
    const unpaid = await fulfillCheckoutSession({
      id: 'cs_unpaid',
      mode: 'payment',
      payment_status: 'unpaid',
      metadata: { userId: user.id, packId: 'pack_10', tokens: '10' },
    });
    assert.equal(unpaid, null);
    assert.equal((await getTokenBalance(user.id)).tokens, 0);

    const lot = await fulfillCheckoutSession({
      id: 'cs_paid',
      mode: 'payment',
      payment_status: 'paid',
      amount_total: 1000,
      currency: 'eur',
      created: Math.floor(Date.now() / 1000),
      payment_intent: 'pi_pack',
      metadata: { userId: user.id, packId: 'pack_10', tokens: '10' },
      client_reference_id: user.id,
    });
    assert.equal(lot.tokensGranted, 10);
    await fulfillCheckoutSession({
      id: 'cs_paid',
      mode: 'payment',
      payment_status: 'paid',
      payment_intent: 'pi_pack',
      metadata: { userId: user.id, packId: 'pack_10', tokens: '10' },
    });
    assert.equal((await getTokenBalance(user.id)).tokens, 10);

    await handleStripeEvent({
      type: 'charge.refunded',
      data: { object: { payment_intent: 'pi_pack' } },
    });
    assert.equal((await getTokenBalance(user.id)).tokens, 0);
  });

  it('does not fulfill an unpaid Pro checkout session', async () => {
    const { user } = await createUser({
      email: 'stripe-unpaid@example.com',
      password: 'longenough1',
    });
    const result = await fulfillCheckoutSession({
      mode: 'subscription',
      payment_status: 'unpaid',
      metadata: { userId: user.id, planId: 'pro' },
      customer: 'cus_unpaid',
      subscription: fakeSub({ userId: user.id }),
    });
    assert.equal(result, null);
    const sub = await getSubscription(user.id);
    assert.equal(sub.planId, 'none');
  });
});

describe('token entitlements', () => {
  it('spends FIFO lots, skips expired tokens, and caps Pro at 300 pages', async () => {
    const { user } = await createUser({
      email: 'entitlements@example.com',
      password: 'longenough1',
    });
    await assert.rejects(() => assertCustomerCanScan(user.id, { pages: 1 }), /token|Pro/i);

    const expired = new Date(Date.now() - 86400000).toISOString();
    await grantTokenPack({
      userId: user.id,
      packId: 'pack_10',
      tokens: 5,
      purchasedAt: '2020-01-01T00:00:00.000Z',
      stripeCheckoutSessionId: 'cs_old',
    });
    const lotsFile = JSON.parse(
      readFileSync(join(tmp, '_saas', 'token-lots.json'), 'utf8')
    );
    const old = lotsFile.lots.find((lot) => lot.stripeCheckoutSessionId === 'cs_old');
    old.expiresAt = expired;
    const { writeJsonStore } = await import('../server/json-store.mjs');
    writeJsonStore('token-lots.json', lotsFile);

    await grantTokenPack({ userId: user.id, packId: 'pack_10', tokens: 3, stripeCheckoutSessionId: 'cs_new' });
    assert.equal((await getTokenBalance(user.id)).tokens, 3);
    await consumeTokens(user.id, 2);
    assert.equal((await getTokenBalance(user.id)).tokens, 1);

    const sub = await getSubscription(user.id);
    await upsertSubscription({ ...sub, planId: 'pro', status: 'active' });
    await incrementUsage(user.id, { scans: 1, pages: 300 });
    await assert.rejects(() => assertCustomerCanScan(user.id, { pages: 2 }), /Pro pages|tokens/i);
    const overflow = await assertCustomerCanScan(user.id, { pages: 1 });
    assert.equal(overflow.pagesFromTokens, 1);

    await assert.rejects(() => assertCustomerCanScan(user.id, { pages: 51 }), /50 page/);
  });
});

describe('stripe HTTP', () => {
  let server;
  let origin;

  it('starts the app', async () => {
    const app = createAccessibilityApp(repoRoot);
    const listening = await listen(app);
    server = listening.server;
    origin = listening.origin;
  });

  it('lists the commercial catalog without Stripe keys and returns 503 for checkout', async () => {
    const cfg = await fetch(`${origin}/api/billing/config`);
    const body = await cfg.json();
    assert.equal(cfg.status, 200);
    assert.equal(body.configured, false);
    assert.ok(body.packs.some((p) => p.id === 'pack_10' && p.priceCents === 1000));
    assert.equal(body.pro.monthlyPriceCents, 4900);
    assert.equal(body.pro.yearlyPriceCents, 49000);

    const jar = new CookieJar();
    const signup = await fetch(`${origin}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'stripe-http@example.com', password: 'longenough1' }),
    });
    jar.store(signup.headers);
    const checkout = await fetch(`${origin}/api/billing/checkout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: jar.header(),
        'X-CSRF-Token': jar.get('wcag_csrf'),
      },
      body: JSON.stringify({ kind: 'pro', interval: 'monthly' }),
    });
    assert.equal(checkout.status, 503);
    const webhook = await fetch(`${origin}/api/stripe/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(webhook.status, 503);
  });

  it('exposes pricing markup, account billing, and legal drafts', () => {
    const pricing = readFileSync(join(repoRoot, 'web/src/pages/pricing.astro'), 'utf8');
    assert.match(pricing, /Gratis snapshot/);
    assert.match(pricing, /Buy 10/);
    assert.match(pricing, /Subscribe monthly/);
    assert.match(pricing, /Us-diensten/);
    assert.match(pricing, /\/api\/billing\/checkout/);
    const account = readFileSync(join(repoRoot, 'web/src/pages/account.astro'), 'utf8');
    assert.match(account, /id="manage-billing-btn"/);
    assert.match(account, /token-buy/);
    assert.match(account, /Cancel at the end of the billing period/);
    assert.doesNotMatch(account, /pause/i);
    const home = readFileSync(join(repoRoot, 'web/src/pages/index.astro'), 'utf8');
    assert.match(home, /href="\/pricing"/);
    assert.match(home, /fd\.set\('urls', urls\)/);
    assert.match(home, /Request Us-diensten/);
    const terms = readFileSync(join(repoRoot, 'web/src/pages/terms.astro'), 'utf8');
    assert.match(terms, /Lawyer review required/);
  });

  it('does not decrement tokens for a guest snapshot', async () => {
    setQueueExecutor(async () => {});
    const { user } = await createUser({
      email: 'guest-tokens@example.com',
      password: 'longenough1',
    });
    await grantTokenPack({ userId: user.id, packId: 'pack_10', tokens: 10 });
    const before = (await getTokenBalance(user.id)).tokens;
    const run = await fetch(`${origin}/api/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com' }),
    });
    const body = await run.json();
    assert.equal(run.status, 200);
    assert.ok(body.guestToken);
    assert.equal((await getTokenBalance(user.id)).tokens, before);
  });

  it('closes the test server', async () => {
    await new Promise((resolve) => server.close(resolve));
  });
});
