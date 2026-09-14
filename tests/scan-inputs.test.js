import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const tmp = mkdtempSync(join(tmpdir(), 'wcag-scan-inputs-'));
process.env.REPORTS_BASE = tmp;
process.env.AUTH_ENABLED = 'true';
process.env.APP_USERNAME = 'root';
process.env.APP_PASSWORD = 'staff-secret-pass';
process.env.SESSION_SECRET = 'unit-test-session-secret-32chars!!';
process.env.WCAG_DISABLE_RATE_LIMIT = '1';
process.env.AUTH_EMAIL_VERIFY = 'auto';
process.env.DEFER_ROOT_LOGIN_TO_SHELL = 'true';
process.env.STRIPE_SECRET_KEY = 'sk_test_should_not_reach_child';

const { createAccessibilityApp } = await import('../server/create-app.mjs');
const {
  enqueueScanJob,
  listJobs,
  setQueueExecutor,
  setQueueJobErrorHandler,
  deleteJob,
} = await import('../server/queue.mjs');
const { setUrlGuardLookup, buildScanProcessEnv } = await import('../server/url-guard.mjs');

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

function waitFor(check, timeoutMs = 1500) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      try {
        if (check()) {
          resolve();
          return;
        }
      } catch (err) {
        reject(err);
        return;
      }
      if (Date.now() - started > timeoutMs) {
        reject(new Error('timed out waiting for condition'));
        return;
      }
      setTimeout(tick, 10);
    };
    tick();
  });
}

async function lookupPrivateDns(hostname) {
  if (hostname === 'private-target.example') {
    return [{ address: '10.0.0.1', family: 4 }];
  }
  const err = new Error(`ENOTFOUND ${hostname}`);
  err.code = 'ENOTFOUND';
  throw err;
}

function fakeSpawnFactory(counter) {
  return (...args) => {
    counter.calls.push(args);
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    setImmediate(() => child.emit('close', 1));
    return child;
  };
}

describe('queue executor re-validates persisted URLs', () => {
  it('refuses a job whose URL now resolves privately and does not launch', async () => {
    setUrlGuardLookup(async (hostname) => {
      if (hostname === 'later.example') return [{ address: '10.0.0.1', family: 4 }];
      const err = new Error(`ENOTFOUND ${hostname}`);
      err.code = 'ENOTFOUND';
      throw err;
    });
    let launched = false;
    const errors = [];
    setQueueExecutor(async () => {
      launched = true;
    });
    setQueueJobErrorHandler((job) => {
      errors.push(job);
    });
    enqueueScanJob({
      id: 'later.example:run-blocked',
      domain: 'later.example',
      runId: 'run-blocked',
      urls: ['https://later.example/admin'],
    });
    await waitFor(() => errors.length === 1 && listJobs().length === 0);
    assert.equal(launched, false);
    assert.equal(errors[0].error, 'blocked_target');
    assert.equal(errors[0].status, 'error');
    deleteJob('later.example:run-blocked');
    setUrlGuardLookup(null);
  });
});

