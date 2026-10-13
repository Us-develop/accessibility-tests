import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_API_KEY;

const { checkoutItemFromButton, parseCheckoutItem, signupHrefForItem } = await import('../web/src/lib/checkout.js');
const { NONE_PLAN_ID, PRO_PLAN_ID, planFeatureList } = await import('../server/plan-catalog.mjs');
const {
  customerLoginNext,
  isPricingNext,
  pendingNextFromCookieHeader,
  pendingNextSetCookie,
  safeNextAfterLogin,
} = await import('../server/login-redirect.mjs');
const { billingPublicConfig } = await import('../server/stripe.mjs');

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(repoRoot, path), 'utf8');

describe('plan feature lists', () => {
  const byKey = (list) => Object.fromEntries(list.map((f) => [f.key, f.included]));

  it('gives the token tier the full report but not the sales report or Jira', () => {
    const tokens = byKey(planFeatureList(NONE_PLAN_ID));
    assert.equal(tokens.fullReport, true);
    assert.equal(tokens.developerGuide, true);
    assert.equal(tokens.statement, true);
    assert.equal(tokens.salesReport, false);
    assert.equal(tokens.jira, false);
  });

  it('gives Pro everything', () => {
    assert.equal(planFeatureList(PRO_PLAN_ID).every((f) => f.included), true);
  });

  it('lists the same features in the same order for both tiers', () => {
    assert.deepEqual(
      planFeatureList(NONE_PLAN_ID).map((f) => f.label),
      planFeatureList(PRO_PLAN_ID).map((f) => f.label)
    );
  });
});

describe('resuming checkout after sign-up', () => {
  it('recognises the items that can be bought and nothing else', () => {
    assert.deepEqual(parseCheckoutItem('pack_50'), { item: 'pack_50', body: { kind: 'pack', packId: 'pack_50' } });
    assert.deepEqual(parseCheckoutItem('pro-yearly'), { item: 'pro-yearly', body: { kind: 'pro', interval: 'yearly' } });
    for (const bad of ['pack_5', 'pack_50&x', 'pro', 'pro-weekly', '', null, '<script>']) {
      assert.equal(parseCheckoutItem(bad), null, String(bad));
    }
  });

  it('reads the item from a button', () => {
    const btn = (attrs) => ({ getAttribute: (name) => attrs[name] ?? null });
    assert.equal(checkoutItemFromButton(btn({ 'data-kind': 'pack', 'data-pack': 'pack_10' })).item, 'pack_10');
    assert.equal(checkoutItemFromButton(btn({ 'data-kind': 'pro', 'data-interval': 'yearly' })).item, 'pro-yearly');
    assert.equal(checkoutItemFromButton(btn({ 'data-pack': 'pack_100' })).item, 'pack_100');
  });

  it('sends a signed-out buyer to sign up with the item in next', () => {
    assert.equal(signupHrefForItem('pack_50'), '/signup?next=%2Fpricing%3Fcheckout%3Dpack_50');
  });

  it('keeps the item through the login redirect helpers and the wcag_next cookie', () => {
    const target = '/pricing?checkout=pack_50';
    assert.equal(safeNextAfterLogin(target), target);
    assert.equal(customerLoginNext(target), target);
    assert.equal(isPricingNext(target), true);
    const cookie = pendingNextSetCookie(target).split(';')[0];
    assert.equal(pendingNextFromCookieHeader(cookie), target);
  });

  it('starts by itself only when this browser recorded the consent', () => {
    const lib = read('web/src/lib/checkout.js');
    assert.match(lib, /const consented = readIntent\(\) === parsed\.item;/);
    assert.match(lib, /if \(signedIn && consented && waiver instanceof HTMLInputElement\)/);
    assert.match(lib, /rememberIntent\(parsed\.item\);\s*window\.location\.href = signupHrefForItem\(parsed\.item\);/);
    assert.match(read('web/src/pages/pricing.astro'), /resumeCheckout\(\)/);
    assert.match(read('web/src/pages/pricing.astro'), /__wcagPricingResumeBound/);
  });
});

describe('consent next to the button', () => {
  const pricing = read('web/src/pages/pricing.astro');
  const account = read('web/src/pages/account.astro');

  it('has a waiver box and a message inside each paid card on pricing', () => {
    for (const id of ['tokens', 'pro']) {
      const start = pricing.indexOf(`id="${id}" data-checkout-scope`);
      const end = pricing.indexOf('</section>', start);
      const card = pricing.slice(start, end);
      assert.ok(start > 0, `${id} card is a checkout scope`);
      assert.match(card, /class="checkout-waiver"/);
      assert.match(card, /class="checkout-msg muted" role="status"/);
      assert.ok(card.indexOf('checkout-waiver') < card.indexOf('pricing-checkout'), 'the box comes before the buttons');
    }
    assert.doesNotMatch(pricing, /id="withdrawal-waiver"\s/);
  });

  it('shares one checkout script between pricing and account', () => {
    assert.match(account, /data-checkout-scope/);
    assert.match(account, /class="checkout-waiver"/);
    assert.match(account, /bindCheckout\(\)/);
    assert.doesNotMatch(account, /async function startCheckout/);
    assert.doesNotMatch(pricing, /async function startCheckout/);
  });
});

describe('plans that cannot be bought', () => {
  it('reports nothing as ready when Stripe is not connected', async () => {
    const config = await billingPublicConfig();
    assert.equal(config.pro.checkoutReadyMonthly, false);
    assert.equal(config.pro.checkoutReadyYearly, false);
    assert.equal(config.packs.every((pack) => pack.checkoutReady === false), true);
  });

  it('shows a message with a contact link instead of dead buttons', () => {
    const pricing = read('web/src/pages/pricing.astro');
    assert.match(pricing, /\{proReady \? \(/);
    assert.match(pricing, /Pro cannot be bought online yet\./);
    assert.match(pricing, /\{anyPackReady \? \(/);
    assert.match(pricing, /Token packs cannot be bought online yet\./);
  });
});

describe('after payment', () => {
  const account = read('web/src/pages/account.astro');

  it('confirms at the top of the account page with a way to start scanning', () => {
    const panel = account.indexOf('id="billing-success"');
    assert.ok(panel > 0 && panel < account.indexOf('id="usage-card"'), 'the panel is above the account sections');
    assert.match(account, /id="billing-success" class="card stack-form account-section" role="status" tabindex="-1" hidden/);
    assert.match(account, /href="\/">Start a scan<\/a>/);
    assert.match(account, /if \(billingFlag === 'success'\) showPaymentReceived\(\);/);
    assert.match(account, /watchPaymentLanding\(/);
    assert.match(account, /announceBalanceChanged\(\)/);
  });
});
