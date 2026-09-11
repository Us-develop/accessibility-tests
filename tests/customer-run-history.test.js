import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const tmp = mkdtempSync(join(tmpdir(), 'wcag-history-'));
process.env.REPORTS_BASE = tmp;
process.env.AUTH_ENABLED = 'true';
process.env.APP_USERNAME = 'root';
process.env.APP_PASSWORD = 'staff-history-pass';
process.env.SESSION_SECRET = 'unit-test-history-secret';
process.env.AUTH_EMAIL_VERIFY = 'auto';
process.env.DEFER_ROOT_LOGIN_TO_SHELL = 'true';

const { listRunsForDomain } = await import('../server/audit-list.js');
const { mergeRunIds } = await import('../server/db.js');
const { attachRunToUser, upsertProject } = await import('../server/projects.mjs');
const { canAccessRun, listAuditEntriesForAccess, listRunsForAccess, viewerUserId } = await import(
  '../server/run-access.mjs'
);
const { createAccessibilityApp } = await import('../server/create-app.mjs');

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const domain = 'shared.example';
const runA = '2026-01-01T00-00-00Z-aaa1';
const runB = '2026-01-02T00-00-00Z-bbb2';

after(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function writeRun(runId, pathLabel) {
  const dir = join(tmp, domain, runId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'accessibility-results.json'),
    JSON.stringify({
      urls: [`https://${domain}/${pathLabel}`],
      violations: [],
      passes: [],
      incomplete: [],
    }),
    'utf8'
  );
}

describe('viewerUserId', () => {
  it('scopes customers and leaves staff unscoped', () => {
    assert.equal(viewerUserId({ role: 'customer', userId: 'user-a' }), 'user-a');
    assert.equal(viewerUserId({ role: 'staff', userId: 'staff' }), null);
    assert.equal(viewerUserId({ role: 'guest' }), null);
    assert.equal(viewerUserId(null), null);
  });
});

describe('customer domain history', () => {
  it('hides another customer’s runs on the same domain', async () => {
    writeRun(runA, 'a');
    writeRun(runB, 'b');
    await attachRunToUser('user-a', domain, runA);
    await attachRunToUser('user-b', domain, runB);

    const staffRuns = await listRunsForDomain(null, tmp, domain);
    assert.deepEqual(
      staffRuns.map((r) => r.runId).sort(),
      [runA, runB].sort()
    );

    const mine = await listRunsForAccess({ role: 'customer', userId: 'user-a' }, domain, null, tmp);
    assert.deepEqual(
      mine.map((r) => r.runId),
      [runA]
    );

    const theirs = await listRunsForAccess({ role: 'customer', userId: 'user-b' }, domain, null, tmp);
    assert.deepEqual(
      theirs.map((r) => r.runId),
      [runB]
    );

    const staff = await listRunsForAccess({ role: 'staff', userId: 'staff' }, domain, null, tmp);
    assert.equal(staff.length, 2);

    assert.equal(await canAccessRun({ role: 'customer', userId: 'user-a' }, domain, runA), true);
    assert.equal(await canAccessRun({ role: 'customer', userId: 'user-a' }, domain, runB), false);
    assert.equal(await canAccessRun({ role: 'staff' }, domain, runB), true);

    const audits = await listAuditEntriesForAccess({ role: 'customer', userId: 'user-a' }, null, tmp);
    assert.equal(audits.length, 1);
    assert.equal(audits[0].domain, domain);
    assert.equal(audits[0].latestRunId, runA);
    assert.equal(audits[0].totalRuns, 1);
  });

  it('does not leak every disk run when a project has no runIds yet', async () => {
    writeRun(runA, 'a');
    writeRun(runB, 'b');
    await upsertProject({ userId: 'user-empty', domain });
    const leaked = await listRunsForAccess(
      { role: 'customer', userId: 'user-empty' },
      domain,
      null,
      tmp
    );
    assert.deepEqual(leaked.map((r) => r.runId), []);
  });
});

