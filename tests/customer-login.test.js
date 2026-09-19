import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const tmp = mkdtempSync(join(tmpdir(), 'wcag-customer-login-'));
process.env.REPORTS_BASE = tmp;
process.env.AUTH_ENABLED = 'true';
process.env.APP_USERNAME = 'root';
process.env.APP_PASSWORD = 'staff-secret-pass';
process.env.SESSION_SECRET = 'unit-test-session-secret-32chars!!';
process.env.WCAG_DISABLE_RATE_LIMIT = '1';
process.env.AUTH_EMAIL_VERIFY = 'auto';
process.env.DEFER_ROOT_LOGIN_TO_SHELL = 'true';

const { customerLoginNext, safeNextAfterLogin } = await import('../server/login-redirect.mjs');
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

describe('safeNextAfterLogin', () => {
  it('rejects login self-loops', () => {
    assert.equal(safeNextAfterLogin('/login'), '/');
    assert.equal(safeNextAfterLogin('/login?next=/account'), '/');
    assert.equal(safeNextAfterLogin('/auth/login'), '/');
    assert.equal(safeNextAfterLogin('/auth/staff'), '/');
    assert.equal(safeNextAfterLogin('/auth/logout'), '/');
    assert.equal(customerLoginNext('/login'), '/account');
    assert.equal(customerLoginNext(''), '/account');
  });

  it('keeps customer destinations', () => {
    assert.equal(safeNextAfterLogin('/account'), '/account');
    assert.equal(safeNextAfterLogin('/pricing'), '/pricing');
    assert.equal(safeNextAfterLogin('/report/example.com/history'), '/report/example.com/history');
    assert.equal(safeNextAfterLogin('/api/account'), '/');
  });
});

describe('customer login HTTP', () => {
  let server;
  let origin;

  it('starts the app', async () => {
    const app = createAccessibilityApp(repoRoot);
    const started = await listen(app);
    server = started.server;
    origin = started.origin;
  });

  it('sends guests from /account to glass customer login', async () => {
    const res = await fetch(`${origin}/account`, { redirect: 'manual' });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/login?next=%2Faccount');
  });

  it('sends guests from /audits and report URLs to customer login', async () => {
    const audits = await fetch(`${origin}/audits`, { redirect: 'manual' });
    assert.equal(audits.status, 302);
    assert.equal(audits.headers.get('location'), '/login?next=%2Faudits');
    const report = await fetch(`${origin}/report/example.com/history`, { redirect: 'manual' });
    assert.equal(report.status, 302);
    assert.equal(report.headers.get('location'), '/login?next=%2Freport%2Fexample.com%2Fhistory');
  });

  it('serves customer chrome on GET /login and defaults next away from /login', async () => {
    const res = await fetch(`${origin}/login`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /Sign in with the email you used to create your account/);
    assert.match(html, />Email</);
    assert.match(html, /href="\/"/);
    assert.match(html, /Create an account/);
    assert.match(html, /Forgot password/);
    assert.match(html, /name="next" value="\/account"/);
    assert.doesNotMatch(html, /reports and APIs/);
    assert.doesNotMatch(html, /Email or staff username/);

    const loop = await fetch(`${origin}/login?next=%2Flogin`);
    const loopHtml = await loop.text();
    assert.match(loopHtml, /name="next" value="\/account"/);
  });

  it('keeps a staff-only page at /auth/staff', async () => {
    const res = await fetch(`${origin}/auth/staff`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /access reports and APIs/);
    assert.match(html, />Username</);
    assert.match(html, /action="\/auth\/staff"/);
    assert.match(html, /Customer sign-in/);
  });

  it('aliases /auth/login to /auth/staff', async () => {
    const res = await fetch(`${origin}/auth/login?next=%2Faudits`, { redirect: 'manual' });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/auth/staff?next=%2Faudits');
  });

  it('returns 404 for guest /admin/leads instead of a staff login', async () => {
    const res = await fetch(`${origin}/admin/leads`, { redirect: 'manual' });
    assert.equal(res.status, 404);
    const body = await res.text();
    assert.match(body, /Not Found/i);
    assert.doesNotMatch(body, /auth\/staff/);
    assert.doesNotMatch(body, /\/login\?next=/);
  });

  it('drops staff-username copy from the customer modal and SMTP from forgot-password', () => {
    const modal = readFileSync(join(repoRoot, 'web/src/components/LoginModal.astro'), 'utf8');
    assert.match(modal, /Sign in with the email you used to create your account/);
    assert.match(modal, /href="\/auth\/staff"/);
    assert.match(modal, /Open the verification page/);
    assert.doesNotMatch(modal, /Email or staff username/);
    assert.doesNotMatch(modal, /Us staff use the agency username/);
    const forgot = readFileSync(join(repoRoot, 'web/src/pages/forgot.astro'), 'utf8');
    assert.match(forgot, /If that account exists, we sent a reset link\./);
    assert.doesNotMatch(forgot, /SMTP/);
  });

  it('closes the test server', async () => {
    await new Promise((resolve) => server.close(resolve));
  });
});
