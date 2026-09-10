import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, isStrongPassword, verifyPassword } from '../server/passwords.mjs';
import { decodeSession, encodeSession } from '../server/session.mjs';
import { t, resolveLang, resolvePageLang } from '../server/i18n.mjs';
import { creditSnapshot, PAGE_CREDITS_PER_MONTH, CUSTOMER_MAX_URLS_PER_RUN, assertCanSpend } from '../server/credits.mjs';
import { verifyStripeSignature, pricingPublic } from '../server/billing.mjs';
import { canAccessDomain } from '../server/projects.mjs';

describe('passwords', () => {
  it('rejects short passwords', () => {
    assert.equal(isStrongPassword('short'), false);
    assert.equal(isStrongPassword('longenough1'), true);
  });

  it('hashes and verifies', async () => {
    const stored = await hashPassword('longenough1');
    assert.equal(await verifyPassword('longenough1', stored), true);
    assert.equal(await verifyPassword('wrong-password', stored), false);
  });
});

describe('session', () => {
  it('round-trips a signed session', () => {
    const token = encodeSession({ sub: 'abc', role: 'customer', email: 'a@b.c' });
    const data = decodeSession(token);
    assert.equal(data.sub, 'abc');
    assert.equal(data.role, 'customer');
  });

  it('rejects a tampered session', () => {
    const token = encodeSession({ sub: 'abc', role: 'customer' });
    assert.equal(decodeSession(`${token}x`), null);
  });
});

describe('i18n', () => {
  it('resolves Dutch', () => {
    assert.equal(resolveLang('nl-BE'), 'nl');
    assert.equal(t('nl').pricing.monthly, '€49 / maand');
    assert.equal(t('en').pricing.monthly, '€49 / month');
    assert.equal(t('en').home.guestTitle, 'Run a free accessibility check on your page');
    assert.equal(t('en').home.checkPage, 'Scan this page for free');
  });

  it('lets ?lang= win over the cookie', () => {
    assert.equal(resolvePageLang({ searchLang: 'nl', cookieLang: 'en' }), 'nl');
    assert.equal(resolvePageLang({ searchLang: null, cookieLang: 'nl' }), 'nl');
    assert.equal(resolvePageLang({}), 'en');
  });
});

describe('credits', () => {
  it('staff snapshots are unlimited', () => {
    const snap = creditSnapshot({ role: 'staff' });
    assert.equal(snap.unlimited, true);
    assert.equal(PAGE_CREDITS_PER_MONTH, 300);
  });

  it('caps customer runs at 50 URLs and blocks unsubscribed customers', () => {
    assert.equal(CUSTOMER_MAX_URLS_PER_RUN, 50);
    assert.throws(
      () => assertCanSpend({ id: 'u-unsub', role: 'customer', subscriptionStatus: 'none' }, 1),
      (err) => err.status === 402
    );
  });
});

describe('tenancy', () => {
  it('staff can access any domain', () => {
    assert.equal(canAccessDomain({ role: 'staff' }, 'example.com'), true);
  });

  it('guests cannot access project domains', () => {
    assert.equal(canAccessDomain({ role: 'guest' }, 'example.com'), false);
  });

  it('customers cannot load domains they do not own', () => {
    assert.equal(canAccessDomain({ role: 'customer', userId: 'no-such-user' }, 'example.com'), false);
  });
});

describe('stripe webhook signature', () => {
  it('allows unsigned payloads when no webhook secret is set', () => {
    const prev = process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    assert.equal(verifyStripeSignature('{}', ''), true);
    if (prev) process.env.STRIPE_WEBHOOK_SECRET = prev;
  });
});

describe('public pricing', () => {
  it('locks launch prices', () => {
    const p = pricingPublic();
    assert.equal(p.monthly, 49);
    assert.equal(p.yearly, 490);
    assert.equal(p.foundingMonthly, 39);
    assert.ok(p.foundingRemaining >= 0 && p.foundingRemaining <= 50);
    assert.equal(p.pageCredits, 300);
    assert.equal(p.maxUrlsPerRun, 50);
  });
});
