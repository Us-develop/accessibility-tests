import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const tmp = mkdtempSync(join(tmpdir(), 'wcag-hardening-'));
process.env.REPORTS_BASE = tmp;
process.env.AUTH_ENABLED = 'true';
process.env.APP_USERNAME = 'root';
process.env.APP_PASSWORD = 'staff-secret-pass';
process.env.SESSION_SECRET = 'unit-test-session-secret-32chars!!';
process.env.AUTH_EMAIL_VERIFY = 'required';
process.env.DEFER_ROOT_LOGIN_TO_SHELL = 'true';
delete process.env.WCAG_DISABLE_RATE_LIMIT;

const {
  authTokenMatches,
  consumePasswordReset,
  createUser,
  hashAuthToken,
  PASSWORD_RULE_ERROR,
  startPasswordReset,
  takeIssuedAuthToken,
  updateUser,
} = await import('../server/users.mjs');
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

describe('token hashing leftovers', () => {
  it('rejects leftover plaintext verify and reset tokens', async () => {
    const leftover = 'deadbeefdeadbeefdeadbeefdeadbeef';
    assert.equal(authTokenMatches(leftover, leftover), false);
    assert.equal(authTokenMatches(hashAuthToken(leftover), leftover), true);

    const { user } = await createUser({
      email: 'leftover-token@example.com',
      password: 'longenough1',
    });
    const rawIssued = takeIssuedAuthToken('leftover-token@example.com');
    assert.ok(rawIssued);
    await updateUser(user.id, {
      emailVerified: false,
      verifyToken: leftover,
      verifyExpiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
      resetToken: leftover,
      resetExpiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    });

    const app = createAccessibilityApp(repoRoot);
    const { server, origin } = await listen(app);
    try {
      const verify = await fetch(`${origin}/api/auth/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: leftover }),
      });
      assert.equal(verify.status, 400);
      assert.equal(await consumePasswordReset(leftover), null);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('stores hashed reset tokens and accepts only the raw issued value', async () => {
    const { user } = await createUser({
      email: 'reset-hash@example.com',
      password: 'longenough1',
    });
    const started = await startPasswordReset(user.email);
    assert.equal(String(started.token).length, 32);
    assert.notEqual(started.token, hashAuthToken(started.token));
    const found = await consumePasswordReset(started.token);
    assert.ok(found);
    assert.equal(found.id, user.id);
    assert.equal(await consumePasswordReset('not-a-real-token-xx'), null);
  });
});

describe('password is not the email', () => {
  it('rejects signup when the password equals the email', async () => {
    const app = createAccessibilityApp(repoRoot);
    const { server, origin } = await listen(app);
    try {
      const res = await fetch(`${origin}/api/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'user@example.com',
          password: 'user@example.com',
          acceptTerms: true,
        }),
      });
      const body = await res.json();
      assert.equal(res.status, 400);
      assert.equal(body.field, 'password');
      assert.equal(body.error, PASSWORD_RULE_ERROR);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

describe('lead rate limit and production warn', () => {
  it('caps lead posts at 5 per hour per IP', async () => {
    const app = createAccessibilityApp(repoRoot);
    const { server, origin } = await listen(app);
    try {
      const statuses = [];
      for (let i = 0; i < 6; i += 1) {
        const res = await fetch(`${origin}/api/lead`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'Lead Tester',
            email: `lead-${i}@example.com`,
            message: 'Need a WCAG quote',
          }),
        });
        statuses.push(res.status);
        await res.json().catch(() => ({}));
      }
      assert.deepEqual(statuses.slice(0, 5), [200, 200, 200, 200, 200]);
      assert.equal(statuses[5], 429);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('warns when production disables in-process rate limits', () => {
    const prev = {
      NODE_ENV: process.env.NODE_ENV,
      WCAG_DISABLE_RATE_LIMIT: process.env.WCAG_DISABLE_RATE_LIMIT,
      MAIL_FROM: process.env.MAIL_FROM,
      PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL,
      COMPANY_LEGAL_NAME: process.env.COMPANY_LEGAL_NAME,
      COMPANY_KBO: process.env.COMPANY_KBO,
      COMPANY_VAT: process.env.COMPANY_VAT,
      COMPANY_ADDRESS: process.env.COMPANY_ADDRESS,
      COMPANY_EMAIL: process.env.COMPANY_EMAIL,
    };
    process.env.NODE_ENV = 'production';
    process.env.WCAG_DISABLE_RATE_LIMIT = '1';
    process.env.MAIL_FROM = 'hello@example.com';
    process.env.PUBLIC_BASE_URL = 'https://wcag.example';
    process.env.COMPANY_LEGAL_NAME = 'Example BV';
    process.env.COMPANY_KBO = '0123.456.789';
    process.env.COMPANY_VAT = 'BE0123456789';
    process.env.COMPANY_ADDRESS = 'Example street 1, 1000 Brussels';
    process.env.COMPANY_EMAIL = 'privacy@example.com';
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => {
      warnings.push(args.map(String).join(' '));
    };
    try {
      createAccessibilityApp(repoRoot);
      assert.ok(
        warnings.some((line) => line.includes('WCAG_DISABLE_RATE_LIMIT is set in production')),
        warnings.join('\n')
      );
    } finally {
      console.warn = originalWarn;
      for (const [key, value] of Object.entries(prev)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it('documents systemd Protect* and in-process rate-limit limits', () => {
    const unit = readFileSync(join(repoRoot, 'deploy/accessibility.service'), 'utf8');
    assert.match(unit, /ProtectSystem=strict/);
    assert.match(unit, /ProtectHome=true/);
    assert.match(unit, /ReadWritePaths=\/srv\/accessibility-tests/);
    const limiter = readFileSync(join(repoRoot, 'server/rate-limit.mjs'), 'utf8');
    assert.match(limiter, /reset on restart/);
    const createApp = readFileSync(join(repoRoot, 'server/create-app.mjs'), 'utf8');
    assert.match(createApp, /leadIpLimit = rateLimit\(\{ windowMs: 60 \* 60 \* 1000, max: 5/);
  });
});
