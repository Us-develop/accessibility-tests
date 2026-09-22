import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const tmp = mkdtempSync(join(tmpdir(), 'wcag-headers-ssrf-'));
process.env.REPORTS_BASE = tmp;
process.env.AUTH_ENABLED = 'true';
process.env.APP_USERNAME = 'root';
process.env.APP_PASSWORD = 'staff-secret-pass';
process.env.SESSION_SECRET = 'unit-test-session-secret-32chars!!';
process.env.WCAG_DISABLE_RATE_LIMIT = '1';
process.env.AUTH_EMAIL_VERIFY = 'auto';
process.env.DEFER_ROOT_LOGIN_TO_SHELL = 'true';

const { createAccessibilityApp } = await import('../server/create-app.mjs');
const { APP_CONTENT_SECURITY_POLICY } = await import('../server/http-utils.mjs');
const { isBlockedHostname } = await import('../server/url-guard.mjs');

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

describe('headers and scan host leftovers', () => {
  it('blocks cluster DNS names', () => {
    assert.equal(isBlockedHostname('foo.svc.cluster.local'), true);
    assert.equal(isBlockedHostname('bar.cluster.local'), true);
    assert.equal(isBlockedHostname('example.com'), false);
  });

  it('keeps HSTS in the Caddyfile and CSP on app HTML', () => {
    const caddy = readFileSync(join(repoRoot, 'deploy/Caddyfile'), 'utf8');
    assert.match(caddy, /Strict-Transport-Security "max-age=31536000; includeSubDomains"/);
    assert.match(APP_CONTENT_SECURITY_POLICY, /challenges\.cloudflare\.com/);
    assert.match(APP_CONTENT_SECURITY_POLICY, /frame-ancestors 'none'/);
    const createApp = readFileSync(join(repoRoot, 'server/create-app.mjs'), 'utf8');
    assert.doesNotMatch(createApp, /X-Frame-Options', 'SAMEORIGIN'/);
    const runTests = readFileSync(join(repoRoot, 'run-tests.js'), 'utf8');
    assert.match(runTests, /assertPublicHttpUrl/);
  });
});

describe('security headers HTTP', () => {
  it('sends CSP and DENY framing on app responses', async () => {
    const app = createAccessibilityApp(repoRoot);
    const { server, origin } = await listen(app);
    try {
      const res = await fetch(`${origin}/api/config`);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('x-frame-options'), 'DENY');
      assert.match(res.headers.get('content-security-policy') || '', /frame-ancestors 'none'/);
      assert.equal(res.headers.get('strict-transport-security'), null);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
