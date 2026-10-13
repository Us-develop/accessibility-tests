import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const tmp = mkdtempSync(join(tmpdir(), 'wcag-signup-privacy-'));
process.env.REPORTS_BASE = tmp;
process.env.AUTH_ENABLED = 'true';
process.env.APP_USERNAME = 'root';
process.env.APP_PASSWORD = 'staff-secret-pass';
process.env.SESSION_SECRET = 'unit-test-session-secret-32chars!!';
process.env.AUTH_EMAIL_VERIFY = 'required';
process.env.DEFER_ROOT_LOGIN_TO_SHELL = 'true';
// Rate limits are the subject here, and a broken mail server is simulated.
delete process.env.WCAG_DISABLE_RATE_LIMIT;
process.env.SMTP_HOST = '127.0.0.1';
process.env.SMTP_PORT = '1';
process.env.MAIL_FROM = 'noreply@example.com';

const { createAccessibilityApp } = await import('../server/create-app.mjs');
const { getUserByEmail } = await import('../server/users.mjs');

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
after(() => rmSync(tmp, { recursive: true, force: true }));

describe('signup and login do not give accounts away', () => {
  let server;
  let origin = '';

  /** The app trusts one proxy hop, so this sets the client address it sees. */
  const post = (path, body, ip) =>
    fetch(`${origin}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
      body: JSON.stringify(body),
    });

  it('starts the app', async () => {
    const app = createAccessibilityApp(repoRoot);
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${server.address().port}`;
  });

  it('creates the account even when the confirmation mail cannot be sent', async () => {
    const res = await post('/api/auth/signup', { email: 'new@example.com', password: 'longenough1', acceptTerms: true }, '198.51.100.1');
    const data = await res.json();
    assert.equal(res.status, 200, JSON.stringify(data));
    assert.equal(data.needsVerification, true);
    assert.equal(JSON.stringify(data).includes('ECONNREFUSED'), false);
    assert.ok(await getUserByEmail('new@example.com'));
  });

  it('answers a signup for an existing address exactly like a new one', async () => {
    const fresh = await post('/api/auth/signup', { email: 'another@example.com', password: 'longenough1', acceptTerms: true }, '198.51.100.2');
    const again = await post('/api/auth/signup', { email: 'new@example.com', password: 'longenough1', acceptTerms: true }, '198.51.100.3');
    assert.equal(again.status, fresh.status);
    assert.deepEqual(await again.json(), await fresh.json());
  });

  it('answers forgot-password the same for a known and an unknown address', async () => {
    const known = await post('/api/auth/forgot', { email: 'new@example.com' }, '198.51.100.4');
    const unknown = await post('/api/auth/forgot', { email: 'nobody@example.com' }, '198.51.100.5');
    assert.equal(known.status, 200);
    assert.equal(unknown.status, 200);
    assert.deepEqual(await known.json(), await unknown.json());
  });

  it('does not lock the staff login for everyone when two machines fail on purpose', async () => {
    for (const ip of ['203.0.113.10', '203.0.113.11']) {
      for (let i = 0; i < 10; i += 1) {
        const res = await post('/api/auth/login', { username: 'root', password: 'wrong-password-xx' }, ip);
        assert.equal(res.status, 401);
      }
      // That machine is now limited...
      assert.equal((await post('/api/auth/login', { username: 'root', password: 'wrong-password-xx' }, ip)).status, 429);
    }
    // ...but the real owner, elsewhere, still gets in.
    const owner = await post('/api/auth/login', { username: 'root', password: 'staff-secret-pass' }, '203.0.113.99');
    assert.equal(owner.status, 200);
  });

  it('closes the test server', async () => {
    await new Promise((resolve) => server.close(resolve));
  });
});
