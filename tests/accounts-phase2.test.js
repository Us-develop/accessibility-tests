import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const tmp = mkdtempSync(join(tmpdir(), 'wcag-accounts-'));
process.env.REPORTS_BASE = tmp;
process.env.AUTH_ENABLED = 'true';
process.env.APP_USERNAME = 'root';
process.env.APP_PASSWORD = 'staff-secret-pass';
process.env.SESSION_SECRET = 'unit-test-session-secret';
process.env.AUTH_EMAIL_VERIFY = 'auto';
process.env.DEFER_ROOT_LOGIN_TO_SHELL = 'true';

const { hashPassword, isStrongPassword, verifyPassword } = await import('../server/passwords.mjs');
const { decodeSession, encodeSession, isHtmlFormPost } = await import('../server/session.mjs');
const { authenticateUser } = await import('../server/users.mjs');
const { readJsonStore, writeJsonStore } = await import('../server/json-store.mjs');
const { canAccessDomain } = await import('../server/projects.mjs');
const { persistGuestToken } = await import('../server/guest.mjs');
const { createAccessibilityApp } = await import('../server/create-app.mjs');
const { incrementUsage } = await import('../server/billing.mjs');
const { writeJob, deleteJob } = await import('../server/queue.mjs');

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

  it('treats urlencoded browser posts as HTML form logins', () => {
    assert.equal(
      isHtmlFormPost({
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'text/html,application/xhtml+xml',
        },
      }),
      true
    );
    assert.equal(
      isHtmlFormPost({
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
        },
      }),
      false
    );
  });

  it('rejects a tampered session', () => {
    const token = encodeSession({ sub: 'abc', role: 'customer' });
    assert.equal(decodeSession(`${token}x`), null);
  });
});

describe('tenancy', () => {
  it('staff can access any domain', async () => {
    assert.equal(await canAccessDomain({ role: 'staff' }, 'example.com'), true);
  });

  it('guests cannot access project domains', async () => {
    assert.equal(await canAccessDomain({ role: 'guest' }, 'example.com'), false);
  });

  it('customers cannot load domains they do not own', async () => {
    assert.equal(await canAccessDomain({ role: 'customer', userId: 'no-such-user' }, 'example.com'), false);
  });
});

