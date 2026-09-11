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
process.env.STRIPE_PRICE_STARTER = 'price_starter_test';
process.env.STRIPE_PRICE_PRO = 'price_pro_test';
delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_API_KEY;
delete process.env.STRIPE_WEBHOOK_SECRET;

const { createUser } = await import('../server/users.mjs');
const { getSubscription, listPayments } = await import('../server/billing.mjs');
const {
  applyStripeSubscription,
  fulfillCheckoutSession,
  handleStripeEvent,
  planIdFromPrice,
  priceIdForPlan,
  recordStripeInvoice,
  stripeConfigured,
} = await import('../server/stripe.mjs');
const { createAccessibilityApp } = await import('../server/create-app.mjs');

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

function fakeSub({ userId, status = 'active', price = 'price_starter_test', customer = 'cus_test' }) {
  return {
    id: 'sub_test',
    status,
    customer,
    metadata: { userId, planId: 'starter' },
    current_period_start: 1_700_000_000,
    current_period_end: 1_702_592_000,
    items: { data: [{ price: { id: price } }] },
  };
}

describe('stripe catalog mapping', () => {
  it('maps env price ids onto paid plans only', () => {
    assert.equal(priceIdForPlan('starter'), 'price_starter_test');
    assert.equal(planIdFromPrice('price_pro_test'), 'pro');
    assert.equal(priceIdForPlan('free'), '');
    assert.equal(stripeConfigured(), false);
  });
});

describe('stripe fulfillment', () => {
  it('upgrades a customer from webhook payloads and records a paid invoice once', async () => {
    const { user } = await createUser({
      email: 'stripe-user@example.com',
      password: 'longenough1',
      name: 'Stripe',
    });
    await applyStripeSubscription(fakeSub({ userId: user.id }));
    const upgraded = await getSubscription(user.id);
    assert.equal(upgraded.planId, 'starter');
    assert.equal(upgraded.status, 'active');
    assert.equal(upgraded.stripeCustomerId, 'cus_test');

    const invoice = {
      id: 'in_test',
      amount_paid: 2900,
      currency: 'eur',
      customer: 'cus_test',
      subscription: 'sub_test',
      payment_intent: 'pi_test',
      hosted_invoice_url: 'https://invoice.stripe.com/test',
      created: 1_700_000_100,
      lines: { data: [{ description: 'Us accessibility Starter' }] },
    };
    await recordStripeInvoice(invoice);
    await recordStripeInvoice(invoice);
    const payments = await listPayments(user.id);
    assert.equal(payments.length, 1);
    assert.equal(payments[0].amountCents, 2900);
    assert.equal(payments[0].stripePaymentIntentId, 'pi_test');
  });

  it('returns a canceled Stripe subscription to the free plan', async () => {
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
    assert.equal(sub.planId, 'free');
    assert.equal(sub.status, 'canceled');
  });

  it('does not fulfill an unpaid checkout session', async () => {
    const { user } = await createUser({
      email: 'stripe-unpaid@example.com',
      password: 'longenough1',
    });
    const result = await fulfillCheckoutSession({
      mode: 'subscription',
      payment_status: 'unpaid',
      metadata: { userId: user.id, planId: 'starter' },
      customer: 'cus_unpaid',
      subscription: fakeSub({ userId: user.id }),
    });
    assert.equal(result, null);
    const sub = await getSubscription(user.id);
    assert.equal(sub.planId, 'free');
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

  it('lists plans without Stripe keys and returns 503 for checkout', async () => {
    const cfg = await fetch(`${origin}/api/billing/config`);
    const body = await cfg.json();
    assert.equal(cfg.status, 200);
    assert.equal(body.configured, false);
    assert.ok(body.plans.some((p) => p.id === 'starter' && p.priceCents === 2900 && p.checkoutReady === false));

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
      body: JSON.stringify({ planId: 'starter' }),
    });
    assert.equal(checkout.status, 503);
    const webhook = await fetch(`${origin}/api/stripe/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(webhook.status, 503);
  });

  it('exposes pricing markup and account billing controls', () => {
    const pricing = readFileSync(join(repoRoot, 'web/src/pages/pricing.astro'), 'utf8');
    assert.match(pricing, /id="pricing-grid"/);
    assert.match(pricing, /\/api\/billing\/checkout/);
    const account = readFileSync(join(repoRoot, 'web/src/pages/account.astro'), 'utf8');
    assert.match(account, /id="manage-billing-btn"/);
    assert.match(account, /\/api\/billing\/portal/);
    const home = readFileSync(join(repoRoot, 'web/src/pages/index.astro'), 'utf8');
    assert.match(home, /href="\/pricing"/);
  });

  it('closes the test server', async () => {
    await new Promise((resolve) => server.close(resolve));
  });
});