describe('scan input SSRF HTTP', () => {
  /** @type {http.Server} */
  let server;
  /** @type {string} */
  let origin;
  const spawnCounter = { calls: [] };
  const jar = new CookieJar();

  it('starts the app with an injected resolver', async () => {
    const app = createAccessibilityApp(repoRoot, {
      lookup: lookupPrivateDns,
      spawn: fakeSpawnFactory(spawnCounter),
    });
    const started = await listen(app);
    server = started.server;
    origin = started.origin;
  });

  it('logs in staff', async () => {
    const res = await fetch(`${origin}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'root', password: 'staff-secret-pass' }),
    });
    jar.store(res.headers);
    assert.equal(res.status, 200);
  });

  async function staffRun(body) {
    const res = await fetch(`${origin}/api/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: jar.header(),
        'X-CSRF-Token': jar.get('wcag_csrf'),
      },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    return { res, json };
  }

  async function staffRunFile(filename, content, field = 'urls') {
    const form = new FormData();
    form.set(field, '');
    form.set('file', new Blob([content], { type: 'application/octet-stream' }), filename);
    const res = await fetch(`${origin}/api/run`, {
      method: 'POST',
      headers: {
        cookie: jar.header(),
        'X-CSRF-Token': jar.get('wcag_csrf'),
      },
      body: form,
    });
    const json = await res.json();
    return { res, json };
  }

  const blockedSamples = [
    ['http://127.0.0.1/', /127\.0\.0\.1/],
    ['http://169.254.169.254/', /169\.254/],
    ['http://[::1]/', /::1/],
    ['http://10.0.0.1/', /10\.0\.0\.1/],
    ['http://metadata.google.internal/', /metadata\.google\.internal/],
    ['http://2130706433/', /2130706433|127\.0\.0\.1/],
    ['http://0177.0.0.1/', /0177|127\.0\.0\.1/],
    ['http://private-target.example/', /private-target\.example/],
    ['file:///etc/passwd', /file:\/\/\/etc\/passwd/],
  ];

  it('rejects blocked URLs from the staff textarea with a per-URL reason and does not spawn', async () => {
    spawnCounter.calls.length = 0;
    for (const [url] of blockedSamples) {
      const { res, json } = await staffRun({ urls: url });
      assert.equal(res.status, 400, `${url} -> ${JSON.stringify(json)}`);
      assert.ok(Array.isArray(json.rejected) && json.rejected.length >= 1, `${url} missing rejected`);
      assert.match(json.rejected[0].reason || json.error || '', /cannot be scanned|Only http and https|valid URL|single public/i);
    }
    const admin = await staffRun({ urls: 'http://127.0.0.1:3456/api/admin/leads' });
    assert.equal(admin.res.status, 400);
    assert.match(admin.json.error || admin.json.rejected?.[0]?.reason || '', /cannot be scanned/i);
    assert.equal(spawnCounter.calls.length, 0);
  });

  it('rejects blocked URLs from a CSV upload', async () => {
    spawnCounter.calls.length = 0;
    const csv = blockedSamples.map(([url]) => url).join('\n');
    const { res, json } = await staffRunFile('urls.csv', csv);
    assert.equal(res.status, 400, JSON.stringify(json));
    assert.ok(json.rejected?.length >= blockedSamples.length, JSON.stringify(json.rejected));
    for (const [url] of blockedSamples) {
      assert.ok(
        json.rejected.some((row) => row.url === url || row.url.includes(url.replace(/\/$/, ''))),
        `missing ${url} in ${JSON.stringify(json.rejected)}`
      );
    }
    assert.equal(spawnCounter.calls.length, 0);
  });

  it('skips a sitemap-index loc pointing at loopback before fetch', async () => {
    spawnCounter.calls.length = 0;
    let hits = 0;
    const probe = await new Promise((resolve) => {
      const s = http.createServer((_req, res) => {
        hits += 1;
        res.end('should-not-be-fetched');
      });
      s.listen(0, '127.0.0.1', () => resolve(s));
    });
    const port = probe.address().port;
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>http://127.0.0.1:${port}/</loc></sitemap>
</sitemapindex>`;
    try {
      const { res, json } = await staffRunFile('sitemap.xml', xml);
      assert.equal(res.status, 400, JSON.stringify(json));
      assert.equal(hits, 0);
      assert.ok(json.rejected?.some((row) => String(row.url).includes(`127.0.0.1:${port}`)), JSON.stringify(json));
    } finally {
      await new Promise((resolve) => probe.close(resolve));
    }
    assert.equal(spawnCounter.calls.length, 0);
  });

  it('rejects blocked URLs from an "other file" upload', async () => {
    spawnCounter.calls.length = 0;
    const { res, json } = await staffRunFile('notes.txt', 'file:///etc/passwd\nhttp://10.0.0.1/admin\n');
    assert.equal(res.status, 400, JSON.stringify(json));
    assert.ok(json.rejected?.length >= 2, JSON.stringify(json.rejected));
    assert.equal(spawnCounter.calls.length, 0);
  });

  it('builds a child env without STRIPE_* or SESSION_SECRET', () => {
    const env = buildScanProcessEnv(process.env);
    assert.equal(env.SESSION_SECRET, undefined);
    assert.ok(!Object.keys(env).some((key) => key.startsWith('STRIPE_')));
    assert.equal(env.REPORTS_BASE, tmp);
  });

  it('closes the test server', async () => {
    await new Promise((resolve) => server.close(resolve));
  });
});
