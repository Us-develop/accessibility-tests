import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const tmp = mkdtempSync(join(tmpdir(), 'wcag-signup-next-'));
process.env.REPORTS_BASE = tmp;
process.env.AUTH_ENABLED = 'true';
process.env.APP_USERNAME = 'root';
process.env.APP_PASSWORD = 'staff-secret-pass';
process.env.SESSION_SECRET = 'unit-test-session-secret-32chars!!';
process.env.WCAG_DISABLE_RATE_LIMIT = '1';
process.env.AUTH_EMAIL_VERIFY = 'required';
process.env.DEFER_ROOT_LOGIN_TO_SHELL = 'true';

const { createAccessibilityApp } = await import('../server/create-app.mjs');
const { getUserByEmail } = await import('../server/users.mjs');
const { PENDING_NEXT_COOKIE } = await import('../server/login-redirect.mjs');

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

describe('signup next through verify', () => {
  let server;
  let origin;

  it('starts the app', async () => {
    const app = createAccessibilityApp(repoRoot);
    const started = await listen(app);
    server = started.server;
    origin = started.origin;
  });

  it('keeps next=/pricing across signup, the pending cookie, and verify', async () => {
    const jar = new CookieJar();
    const signup = await fetch(`${origin}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'pricing-next@example.com',
        password: 'longenough1',
        acceptTerms: true,
        next: '/pricing',
      }),
    });
    jar.store(signup.headers);
    const body = await signup.json();
    assert.equal(signup.status, 200, body.error || '');
    assert.equal(body.needsVerification, true);
    assert.equal(body.next, '/pricing');
    assert.equal(decodeURIComponent(jar.get(PENDING_NEXT_COOKIE)), '/pricing');

    const htmlSignup = await fetch(`${origin}/api/auth/signup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'text/html',
      },
      body: new URLSearchParams({
        email: 'pricing-html@example.com',
        password: 'longenough1',
        acceptTerms: 'true',
        next: '/pricing',
      }),
      redirect: 'manual',
    });
    assert.equal(htmlSignup.status, 303);
    assert.equal(htmlSignup.headers.get('location'), '/signup?check-email=1&next=%2Fpricing');

    const created = await getUserByEmail('pricing-next@example.com');
    const verify = await fetch(`${origin}/api/auth/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: jar.header(),
      },
      body: JSON.stringify({ token: created.verifyToken }),
    });
    const verified = await verify.json();
    assert.equal(verify.status, 200, verified.error || '');
    assert.equal(verified.next, '/pricing');
  });

  it('rejects a login-loop next stored on signup', async () => {
    const signup = await fetch(`${origin}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'loop-next@example.com',
        password: 'longenough1',
        acceptTerms: true,
        next: '/login',
      }),
    });
    const body = await signup.json();
    assert.equal(signup.status, 200, body.error || '');
    assert.equal(body.next, '/account');
  });

  it('uses pricing copy for next=/pricing and snapshot copy for guest tokens', () => {
    const signup = readFileSync(join(repoRoot, 'web/src/pages/signup.astro'), 'utf8');
    assert.match(signup, /name="next"/);
    assert.match(signup, /id="signup-success"/);
    assert.match(signup, /buy token packs or subscribe to Pro/);
    assert.match(signup, /Save guest snapshots to your email/);
    assert.match(signup, /check-email/);
    assert.doesNotMatch(signup, /msg\.textContent = 'Check your email to verify the account, then sign in\.'/);
    const cookies = readFileSync(join(repoRoot, 'web/src/pages/cookies.astro'), 'utf8');
    assert.match(cookies, /wcag_next/);
  });

  it('closes the test server', async () => {
    await new Promise((resolve) => server.close(resolve));
  });
});
