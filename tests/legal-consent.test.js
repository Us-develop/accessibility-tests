import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const tmp = mkdtempSync(join(tmpdir(), 'wcag-legal-'));
process.env.REPORTS_BASE = tmp;
process.env.AUTH_ENABLED = 'true';
process.env.APP_USERNAME = 'root';
process.env.APP_PASSWORD = 'staff-secret-pass';
process.env.SESSION_SECRET = 'unit-test-session-secret-32chars!!';
process.env.WCAG_DISABLE_RATE_LIMIT = '1';
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

const { createAccessibilityApp } = await import('../server/create-app.mjs');
const { listConsents } = await import('../server/consents.mjs');
const { LEGAL_PRIVACY_VERSION, LEGAL_TERMS_VERSION, WITHDRAWAL_WAIVER_TEXT } =
  await import('../server/legal-versions.mjs');
const { setStripeClientForTests } = await import('../server/stripe.mjs');
const { getUserByEmail } = await import('../server/users.mjs');

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

after(() => {
  setStripeClientForTests(null);
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

function stubCheckoutClient(created) {
  const client = {
    customers: {
      retrieve: async () => {
        const err = new Error('No such customer');
        throw err;
      },
      create: async () => ({ id: 'cus_stub' }),
      createTaxId: async () => ({ id: 'txi_stub' }),
    },
    checkout: {
      sessions: {
        create: async (payload) => {
          created.push(payload);
          return { id: 'cs_stub', url: 'https://checkout.stripe.com/c/pay/stub' };
        },
      },
    },
  };
  setStripeClientForTests(client);
  return client;
}

describe('legal consent and VAT', () => {
  let server;
  let origin;

  it('starts the app with static legal HTML (no directory redirect)', async () => {
    const clientRoot = join(tmp, 'dist-client');
    mkdirSync(join(clientRoot, 'privacy'), { recursive: true });
    writeFileSync(
      join(clientRoot, 'privacy', 'index.html'),
      '<!doctype html><html><body><h1>Privacy notice</h1></body></html>'
    );
    const app = express();
    app.use(createAccessibilityApp(repoRoot));
    app.use(express.static(clientRoot, { redirect: false }));
    const listening = await listen(app);
    server = listening.server;
    origin = listening.origin;
  });

  it('serves GET /privacy to a guest as 200 HTML with the privacy heading, not a redirect', async () => {
    const res = await fetch(`${origin}/privacy`, { redirect: 'manual' });
    const html = await res.text();
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('location'), null);
    assert.match(html, /<h1>Privacy notice<\/h1>/);
  });

  it('rejects signup without acceptTerms and does not create a user', async () => {
    const res = await fetch(`${origin}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'no-terms@example.com', password: 'longenough1' }),
    });
    assert.equal(res.status, 400);
    assert.equal(await getUserByEmail('no-terms@example.com'), null);
  });

  it('stores terms and privacy consents at the current versions when the box is ticked', async () => {
    const jar = new CookieJar();
    const res = await fetch(`${origin}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'with-terms@example.com',
        password: 'longenough1',
        name: 'Legal',
        acceptTerms: true,
      }),
    });
    jar.store(res.headers);
    const data = await res.json();
    assert.equal(res.status, 200, data.error || '');
    const rows = await listConsents({ userId: data.user.id });
    const kinds = rows.map((row) => row.kind).sort();
    assert.deepEqual(kinds, ['privacy', 'terms']);
    const terms = rows.find((row) => row.kind === 'terms');
    const privacy = rows.find((row) => row.kind === 'privacy');
    assert.equal(terms.version, LEGAL_TERMS_VERSION);
    assert.equal(privacy.version, LEGAL_PRIVACY_VERSION);
  });

  it('rejects checkout without the withdrawal waiver', async () => {
    const jar = new CookieJar();
    const signup = await fetch(`${origin}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'checkout-nowaiver@example.com',
        password: 'longenough1',
        acceptTerms: true,
      }),
    });
    jar.store(signup.headers);
    const checkout = await fetch(`${origin}/api/billing/checkout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: jar.header(),
        'X-CSRF-Token': jar.get('wcag_csrf'),
      },
      body: JSON.stringify({ kind: 'pack', packId: 'pack_10' }),
    });
    assert.equal(checkout.status, 400);
  });

  it('records a withdrawal waiver and sends consent_collection to Stripe', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_legal_stub';
    const created = [];
    stubCheckoutClient(created);
    const jar = new CookieJar();
    const signup = await fetch(`${origin}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'checkout-waiver@example.com',
        password: 'longenough1',
        acceptTerms: true,
      }),
    });
    jar.store(signup.headers);
    const account = await fetch(`${origin}/api/account`, { headers: { cookie: jar.header() } });
    const bundle = await account.json();
    const checkout = await fetch(`${origin}/api/billing/checkout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: jar.header(),
        'X-CSRF-Token': jar.get('wcag_csrf'),
      },
      body: JSON.stringify({ kind: 'pack', packId: 'pack_10', withdrawalWaiver: true }),
    });
    const body = await checkout.json();
    assert.equal(checkout.status, 200, body.error || '');
    assert.equal(body.url, 'https://checkout.stripe.com/c/pay/stub');
    assert.equal(created.length, 1);
    assert.equal(created[0].consent_collection.terms_of_service, 'required');
    assert.equal(created[0].custom_text.terms_of_service_acceptance.message, WITHDRAWAL_WAIVER_TEXT);
    assert.equal(created[0].invoice_creation.enabled, true);
    const waivers = await listConsents({ userId: bundle.user.id, kind: 'withdrawal_waiver' });
    assert.equal(waivers.length, 1);
    assert.equal(waivers[0].context.packId, 'pack_10');
    assert.equal(waivers[0].context.customerType, 'consumer');
    setStripeClientForTests(null);
    delete process.env.STRIPE_SECRET_KEY;
  });

  it('refuses production checkout when automatic tax is disabled', async () => {
    const prevNode = process.env.NODE_ENV;
    const prevTax = process.env.STRIPE_AUTOMATIC_TAX;
    process.env.NODE_ENV = 'production';
    process.env.STRIPE_AUTOMATIC_TAX = 'false';
    process.env.STRIPE_SECRET_KEY = 'sk_test_legal_stub';
    process.env.COMPANY_LEGAL_NAME = 'Example BV';
    process.env.COMPANY_KBO = '0123.456.789';
    process.env.COMPANY_VAT = 'BE0123456789';
    process.env.COMPANY_ADDRESS = 'Example street 1, 1000 Brussels';
    process.env.COMPANY_EMAIL = 'privacy@example.com';
    const created = [];
    stubCheckoutClient(created);
    try {
      const jar = new CookieJar();
      const signup = await fetch(`${origin}/api/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'tax-off@example.com',
          password: 'longenough1',
          acceptTerms: true,
        }),
      });
      jar.store(signup.headers);
      const checkout = await fetch(`${origin}/api/billing/checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: jar.header(),
          'X-CSRF-Token': jar.get('wcag_csrf'),
        },
        body: JSON.stringify({ kind: 'pro', interval: 'monthly', withdrawalWaiver: true }),
      });
      assert.equal(checkout.status, 503);
      assert.equal(created.length, 0);
    } finally {
      setStripeClientForTests(null);
      delete process.env.STRIPE_SECRET_KEY;
      if (prevTax === undefined) delete process.env.STRIPE_AUTOMATIC_TAX;
      else process.env.STRIPE_AUTOMATIC_TAX = prevTax;
      if (prevNode === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNode;
    }
  });

  it('closes the test server', async () => {
    await new Promise((resolve) => server.close(resolve));
  });
});
