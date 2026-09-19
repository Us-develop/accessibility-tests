import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const tmp = mkdtempSync(join(tmpdir(), 'wcag-auth-cookies-'));
process.env.REPORTS_BASE = tmp;
process.env.AUTH_ENABLED = 'true';
process.env.APP_USERNAME = 'root';
process.env.APP_PASSWORD = 'staff-secret-pass';
process.env.SESSION_SECRET = 'unit-test-session-secret-32chars!!';
process.env.WCAG_DISABLE_RATE_LIMIT = '1';
process.env.AUTH_EMAIL_VERIFY = 'auto';
process.env.DEFER_ROOT_LOGIN_TO_SHELL = 'true';
delete process.env.TURNSTILE_SECRET_KEY;

const { isValidReportId } = await import('../server/fs-utils.js');
const { isValidRunId, runDir } = await import('../server/run-ids.js');
const { verifyTurnstileIfConfigured, markGuestFreeScan } = await import('../server/guest.mjs');
const { SIGNUP_EMAIL_TAKEN_ERROR } = await import('../server/users.mjs');
const { createAccessibilityApp } = await import('../server/create-app.mjs');

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

after(() => {
  rmSync(tmp, { recursive: true, force: true });
});

class CookieJar {
  constructor() {
    this.map = new Map();
    this.raw = [];
  }

  store(headers) {
    const lines = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [];
    this.raw.push(...lines);
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

  line(name) {
    return this.raw.find((row) => row.startsWith(`${name}=`)) || '';
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

describe('path ids', () => {
  it('rejects dot and parent-directory ids', () => {
    assert.equal(isValidReportId('.'), false);
    assert.equal(isValidReportId('..'), false);
    assert.equal(isValidReportId('foo..bar'), false);
    assert.equal(isValidReportId('example.com'), true);
    assert.equal(isValidRunId('.'), false);
    assert.equal(isValidRunId('..'), false);
    assert.equal(isValidRunId('2026-01-01T00-00-00Z-abcdef123456'), true);
    assert.throws(() => runDir('..', '2026-01-01T00-00-00Z-abcdef123456'), /Invalid report path/);
    assert.throws(() => runDir('example.com', '..'), /Invalid report path/);
  });
});

describe('turnstile production fail-closed', () => {
  it('rejects guest captcha when the secret is missing in production', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    delete process.env.TURNSTILE_SECRET_KEY;
    try {
      await assert.rejects(() => verifyTurnstileIfConfigured('', '203.0.113.10'), /temporarily unavailable/);
    } finally {
      if (prev === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prev;
    }
  });
});

describe('guest cookie flags', () => {
  it('sets HttpOnly and Secure on the freebie cookie in production', () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const lines = [];
    try {
      markGuestFreeScan(
        { headers: {}, ip: '203.0.113.55' },
        { append(_name, value) { lines.push(value); } }
      );
    } finally {
      if (prev === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prev;
    }
    const line = lines.find((row) => String(row).startsWith('wcag_freebie='));
    assert.ok(line);
    assert.match(line, /HttpOnly/i);
    assert.match(line, /Secure/i);
  });
});

describe('auth cookies xss HTTP', () => {
  let server;
  let origin;

  it('starts the app', async () => {
    const app = createAccessibilityApp(repoRoot);
    const started = await listen(app);
    server = started.server;
    origin = started.origin;
  });

  it('issues a CSRF cookie on GET and requires it for guest /api/run', async () => {
    const jar = new CookieJar();
    const probe = await fetch(`${origin}/api/config`);
    jar.store(probe.headers);
    assert.ok(jar.get('wcag_csrf'));

    const missing = await fetch(`${origin}/api/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com' }),
    });
    const missingBody = await missing.json();
    assert.equal(missing.status, 403);
    assert.match(missingBody.error || '', /CSRF/i);

    const ok = await fetch(`${origin}/api/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: jar.header(),
        'X-CSRF-Token': jar.get('wcag_csrf'),
        'X-Forwarded-For': '203.0.113.88',
      },
      body: JSON.stringify({ url: 'not-a-url' }),
    });
    assert.equal(ok.status, 400);
  });

  it('keeps signup 409 wording generic', async () => {
    const first = await fetch(`${origin}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'enum@example.com', password: 'longenough1', acceptTerms: true }),
    });
    assert.equal(first.status, 200);
    const second = await fetch(`${origin}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'enum@example.com', password: 'longenough1', acceptTerms: true }),
    });
    const data = await second.json();
    assert.equal(second.status, 409);
    assert.equal(data.error, SIGNUP_EMAIL_TAKEN_ERROR);
    assert.doesNotMatch(data.error, /already exists/i);
  });

  it('hides /api/health/db from guests', async () => {
    const res = await fetch(`${origin}/api/health/db`);
    assert.equal(res.status, 401);
  });

  it('escapes account innerHTML fields in source', () => {
    const account = readFileSync(join(repoRoot, 'web/src/pages/account.astro'), 'utf8');
    assert.match(account, /function escapeHtml/);
    assert.match(account, /escapeHtml\(p\.domain\)/);
    assert.match(account, /escapeHtml\(row\.status/);
    assert.match(account, /escapeHtml\(row\.description/);
  });

  it('closes the test server', async () => {
    await new Promise((resolve) => server.close(resolve));
  });
});
