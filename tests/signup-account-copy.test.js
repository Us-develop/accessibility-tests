import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const tmp = mkdtempSync(join(tmpdir(), 'wcag-signup-account-copy-'));
process.env.REPORTS_BASE = tmp;
process.env.AUTH_EMAIL_VERIFY = 'auto';

const { createUser, fullName, getUserById, updateContactDetails } = await import('../server/users.mjs');
const { tokensGrantedIn } = await import('../server/tokens.mjs');

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(repoRoot, path), 'utf8');
const signup = read('web/src/pages/signup.astro');
const account = read('web/src/pages/account.astro');

after(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('first and last name', () => {
  it('joins them into the one name used for invoices and mails', () => {
    assert.equal(fullName(' Jan ', 'de Vries'), 'Jan de Vries');
    assert.equal(fullName('', 'Peeters'), 'Peeters');
    assert.equal(fullName('', ''), '');
  });

  it('stores both on sign-up and keeps the full name', async () => {
    const { user } = await createUser({
      email: 'names@example.com',
      password: 'a-long-enough-password',
      firstName: 'Jan',
      lastName: 'de Vries',
    });
    assert.equal(user.firstName, 'Jan');
    assert.equal(user.lastName, 'de Vries');
    assert.equal(user.name, 'Jan de Vries');
  });

  it('updates the full name when the account form changes a part', async () => {
    const { user } = await createUser({ email: 'rename@example.com', password: 'a-long-enough-password', name: 'Old Name' });
    await updateContactDetails(user.id, { firstName: 'An', lastName: 'Peeters' });
    const saved = await getUserById(user.id);
    assert.equal(saved.name, 'An Peeters');
    await updateContactDetails(user.id, { lastName: 'Janssens' });
    assert.equal((await getUserById(user.id)).name, 'An Janssens');
  });

  it('asks for business details only for a business account', async () => {
    await assert.rejects(
      createUser({ email: 'biz@example.com', password: 'a-long-enough-password', customerType: 'business' }),
      (err) => err.field === 'company'
    );
    const { user } = await createUser({
      email: 'biz2@example.com',
      password: 'a-long-enough-password',
      customerType: 'business',
      company: 'Us',
    });
    assert.equal(user.customerType, 'business');
  });
});

describe('tokens remaining out of what was received', () => {
  it('adds what each pack granted, less what a refund took back', () => {
    assert.equal(tokensGrantedIn([{ tokensGranted: 50, tokensRemaining: 24 }]), 50);
    assert.equal(
      tokensGrantedIn([
        { tokensGranted: 10, tokensClawedBack: 4, tokensRemaining: 6 },
        { tokensGranted: 1, tokensRemaining: 1 },
      ]),
      7
    );
    assert.equal(tokensGrantedIn([]), 0);
  });
});

describe('sign-up form from the copy review', () => {
  it('asks for the account type as two radios under a legend, private individual by default', () => {
    // The design shows only the two choices; the legend still names the group for screen readers.
    assert.match(signup, /<legend class="sr-only">\{tr\('signup\.type\.legend'\)\}<\/legend>/);
    assert.match(signup, /name="customerType" value="business"/);
    assert.match(signup, /name="customerType" value="consumer" id="signup-type-consumer" checked/);
    assert.match(signup, /customerType: fd\.get\('customerType'\) === 'business' \? 'business' : 'consumer'/);
  });

  it('asks for first and last name and keeps the hints linked to their fields', () => {
    assert.match(signup, /id="firstName" name="firstName" autocomplete="given-name"/);
    assert.match(signup, /id="lastName" name="lastName" autocomplete="family-name"/);
    assert.match(signup, /aria-describedby="password-hint" data-hint="password-hint"/);
    assert.match(signup, /aria-describedby="vatNumber-hint" data-hint="vatNumber-hint"/);
    // An error adds to the hint instead of replacing it.
    assert.match(signup, /\[hint\.id, input\.dataset\.hint\]\.filter\(Boolean\)\.join\(' '\)/);
  });

  it('has the copy-review wording in both languages', async () => {
    const en = (await import('../i18n/en.mjs')).default;
    const nl = (await import('../i18n/nl.mjs')).default;
    assert.equal(en['signup.h1'], 'Create your account');
    assert.equal(en['signup.type.consumer'], 'Private individual');
    assert.equal(nl['signup.type.consumer'], 'Particulier');
    assert.equal(en['signup.password.hint'], 'At least 10 characters');
    assert.equal(en['signup.haveAccount'], 'Already have an account?');
  });
});

describe('account page from the copy review', () => {
  it('puts the Pro buttons in the subscription block, with their own withdrawal box', () => {
    const sub = account.slice(account.indexOf('id="usage-card"'), account.indexOf('id="tokens-card"'));
    assert.match(sub, /data-checkout-scope/);
    assert.match(sub, /id="subscribe-actions"/);
    assert.match(sub, /class="checkout-waiver" id="withdrawal-waiver-pro"/);
    assert.match(sub, /data-kind="pro" data-interval="monthly"/);
    assert.match(sub, /tr\('acct\.sub\.cancelNote'\)/);
    const tokens = account.slice(account.indexOf('id="tokens-card"'), account.indexOf('id="payments-card"'));
    assert.doesNotMatch(tokens, /data-kind="pro"/);
    assert.match(tokens, /class="checkout-waiver" id="withdrawal-waiver"/);
  });

  it('shows "x of y tokens remaining" and the next expiry', () => {
    assert.match(account, /tn\(lang\(\), 'acct\.tokens\.remaining', granted, \{ left: balance\.tokens, total: granted \}\)/);
    assert.match(account, /acct\.tokens\.expires/);
  });

  it('edits account type, first and last name', () => {
    assert.match(account, /id="account-type-business"/);
    assert.match(account, /id="account-type-consumer" checked/);
    assert.match(account, /id="account-first-name" name="firstName"/);
    assert.match(account, /id="account-last-name" name="lastName"/);
    assert.doesNotMatch(account, /buying-for-business/);
  });
});
