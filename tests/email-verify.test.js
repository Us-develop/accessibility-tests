import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const tmp = mkdtempSync(join(tmpdir(), 'wcag-verify-'));
process.env.REPORTS_BASE = tmp;
process.env.AUTH_ENABLED = 'true';
process.env.APP_USERNAME = 'root';
process.env.APP_PASSWORD = 'staff-secret-pass';
process.env.SESSION_SECRET = 'unit-test-session-secret-32chars!!';
process.env.WCAG_DISABLE_RATE_LIMIT = '1';
process.env.AUTH_EMAIL_VERIFY = 'required';
process.env.DEFER_ROOT_LOGIN_TO_SHELL = 'true';

const { createAccessibilityApp } = await import('../server/create-app.mjs');
const {
  getUserByEmail,
  hashAuthToken,
  takeIssuedAuthToken,
  GENERIC_CREDENTIALS_ERROR,
  UNVERIFIED_EMAIL_CODE,
  UNVERIFIED_EMAIL_ERROR,
} = await import('../server/users.mjs');
const { setUrlGuardLookup } = await import('../server/url-guard.mjs');

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

after(() => {
  setUrlGuardLookup(null);
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

describe('email verification', () => {
  let server;
  let origin;
  let needsVerifyToken;

  it('starts the app', async () => {
    const app = createAccessibilityApp(repoRoot, {
      lookup: async () => [{ address: '1.1.1.1', family: 4 }],
    });
    const started = await listen(app);
    server = started.server;
    origin = started.origin;
  });

  it('does not consume the token on GET so mail previews cannot burn the link', async () => {
    const signup = await fetch(`${origin}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'needs-verify@example.com',
        password: 'longenough1',
        acceptTerms: true,
      }),
    });
    const body = await signup.json();
    assert.equal(signup.status, 200, body.error || '');
    assert.equal(body.needsVerification, true);
    const created = await getUserByEmail('needs-verify@example.com');
    assert.equal(created.emailVerified, false);
    const token = takeIssuedAuthToken('needs-verify@example.com');
    needsVerifyToken = token;
    assert.equal(String(token).length, 32);
    assert.match(created.verifyToken, /^sha256\$[a-f0-9]{64}$/);
    assert.equal(created.verifyToken, hashAuthToken(token));
    assert.notEqual(created.verifyToken, token);

    const first = await fetch(`${origin}/api/auth/verify?token=${encodeURIComponent(token)}`, {
      redirect: 'manual',
    });
    assert.equal(first.status, 303);
    assert.equal(first.headers.get('location'), `/verify?token=${encodeURIComponent(token)}`);
    const afterGet = await getUserByEmail('needs-verify@example.com');
    assert.equal(afterGet.emailVerified, false);
    assert.equal(afterGet.verifyToken, hashAuthToken(token));

    const second = await fetch(`${origin}/api/auth/verify?token=${encodeURIComponent(token)}`, {
      redirect: 'manual',
    });
    assert.equal(second.status, 303);
    assert.equal((await getUserByEmail('needs-verify@example.com')).verifyToken, hashAuthToken(token));
  });

  it('confirms the account on POST and signs the user in', async () => {
    const token = needsVerifyToken;
    const jar = new CookieJar();
    const res = await fetch(`${origin}/api/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    jar.store(res.headers);
    const data = await res.json();
    assert.equal(res.status, 200, data.error || '');
    assert.equal(data.ok, true);
    assert.ok(jar.get('wcag_sid'));
    const verified = await getUserByEmail('needs-verify@example.com');
    assert.equal(verified.emailVerified, true);
    assert.equal(verified.verifyToken, null);
  });

  it('sends a new token when the previous link is already used', async () => {
    const signup = await fetch(`${origin}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'resend-verify@example.com',
        password: 'longenough1',
        acceptTerms: true,
      }),
    });
    assert.equal(signup.status, 200);
    const first = await getUserByEmail('resend-verify@example.com');
    const oldToken = takeIssuedAuthToken('resend-verify@example.com');
    assert.match(first.verifyToken, /^sha256\$/);
    assert.notEqual(first.verifyToken, oldToken);
    const resend = await fetch(`${origin}/api/auth/verify/resend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'resend-verify@example.com' }),
    });
    assert.equal(resend.status, 200);
    const next = await getUserByEmail('resend-verify@example.com');
    const nextToken = takeIssuedAuthToken('resend-verify@example.com');
    assert.ok(next.verifyToken);
    assert.ok(nextToken);
    assert.notEqual(next.verifyToken, first.verifyToken);
    assert.notEqual(nextToken, oldToken);
    const used = await fetch(`${origin}/api/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: oldToken }),
    });
    assert.equal(used.status, 400);
    const confirm = await fetch(`${origin}/api/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: nextToken }),
    });
    assert.equal(confirm.status, 200);
    assert.equal((await getUserByEmail('resend-verify@example.com')).emailVerified, true);
  });

  it('does not create a session when login happens before verification', async () => {
    const signup = await fetch(`${origin}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'unverified-login@example.com',
        password: 'longenough1',
        acceptTerms: true,
      }),
    });
    assert.equal(signup.status, 200);
    const login = await fetch(`${origin}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'unverified-login@example.com', password: 'longenough1' }),
    });
    assert.equal(login.status, 403);
    const loginBody = await login.json();
    assert.equal(loginBody.code, UNVERIFIED_EMAIL_CODE);
    assert.equal(loginBody.error, UNVERIFIED_EMAIL_ERROR);
    assert.notEqual(loginBody.error, GENERIC_CREDENTIALS_ERROR);
  });

  it('closes the test server', async () => {
    await new Promise((resolve) => server.close(resolve));
  });
});