describe('history page wiring', () => {
  it('loads domain history through the access-aware helper', () => {
    const history = readFileSync(join(repoRoot, 'web/src/pages/report/[domain]/history.astro'), 'utf8');
    assert.match(history, /listRunsForAccess/);
    assert.match(history, /accessFromWebRequest/);
    const api = readFileSync(join(repoRoot, 'server/create-app.mjs'), 'utf8');
    assert.match(api, /listRunsForAccess\(req\.access, domain\)/);
    assert.match(api, /canAccessRun\(req\.access, domain, segment\)/);
    assert.match(api, /'manual-progress'/);
    assert.match(api, /'urls'/);
    assert.match(api, /resolveLatestRunIdForDomain\(domain, req\.access\)/);
    const db = readFileSync(join(repoRoot, 'server/db.js'), 'utf8');
    assert.match(db, /ADD COLUMN IF NOT EXISTS run_ids JSONB/);
    assert.match(db, /runIdsForProject/);
  });
});

describe('mergeRunIds', () => {
  it('keeps stored disk attachments alongside owned db runs', () => {
    assert.deepEqual(mergeRunIds(['db-run'], ['disk-run', 'db-run']), ['db-run', 'disk-run']);
  });
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

describe('HTTP customer run isolation', () => {
  it('lists only the signed-in customer’s runs and 403s another user’s report', async () => {
    writeRun(runA, 'a');
    writeRun(runB, 'b');
    const app = createAccessibilityApp(repoRoot);
    const { server, origin } = await listen(app);
    try {
      async function signup(email) {
        const jar = new CookieJar();
        const res = await fetch(`${origin}/api/auth/signup`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password: 'longenough1', name: email }),
        });
        jar.store(res.headers);
        const data = await res.json();
        assert.equal(res.status, 200, JSON.stringify(data));
        return { jar, user: data.user };
      }

      const a = await signup('history-a@example.com');
      const b = await signup('history-b@example.com');
      await attachRunToUser(a.user.id, domain, runA);
      await attachRunToUser(b.user.id, domain, runB);

      const mine = await fetch(`${origin}/api/audits/${encodeURIComponent(domain)}/runs`, {
        headers: { cookie: a.jar.header() },
      });
      const mineBody = await mine.json();
      assert.equal(mine.status, 200, JSON.stringify(mineBody));
      assert.deepEqual(
        mineBody.runs.map((r) => r.runId),
        [runA]
      );

      const theirs = await fetch(`${origin}/api/audits/${encodeURIComponent(domain)}/runs`, {
        headers: { cookie: b.jar.header() },
      });
      const theirsBody = await theirs.json();
      assert.equal(theirs.status, 200);
      assert.deepEqual(
        theirsBody.runs.map((r) => r.runId),
        [runB]
      );

      const blocked = await fetch(
        `${origin}/report/${encodeURIComponent(domain)}/${encodeURIComponent(runB)}/`,
        {
          headers: { cookie: a.jar.header() },
          redirect: 'manual',
        }
      );
      assert.equal(blocked.status, 403);

      const own = await fetch(
        `${origin}/report/${encodeURIComponent(domain)}/${encodeURIComponent(runA)}/`,
        {
          headers: { cookie: a.jar.header() },
          redirect: 'manual',
        }
      );
      assert.notEqual(own.status, 403);

      const urls = await fetch(`${origin}/api/report/${encodeURIComponent(domain)}/urls`, {
        headers: { cookie: a.jar.header() },
      });
      const urlsBody = await urls.json();
      assert.equal(urls.status, 200, JSON.stringify(urlsBody));
      assert.equal(urlsBody.runId, runA);

      const progress = await fetch(
        `${origin}/api/report/${encodeURIComponent(domain)}/manual-progress`,
        { headers: { cookie: a.jar.header() } }
      );
      assert.equal(progress.status, 200, await progress.text());

      const otherUrls = await fetch(`${origin}/api/report/${encodeURIComponent(domain)}/urls`, {
        headers: { cookie: b.jar.header() },
      });
      const otherUrlsBody = await otherUrls.json();
      assert.equal(otherUrls.status, 200, JSON.stringify(otherUrlsBody));
      assert.equal(otherUrlsBody.runId, runB);

      const staffJar = new CookieJar();
      const staffLogin = await fetch(`${origin}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'root', password: 'staff-history-pass' }),
      });
      staffJar.store(staffLogin.headers);
      assert.equal(staffLogin.status, 200);
      const staffRuns = await fetch(`${origin}/api/audits/${encodeURIComponent(domain)}/runs`, {
        headers: { cookie: staffJar.header() },
      });
      const staffBody = await staffRuns.json();
      assert.equal(staffRuns.status, 200, JSON.stringify(staffBody));
      assert.deepEqual(
        staffBody.runs.map((r) => r.runId).sort(),
        [runA, runB].sort()
      );
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
