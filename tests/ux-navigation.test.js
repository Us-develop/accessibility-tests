import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const tmp = mkdtempSync(join(tmpdir(), 'wcag-ux-nav-'));
process.env.REPORTS_BASE = tmp;
process.env.AUTH_ENABLED = 'true';
process.env.APP_USERNAME = 'root';
process.env.APP_PASSWORD = 'staff-secret-pass';
process.env.SESSION_SECRET = 'unit-test-session-secret-32chars!!';
process.env.WCAG_DISABLE_RATE_LIMIT = '1';
process.env.AUTH_EMAIL_VERIFY = 'auto';
process.env.DEFER_ROOT_LOGIN_TO_SHELL = 'true';

const { balanceEmpty, balanceFromUsage, balanceLong, balanceShort } = await import('../web/src/lib/balance.js');
const { createAccessibilityApp } = await import('../server/create-app.mjs');
const { applyStripeSubscription } = await import('../server/stripe.mjs');
const { incrementUsage } = await import('../server/billing.mjs');

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(repoRoot, path), 'utf8');
after(() => rmSync(tmp, { recursive: true, force: true }));

describe('balance wording', () => {
  it('shows tokens only for an account without Pro', () => {
    const b = balanceFromUsage({ pro: false, tokens: { tokens: 12 }, pagesScanned: 4, pagesPerMonth: 300 });
    assert.equal(balanceShort(b, 'en'), '12 tokens');
    assert.equal(balanceLong(b, 'en'), '12 tokens left');
    assert.equal(balanceLong(b, 'nl'), '12 tokens over');
    assert.equal(balanceEmpty(b), false);
  });

  it('adds the Pro pages left this month', () => {
    const b = balanceFromUsage({ pro: true, tokens: { tokens: 1 }, pagesScanned: 60, pagesPerMonth: 300 });
    assert.equal(balanceShort(b, 'en'), '1 token · 240 Pro pages');
    assert.equal(balanceLong(b, 'en'), '240 of 300 Pro pages left this month · 1 token left');
    assert.equal(balanceShort(b, 'nl'), "1 token · 240 Pro-pagina's");
  });

  it('knows when nothing is left', () => {
    assert.equal(balanceEmpty(balanceFromUsage({ pro: false, tokens: { tokens: 0 } })), true);
    assert.equal(balanceEmpty(balanceFromUsage({ pro: true, tokens: { tokens: 0 }, pagesScanned: 300, pagesPerMonth: 300 })), true);
    assert.equal(balanceEmpty(balanceFromUsage({ pro: true, tokens: { tokens: 0 }, pagesScanned: 10, pagesPerMonth: 300 })), false);
    assert.equal(balanceEmpty(null), false);
  });
});

describe('usage API feeds the balance', () => {
  it('reports tokens for a new account and Pro pages once subscribed', async () => {
    const app = createAccessibilityApp(repoRoot);
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    try {
      const signup = await fetch(`${origin}/api/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'balance@example.com', password: 'longenough1', acceptTerms: true }),
      });
      const cookie = signup.headers.getSetCookie().map((line) => line.split(';')[0]).join('; ');
      const userId = (await signup.json()).user.id;

      const fresh = await (await fetch(`${origin}/api/account/usage`, { headers: { cookie } })).json();
      assert.equal(fresh.pro, false);
      assert.equal(fresh.pagesLeft, 0);
      assert.equal(balanceShort(balanceFromUsage(fresh), 'en'), '1 token');

      await applyStripeSubscription({
        id: 'sub_balance',
        status: 'active',
        customer: 'cus_balance',
        metadata: { userId },
        items: { data: [{ price: { id: 'price_x', recurring: { interval: 'month' } } }] },
      });
      await incrementUsage(userId, { scans: 1, pages: 25 });
      const pro = await (await fetch(`${origin}/api/account/usage`, { headers: { cookie } })).json();
      assert.equal(pro.pro, true);
      assert.equal(pro.pagesPerMonth, 300);
      assert.equal(pro.pagesLeft, 275);

      const guest = await fetch(`${origin}/api/account/usage`);
      assert.notEqual(guest.status, 200);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

describe('getting around', () => {
  const header = read('web/src/components/AppHeader.astro');
  const home = read('web/src/pages/index.astro');

  it('has a Start new scan link and a balance link in the header', () => {
    assert.match(header, /href="\/"[^>]*>\{tr\('header\.startScan'\)\}<\/a>/);
    assert.match(header, /id="wcag-header-balance"/);
    assert.match(header, /href="\/account#tokens"/);
    assert.match(header, /globalThis\.__wcagHeaderLoginBound/);
    assert.match(read('web/src/pages/account.astro'), /id="tokens"/);
  });

  it('offers both paid plans as buttons to guests on the homepage', () => {
    assert.match(home, /class="btn btn-secondary" href="\/pricing#tokens">Buy tokens<\/a>/);
    assert.match(home, /class="btn btn-secondary" href="\/pricing#pro">Subscribe to Pro<\/a>/);
    const pricing = read('web/src/pages/pricing.astro');
    assert.match(pricing, /id="tokens"/);
    assert.match(pricing, /id="pro"/);
  });

  it('uses the shared balance helper on the homepage instead of its own sums', () => {
    assert.match(home, /from '\.\.\/lib\/balance\.js'/);
    assert.doesNotMatch(home, /\/300 pages this month/);
  });
});
