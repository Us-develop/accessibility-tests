import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const tmp = mkdtempSync(join(tmpdir(), 'wcag-user-lang-'));
process.env.REPORTS_BASE = tmp;
process.env.AUTH_ENABLED = 'true';
process.env.APP_USERNAME = 'root';
process.env.APP_PASSWORD = 'staff-secret-pass';
process.env.SESSION_SECRET = 'unit-test-session-secret-32chars!!';
process.env.WCAG_DISABLE_RATE_LIMIT = '1';
// Signed in straight after signup, so the language switch can be tested as a customer.
process.env.AUTH_EMAIL_VERIFY = 'auto';
process.env.DEFER_ROOT_LOGIN_TO_SHELL = 'true';
delete process.env.WCAG_DEFAULT_LANG;

const { createAccessibilityApp } = await import('../server/create-app.mjs');
const { getUserByEmail, setUserLang } = await import('../server/users.mjs');

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

after(() => {
  rmSync(tmp, { recursive: true, force: true });
});

/** Cookie header from a response's Set-Cookie lines (name=value pairs only). */
function cookiesFrom(res) {
  return res.headers
    .getSetCookie()
    .map((line) => line.split(';')[0])
    .filter((pair) => !pair.endsWith('='))
    .join('; ');
}

describe('language stored on the account', () => {
  let server;
  let origin;

  const signup = (email, cookie) =>
    fetch(`${origin}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: JSON.stringify({
        email,
        password: 'longenough-pass-1',
        firstName: 'Pat',
        lastName: 'Peeters',
        acceptTerms: true,
      }),
    });

  const switchLang = (lang, cookie) =>
    fetch(`${origin}/lang`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: new URLSearchParams({ lang, next: '/account' }).toString(),
      redirect: 'manual',
    });

  it('starts the app', async () => {
    const app = createAccessibilityApp(repoRoot);
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${server.address().port}`;
  });

  it('keeps the language the visitor signed up in', async () => {
    const res = await signup('lang-en@example.com', 'wcag_lang=en');
    assert.equal(res.status, 200);
    assert.equal((await getUserByEmail('lang-en@example.com')).lang, 'en');
  });

  it('uses the default language when the visitor has no language cookie', async () => {
    const res = await signup('lang-default@example.com');
    assert.equal(res.status, 200);
    assert.equal((await getUserByEmail('lang-default@example.com')).lang, 'nl');
  });

  it('updates the stored language when a signed-in customer switches', async () => {
    const res = await signup('lang-switch@example.com', 'wcag_lang=nl');
    assert.equal(res.status, 200);
    const session = cookiesFrom(res);
    assert.match(session, /\S/, 'signup signs the customer in');
    assert.equal((await getUserByEmail('lang-switch@example.com')).lang, 'nl');

    const switched = await switchLang('en', `${session}; wcag_lang=nl`);
    assert.equal(switched.status, 303);
    assert.equal(switched.headers.get('location'), '/account');
    assert.equal((await getUserByEmail('lang-switch@example.com')).lang, 'en');

    // An unknown language changes nothing.
    await switchLang('fr', `${session}; wcag_lang=en`);
    assert.equal((await getUserByEmail('lang-switch@example.com')).lang, 'en');
  });

  it('leaves accounts alone when a guest switches', async () => {
    const res = await switchLang('en');
    assert.equal(res.status, 303);
    assert.equal((await getUserByEmail('lang-default@example.com')).lang, 'nl');
  });

  it('only accepts the two languages and reports whether anything changed', async () => {
    const user = await getUserByEmail('lang-default@example.com');
    assert.equal(await setUserLang(user.id, 'nl'), false);
    assert.equal(await setUserLang(user.id, 'de'), false);
    assert.equal(await setUserLang(user.id, 'EN'), true);
    assert.equal((await getUserByEmail('lang-default@example.com')).lang, 'en');
    assert.equal(await setUserLang('no-such-user', 'nl'), false);
  });

  it('closes the test server', async () => {
    await new Promise((resolve) => server.close(resolve));
  });
});
