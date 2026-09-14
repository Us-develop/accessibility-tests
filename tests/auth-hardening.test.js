import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const tmp = mkdtempSync(join(tmpdir(), 'wcag-auth-hard-'));
process.env.REPORTS_BASE = tmp;
process.env.AUTH_ENABLED = 'true';
process.env.APP_USERNAME = 'root';
process.env.APP_PASSWORD = 'staff-secret-pass';
process.env.SESSION_SECRET = 'unit-test-session-secret-32chars!!';
process.env.AUTH_EMAIL_VERIFY = 'auto';
process.env.DEFER_ROOT_LOGIN_TO_SHELL = 'true';
delete process.env.WCAG_DISABLE_RATE_LIMIT;

const { encodeSession } = await import('../server/session.mjs');
const { createUser, getUserByEmail, setPassword } = await import('../server/users.mjs');
const { createAccessibilityApp } = await import('../server/create-app.mjs');

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

after(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function listen(app) {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({ server, origin: `http://127.0.0.1:${addr.port}` });
    });
  });
}

describe('auth hardening factory', () => {
  it('throws when APP_PASSWORD is unset with AUTH_ENABLED=true', () => {
    const prev = process.env.APP_PASSWORD;
    delete process.env.APP_PASSWORD;
    try {
      assert.throws(() => createAccessibilityApp(repoRoot), /APP_PASSWORD \(>=12 chars\) is required/);
    } finally {
      process.env.APP_PASSWORD = prev;
    }
  });

  it('throws when SESSION_SECRET is short in production', () => {
    const prevNode = process.env.NODE_ENV;
    const prevSecret = process.env.SESSION_SECRET;
    const prevAuth = process.env.AUTH_ENABLED;
    process.env.NODE_ENV = 'production';
    process.env.AUTH_ENABLED = 'false';
    process.env.SESSION_SECRET = 'too-short';
    try {
      assert.throws(() => createAccessibilityApp(repoRoot), /SESSION_SECRET \(>=32 chars\) is required/);
    } finally {
      if (prevNode === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNode;
      process.env.SESSION_SECRET = prevSecret;
      process.env.AUTH_ENABLED = prevAuth;
    }
  });
});

describe('auth hardening HTTP', () => {
  /** @type {http.Server} */
  let server;
  /** @type {string} */
  let origin;

  it('starts the app', async () => {
    const app = createAccessibilityApp(repoRoot);
    const started = await listen(app);
    server = started.server;
    origin = started.origin;
  });

  it('rejects unsigned wcag_access=1 as staff', async () => {
    const res = await fetch(`${origin}/api/admin/leads`, {
      headers: {
        Cookie: 'wcag_access=1; wcag_csrf=x',
        'X-CSRF-Token': 'x',
      },
    });
    assert.equal(res.status, 401);
  });

  it('rejects X-App-Password header as staff', async () => {
    const res = await fetch(`${origin}/api/admin/leads`, {
      headers: {
        'X-App-Password': 'staff-secret-pass',
        'X-App-Username': 'root',
      },
    });
    assert.equal(res.status, 401);
  });

  it('rejects a session minted with ver:1 after setPassword', async () => {
    await createUser({
      email: 'ver-bump@example.com',
      password: 'longenough1',
      name: 'Ver',
    });
    const user = await getUserByEmail('ver-bump@example.com');
    const token = encodeSession({
      sub: user.id,
      role: 'customer',
      email: user.email,
      ver: 1,
    });
    const before = await fetch(`${origin}/api/account`, {
      headers: { cookie: `wcag_sid=${token}; wcag_csrf=x` },
    });
    assert.equal(before.status, 200);
    await setPassword(user.id, 'newevenlonger1');
    const after = await fetch(`${origin}/api/account`, {
      headers: { cookie: `wcag_sid=${token}; wcag_csrf=x` },
    });
    assert.equal(after.status, 401);
  });

  it('returns 429 on the 11th login attempt in a window', async () => {
    let last;
    for (let i = 0; i < 11; i += 1) {
      last = await fetch(`${origin}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'nobody@example.com', password: 'wrong-password-1' }),
      });
    }
    assert.equal(last.status, 429);
    assert.ok(last.headers.get('retry-after'));
  });

  it('rejects GET /auth/logout', async () => {
    const res = await fetch(`${origin}/auth/logout`, { redirect: 'manual' });
    assert.ok(res.status === 404 || res.status === 405);
  });

  it('returns JSON 500 from an async throw without killing the process', async () => {
    const boom = await fetch(`${origin}/api/__test/throw`);
    assert.equal(boom.status, 500);
    const body = await boom.json();
    assert.equal(body.error, 'Internal error');
    const health = await fetch(`${origin}/api/health/db`);
    assert.equal(health.status, 200);
  });

  it('closes the test server', async () => {
    await new Promise((resolve) => server.close(resolve));
  });
});
