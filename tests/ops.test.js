import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const tmp = mkdtempSync(join(tmpdir(), 'wcag-ops-'));
process.env.REPORTS_BASE = tmp;
process.env.AUTH_ENABLED = 'true';
process.env.APP_USERNAME = 'root';
process.env.APP_PASSWORD = 'staff-secret-pass';
process.env.SESSION_SECRET = 'unit-test-session-secret-32chars!!';
process.env.WCAG_DISABLE_RATE_LIMIT = '1';
process.env.DEFER_ROOT_LOGIN_TO_SHELL = 'true';

const { listenHost } = await import('../server/config.mjs');
const { createAccessibilityApp } = await import('../server/create-app.mjs');

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
after(() => rmSync(tmp, { recursive: true, force: true }));

describe('listen address', () => {
  it('is loopback in production so the app is only reachable through the proxy', () => {
    assert.equal(listenHost({ NODE_ENV: 'production' }), '127.0.0.1');
  });

  it('is every interface outside production, as before', () => {
    assert.equal(listenHost({}), undefined);
    assert.equal(listenHost({ NODE_ENV: 'development' }), undefined);
  });

  it('can be overridden with HOST', () => {
    assert.equal(listenHost({ NODE_ENV: 'production', HOST: '0.0.0.0' }), '0.0.0.0');
    assert.equal(listenHost({ HOST: '127.0.0.1' }), '127.0.0.1');
  });
});

describe('liveness endpoint', () => {
  it('answers without a login and gives away nothing', async () => {
    const app = createAccessibilityApp(repoRoot);
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    try {
      const res = await fetch(`${origin}/api/health`);
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { ok: true });

      const db = await fetch(`${origin}/api/health/db`, { redirect: 'manual' });
      assert.notEqual(db.status, 200);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

describe('deploy files', () => {
  const unit = readFileSync(join(repoRoot, 'deploy/accessibility.service'), 'utf8');
  const caddy = readFileSync(join(repoRoot, 'deploy/Caddyfile'), 'utf8');

  it('restarts the service whenever it stops and waits for Postgres', () => {
    assert.match(unit, /^Restart=always$/m);
    assert.match(unit, /^RestartSec=\d+$/m);
    assert.match(unit, /^After=.*postgresql\.service/m);
  });

  it('keeps the scanner away from private networks', () => {
    const deny = unit.match(/^IPAddressDeny=(.*)$/m)?.[1] || '';
    for (const range of ['169.254.0.0/16', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16']) {
      assert.ok(deny.includes(range), `${range} should be denied`);
    }
    // Postgres and the proxy reach the app over loopback.
    assert.equal(deny.includes('127.'), false);
  });

  it('limits request bodies at the proxy and talks to the app over loopback', () => {
    assert.match(caddy, /max_size\s+\d+MB/);
    assert.match(caddy, /reverse_proxy\s+127\.0\.0\.1:3000/);
  });
});