describe('account HTTP', () => {
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

  it('signs up a customer with a signed session', async () => {
    const jar = new CookieJar();
    const res = await fetch(`${origin}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'customer@example.com',
        password: 'longenough1',
        name: 'Pat',
      }),
    });
    jar.store(res.headers);
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.ok, true);
    assert.equal(data.user.role, 'customer');
    assert.ok(jar.get('wcag_sid'));
    assert.ok(jar.get('wcag_csrf'));
    assert.equal(jar.get('wcag_ui'), 'c');

    const status = await fetch(`${origin}/api/auth/status`, { headers: { cookie: jar.header() } });
    const st = await status.json();
    assert.equal(st.authenticated, true);
    assert.equal(st.role, 'customer');
  });

  it('rejects a second signup with the same email', async () => {
    const res = await fetch(`${origin}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'customer@example.com', password: 'longenough1' }),
    });
    assert.equal(res.status, 409);
  });

  it('logs in staff with APP_USERNAME / APP_PASSWORD', async () => {
    const jar = new CookieJar();
    const res = await fetch(`${origin}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'root', password: 'staff-secret-pass' }),
    });
    jar.store(res.headers);
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.role, 'staff');
    assert.equal(jar.get('wcag_ui'), '1');
    assert.equal(jar.get('wcag_access'), '1');

    const status = await fetch(`${origin}/api/auth/status`, { headers: { cookie: jar.header() } });
    const st = await status.json();
    assert.equal(st.role, 'staff');
    assert.equal(st.authenticated, true);
  });

  it('logs in a customer with email and rejects CSRF-less staff runs', async () => {
    const jar = new CookieJar();
    const login = await fetch(`${origin}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'customer@example.com', password: 'longenough1' }),
    });
    jar.store(login.headers);
    const data = await login.json();
    assert.equal(login.status, 200);
    assert.equal(data.role, 'customer');

    const noCsrf = await fetch(`${origin}/api/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: jar.header() },
      body: JSON.stringify({ url: 'https://example.com' }),
    });
    const body = await noCsrf.json();
    assert.equal(noCsrf.status, 403);
    assert.match(body.error || '', /CSRF/i);

    const withCsrf = await fetch(`${origin}/api/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: jar.header(),
        'X-CSRF-Token': jar.get('wcag_csrf'),
      },
      body: JSON.stringify({ url: 'not-a-url' }),
    });
    assert.equal(withCsrf.status, 400);
  });

  it('attaches a guest teaser after signup', async () => {
    persistGuestToken('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', {
      domain: 'example.com',
      runId: '2026-01-01T00-00-00Z-ab12',
      url: 'https://example.com',
      ip: '127.0.0.1',
    });
    const jar = new CookieJar();
    const res = await fetch(`${origin}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'attached@example.com',
        password: 'longenough1',
        guestToken: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      }),
    });
    jar.store(res.headers);
    assert.equal(res.status, 200);
    const account = await fetch(`${origin}/api/account`, { headers: { cookie: jar.header() } });
    const data = await account.json();
    assert.equal(account.status, 200);
    assert.equal(data.projects[0]?.domain, 'example.com');
  });

  it('exposes db health without a session', async () => {
    const res = await fetch(`${origin}/api/health/db`);
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.ok, true);
    assert.equal(data.db, 'disabled');
  });

  it('assigns the free plan and lets the customer edit details', async () => {
    const jar = new CookieJar();
    const login = await fetch(`${origin}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'attached@example.com', password: 'longenough1' }),
    });
    jar.store(login.headers);
    const account = await fetch(`${origin}/api/account`, { headers: { cookie: jar.header() } });
    const data = await account.json();
    assert.equal(account.status, 200);
    assert.equal(data.plan?.id, 'free');
    assert.equal(data.usage?.maxScansPerMonth, 30);

    const saved = await fetch(`${origin}/api/account`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        cookie: jar.header(),
        'X-CSRF-Token': jar.get('wcag_csrf'),
      },
      body: JSON.stringify({ company: 'About Us', city: 'Ghent', country: 'Belgium' }),
    });
    const savedBody = await saved.json();
    assert.equal(saved.status, 200);
    assert.equal(savedBody.user.company, 'About Us');
    assert.equal(savedBody.user.city, 'Ghent');
  });

  it('changes password when the current password is correct', async () => {
    const jar = new CookieJar();
    const login = await fetch(`${origin}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'attached@example.com', password: 'longenough1' }),
    });
    jar.store(login.headers);
    const bad = await fetch(`${origin}/api/account/password`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        cookie: jar.header(),
        'X-CSRF-Token': jar.get('wcag_csrf'),
      },
      body: JSON.stringify({ currentPassword: 'wrong-password', password: 'newevenlonger1' }),
    });
    assert.equal(bad.status, 400);
    const ok = await fetch(`${origin}/api/account/password`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        cookie: jar.header(),
        'X-CSRF-Token': jar.get('wcag_csrf'),
      },
      body: JSON.stringify({ currentPassword: 'longenough1', password: 'newevenlonger1' }),
    });
    assert.equal(ok.status, 200);
    const relogin = await fetch(`${origin}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'attached@example.com', password: 'newevenlonger1' }),
    });
    assert.equal(relogin.status, 200);
  });

  it('exports scan history as csv', async () => {
    const jar = new CookieJar();
    const login = await fetch(`${origin}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'attached@example.com', password: 'newevenlonger1' }),
    });
    jar.store(login.headers);
    const res = await fetch(`${origin}/api/account/export?format=csv`, { headers: { cookie: jar.header() } });
    const text = await res.text();
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /csv/i);
    assert.match(text, /project_domain,scan_date,run_id,pages_scanned,score,status/);
  });

  it('enforces the monthly scan limit', async () => {
    const jar = new CookieJar();
    const login = await fetch(`${origin}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'attached@example.com', password: 'newevenlonger1' }),
    });
    jar.store(login.headers);
    const account = await fetch(`${origin}/api/account`, { headers: { cookie: jar.header() } });
    const data = await account.json();
    await incrementUsage(data.user.id, { scans: 30, pages: 30 });
    const run = await fetch(`${origin}/api/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: jar.header(),
        'X-CSRF-Token': jar.get('wcag_csrf'),
      },
      body: JSON.stringify({ url: 'https://example.com' }),
    });
    const body = await run.json();
    assert.equal(run.status, 429);
    assert.match(body.error || '', /month/i);
  });

  it('blocks a second customer scan while one is already queued', async () => {
    const jar = new CookieJar();
    const login = await fetch(`${origin}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'attached@example.com', password: 'newevenlonger1' }),
    });
    jar.store(login.headers);
    const account = await fetch(`${origin}/api/account`, { headers: { cookie: jar.header() } });
    const data = await account.json();
    writeJob({
      id: 'held.example:held-run',
      domain: 'held.example',
      runId: 'held-run',
      status: 'queued',
      userId: data.user.id,
      createdAt: new Date().toISOString(),
    });
    const run = await fetch(`${origin}/api/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: jar.header(),
        'X-CSRF-Token': jar.get('wcag_csrf'),
      },
      body: JSON.stringify({ url: 'https://example.com' }),
    });
    const body = await run.json();
    deleteJob('held.example:held-run');
    assert.equal(run.status, 409);
    assert.match(body.error || '', /already/i);
  });

  it('logs out and clears the session', async () => {
    const jar = new CookieJar();
    const login = await fetch(`${origin}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'customer@example.com', password: 'longenough1' }),
    });
    jar.store(login.headers);
    const out = await fetch(`${origin}/api/auth/logout`, {
      method: 'POST',
      headers: { cookie: jar.header() },
    });
    jar.store(out.headers);
    assert.equal(out.status, 200);
    const status = await fetch(`${origin}/api/auth/status`, { headers: { cookie: jar.header() } });
    const st = await status.json();
    assert.equal(st.authenticated, false);
    assert.equal(st.role, 'guest');
  });

  it('posts the login form so passwords cannot land in the query string', () => {
    const src = readFileSync(join(repoRoot, 'web/src/components/LoginModal.astro'), 'utf8');
    assert.match(src, /id="wcag-login-form"/);
    assert.match(src, /method="post"/);
    assert.match(src, /action="\/api\/auth\/login"/);
    assert.match(src, /data-astro-reload/);
    assert.match(src, /form\.id === 'wcag-login-form'/);
    const layout = readFileSync(join(repoRoot, 'web/src/layouts/Layout.astro'), 'utf8');
    assert.match(layout, /params\.delete\(key\)/);
    assert.match(layout, /history\.replaceState/);
    const signup = readFileSync(join(repoRoot, 'web/src/pages/signup.astro'), 'utf8');
    assert.match(signup, /method="post"/);
    assert.match(signup, /action="\/api\/auth\/signup"/);
    assert.match(signup, /data-astro-reload/);
    const home = readFileSync(join(repoRoot, 'web/src/pages/index.astro'), 'utf8');
    assert.match(home, /id="customer-usage"/);
    const loading = readFileSync(join(repoRoot, 'web/src/components/LoadingMonitor.svelte'), 'utf8');
    assert.match(loading, /Waiting in the scan queue/);
  });

  it('redirects a GET of the login API to the site instead of JSON', async () => {
    const res = await fetch(`${origin}/api/auth/login`, { redirect: 'manual' });
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), '/');
  });

  it('accepts a native HTML login POST and never echoes the password', async () => {
    const res = await fetch(`${origin}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'text/html',
      },
      body: new URLSearchParams({
        username: 'customer@example.com',
        password: 'longenough1',
      }),
      redirect: 'manual',
    });
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), '/account');
    const cookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    assert.ok(cookies.some((line) => line.startsWith('wcag_sid=')));
  });

  it('redirects a failed HTML login without putting credentials in the URL', async () => {
    const res = await fetch(`${origin}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'text/html',
      },
      body: new URLSearchParams({
        username: 'nobody@example.com',
        password: 'wrong-password-1',
      }),
      redirect: 'manual',
    });
    assert.equal(res.status, 303);
    const loc = res.headers.get('location') || '';
    assert.equal(loc, '/?signin=failed');
    assert.doesNotMatch(loc, /password/i);
    assert.doesNotMatch(loc, /username=/i);
  });

  it('keeps JSON login failures as 401 without a redirect', async () => {
    const res = await fetch(`${origin}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'nobody@example.com', password: 'wrong-password-1' }),
    });
    assert.equal(res.status, 401);
    const data = await res.json();
    assert.match(String(data.error || ''), /invalid/i);
  });

  it('authenticates a user that exists only in the JSON store', async () => {
    const passwordHash = await hashPassword('jsononlypass1');
    const data = readJsonStore('users.json', { users: [] });
    const users = Array.isArray(data.users) ? data.users : [];
    users.push({
      id: 'json-only-user',
      email: 'jsononly@example.com',
      role: 'customer',
      passwordHash,
      emailVerified: true,
      name: 'Json',
    });
    writeJsonStore('users.json', { users });
    const user = await authenticateUser('jsononly@example.com', 'jsononlypass1');
    assert.equal(user?.email, 'jsononly@example.com');
    const login = await fetch(`${origin}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'jsononly@example.com', password: 'jsononlypass1' }),
    });
    assert.equal(login.status, 200);
    const body = await login.json();
    assert.equal(body.role, 'customer');
  });

  it('keeps guest 1-page payloads off the staff path', async () => {
    const { runRequestIsStaff } = await import('../server/guest.mjs');
    assert.equal(
      runRequestIsStaff({
        authEnabled: false,
        accessRole: 'staff',
        body: { url: 'https://example.com' },
      }),
      false
    );
  });

  it('closes the test server', async () => {
    await new Promise((resolve) => server.close(resolve));
  });
});
