import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const tmp = mkdtempSync(join(tmpdir(), 'wcag-free-unlimited-'));
process.env.REPORTS_BASE = tmp;
process.env.AUTH_ENABLED = 'true';
process.env.APP_USERNAME = 'root';
process.env.APP_PASSWORD = 'staff-secret-pass';
process.env.SESSION_SECRET = 'unit-test-session-secret-32chars!!';
process.env.WCAG_DISABLE_RATE_LIMIT = '1';
process.env.DEFER_ROOT_LOGIN_TO_SHELL = 'true';
process.env.FREE_SCAN_UNLIMITED_HOSTS = 'about-us.be, demo.example';

const { createAccessibilityApp } = await import('../server/create-app.mjs');
const { isUnlimitedFreeScanHost } = await import('../server/guest.mjs');

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
after(() => rmSync(tmp, { recursive: true, force: true }));

describe('which sites are exempt', () => {
  it('matches listed names with or without www., in any case', () => {
    for (const host of ['about-us.be', 'www.about-us.be', 'ABOUT-US.BE', 'about-us.be.', 'demo.example']) {
      assert.equal(isUnlimitedFreeScanHost(host), true, host);
    }
    for (const host of ['cronos.be', 'shop.about-us.be', 'about-us.be.evil.com', 'notabout-us.be', '']) {
      assert.equal(isUnlimitedFreeScanHost(host), false, host);
    }
  });

  it('exempts nothing when the setting is empty', () => {
    const saved = process.env.FREE_SCAN_UNLIMITED_HOSTS;
    process.env.FREE_SCAN_UNLIMITED_HOSTS = '';
    try {
      assert.equal(isUnlimitedFreeScanHost('about-us.be'), false);
    } finally {
      process.env.FREE_SCAN_UNLIMITED_HOSTS = saved;
    }
  });
});

describe('guest scans', () => {
  let server;
  let origin = '';

  /** A fake scanner that finishes at once, so a new scan from the same address is allowed to start. */
  function fakeSpawn() {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = { on() {}, end() {} };
    child.kill = () => true;
    setImmediate(() => child.emit('close', 1));
    return child;
  }

  /** One browser: keeps its cookies, like a real visitor. */
  function visitor() {
    const jar = new Map();
    const store = (res) => {
      for (const line of res.headers.getSetCookie()) {
        const [pair] = line.split(';');
        const at = pair.indexOf('=');
        jar.set(pair.slice(0, at), pair.slice(at + 1));
      }
    };
    const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    return {
      async start() {
        store(await fetch(`${origin}/api/config`));
      },
      async scan(url) {
        const res = await fetch(`${origin}/api/run`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', cookie: cookie(), 'X-CSRF-Token': jar.get('wcag_csrf') || '' },
          body: JSON.stringify({ url }),
        });
        store(res);
        await new Promise((resolve) => setTimeout(resolve, 60));
        return { status: res.status, body: await res.json() };
      },
    };
  }

  it('starts the app', async () => {
    const app = createAccessibilityApp(repoRoot, {
      lookup: async () => [{ address: '93.184.216.34', family: 4 }],
      spawn: fakeSpawn,
    });
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${server.address().port}`;
  });

  it('lets a guest scan the exempt site again and again, and still have their free scan', async () => {
    const guest = visitor();
    await guest.start();
    for (const url of ['https://about-us.be/', 'https://www.about-us.be/diensten', 'https://about-us.be/contact']) {
      const res = await guest.scan(url);
      assert.equal(res.status, 200, `${url}: ${JSON.stringify(res.body)}`);
    }
    // Their own free scan is still there...
    const own = await guest.scan('https://cronos.be/');
    assert.equal(own.status, 200, JSON.stringify(own.body));
    // ...and is used up after that, for any other site.
    const again = await guest.scan('https://another.example/');
    assert.equal(again.status, 429);
    assert.equal(again.body.code, 'guest_freebie_used');
    // The exempt site keeps working.
    assert.equal((await guest.scan('https://about-us.be/')).status, 200);
  });

  it('closes the test server', async () => {
    await new Promise((resolve) => server.close(resolve));
  });
});
