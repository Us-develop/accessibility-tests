import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const tmp = mkdtempSync(join(tmpdir(), 'wcag-scan-process-'));
process.env.REPORTS_BASE = tmp;
process.env.AUTH_ENABLED = 'true';
process.env.APP_USERNAME = 'root';
process.env.APP_PASSWORD = 'staff-secret-pass';
process.env.SESSION_SECRET = 'unit-test-session-secret-32chars!!';
process.env.WCAG_DISABLE_RATE_LIMIT = '1';
process.env.DEFER_ROOT_LOGIN_TO_SHELL = 'true';
process.env.SCAN_PROCESS_TIMEOUT_MS = '1000';

const { createAccessibilityApp } = await import('../server/create-app.mjs');
const { setUrlGuardLookup } = await import('../server/url-guard.mjs');

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

after(() => {
  setUrlGuardLookup(null);
  rmSync(tmp, { recursive: true, force: true });
});

function waitFor(check, timeoutMs = 5000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const value = await check();
        if (value) return resolve(value);
      } catch (err) {
        return reject(err);
      }
      if (Date.now() - started > timeoutMs) return reject(new Error('timed out waiting for condition'));
      setTimeout(tick, 20);
    };
    tick();
  });
}

/** Fake scanner child: records what it was given and lets each test decide how it ends. */
function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdinText = '';
  child.stdin = {
    on() {},
    end(text) {
      child.stdinText = String(text || '');
    },
  };
  child.signals = [];
  child.kill = (signal) => {
    child.signals.push(signal);
    setImmediate(() => child.emit('close', null));
    return true;
  };
  return child;
}

describe('scan child process', () => {
  /** @type {http.Server} */
  let server;
  let origin = '';
  let cookie = '';
  let csrf = '';
  const spawned = [];
  let onSpawn = () => {};

  async function staffRun(urls) {
    const res = await fetch(`${origin}/api/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie, 'X-CSRF-Token': csrf },
      body: JSON.stringify({ urls }),
    });
    return { res, json: await res.json() };
  }

  async function status(domain, runId) {
    const res = await fetch(`${origin}/api/status/${domain}/${runId}`, { headers: { cookie } });
    return res.json();
  }

  it('starts the app and logs in staff', async () => {
    const app = createAccessibilityApp(repoRoot, {
      lookup: async () => [{ address: '93.184.216.34', family: 4 }],
      spawn: (...args) => {
        const child = fakeChild();
        spawned.push({ args, child });
        onSpawn(child);
        return child;
      },
    });
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${server.address().port}`;
    const res = await fetch(`${origin}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'root', password: 'staff-secret-pass' }),
    });
    assert.equal(res.status, 200);
    const pairs = res.headers.getSetCookie().map((line) => line.split(';')[0]);
    cookie = pairs.join('; ');
    csrf = (pairs.find((p) => p.startsWith('wcag_csrf=')) || '').split('=')[1] || '';
  });

  it('hands URLs to the child on stdin and keeps stderr away from the client', async () => {
    onSpawn = (child) => {
      setImmediate(() => {
        child.stderr.emit('data', 'Error: boom\n    at main (/srv/accessibility-tests/run-tests.js:1:1)\n');
        child.emit('close', 1);
      });
    };
    const url = 'https://handover.example/page?a=1&b=2';
    const { res, json } = await staffRun(url);
    assert.equal(res.status, 200, JSON.stringify(json));

    const { args, child } = await waitFor(() => spawned.find((s) => s.child.stdinText));
    const argv = args[1];
    assert.ok(argv.includes('--urls-stdin'), argv.join(' '));
    assert.equal(argv.some((a) => String(a).includes('https://')), false);
    assert.deepEqual(JSON.parse(child.stdinText), [url]);

    const done = await waitFor(async () => {
      const s = await status(json.domain || json.id, json.runId);
      return s.status === 'error' ? s : null;
    });
    assert.equal(done.error, 'The scan could not be completed.');
    assert.equal(JSON.stringify(done).includes('/srv/'), false);
  });

  it('stops a child that outlives the process timeout', async () => {
    spawned.length = 0;
    onSpawn = () => {};
    const { res, json } = await staffRun('https://slow.example/');
    assert.equal(res.status, 200, JSON.stringify(json));
    const { child } = await waitFor(() => spawned[0]);
    await waitFor(() => child.signals.includes('SIGTERM'), 4000);
    const done = await waitFor(async () => {
      const s = await status(json.domain || json.id, json.runId);
      return s.status === 'error' ? s : null;
    });
    assert.equal(done.error, 'The scan took too long and was stopped.');
  });

  it('closes the test server', async () => {
    await new Promise((resolve) => server.close(resolve));
  });
});
