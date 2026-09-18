import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const tmp = mkdtempSync(join(tmpdir(), 'wcag-tenancy-'));
process.env.REPORTS_BASE = tmp;
process.env.AUTH_ENABLED = 'true';
process.env.APP_USERNAME = 'root';
process.env.APP_PASSWORD = 'staff-secret-pass';
process.env.SESSION_SECRET = 'unit-test-session-secret-32chars!!';
process.env.WCAG_DISABLE_RATE_LIMIT = '1';
process.env.AUTH_EMAIL_VERIFY = 'auto';
process.env.DEFER_ROOT_LOGIN_TO_SHELL = 'true';

const { createAccessibilityApp } = await import('../server/create-app.mjs');
const { attachRunToUser, upsertProject, canAccessRun, parseTenantPath } = await import('../server/projects.mjs');
const { listVisibleRunsForDomain, viewerFromAstro } = await import('../server/audit-viewer.mjs');
const { SESSION_COOKIE } = await import('../server/session.mjs');
const { onRequest: astroOnRequest } = await import('../web/src/middleware.js');
const { newRunId, isValidRunId, runDir } = await import('../server/run-ids.js');
const { persistGuestToken, readGuestTokenRecord, pruneExpiredGuestTokens } = await import('../server/guest.mjs');
const { findRunningRun } = await import('../server/queue.mjs');
const { enqueueScanJob, listJobs, deleteJob } = await import('../server/queue.mjs');
const { migrateDomainManualProgress } = await import('../scripts/migrate-manual-progress.mjs');

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const domain = 'shared.example';

after(() => {
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

async function signup(origin, email) {
  const jar = new CookieJar();
  const res = await fetch(`${origin}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'longenough1', name: email.split('@')[0], acceptTerms: true }),
  });
  jar.store(res.headers);
  const data = await res.json();
  assert.equal(res.status, 200, data.error || 'signup failed');
  const account = await fetch(`${origin}/api/account`, { headers: { cookie: jar.header() } });
  const bundle = await account.json();
  return { jar, user: bundle.user };
}

function seedRun(ownerUserId, runId) {
  const dir = runDir(domain, runId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'accessibility-results.json'),
    JSON.stringify({
      generatedAt: new Date().toISOString(),
      urls: [`https://${domain}/`],
    }),
    'utf8'
  );
  writeFileSync(join(dir, 'accessibility-report.html'), '<html><body>ok</body></html>', 'utf8');
  return attachRunToUser(ownerUserId, domain, runId);
}

function headers(jar, extra = {}) {
  return {
    cookie: jar.header(),
    'X-CSRF-Token': jar.get('wcag_csrf'),
    ...extra,
  };
}

function waitFor(check, timeoutMs = 2000) {
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
        reject(new Error('timed out waiting'));
        return;
      }
      setTimeout(tick, 20);
    };
    tick();
  });
}

describe('run ids', () => {
  it('uses at least 12 random hex chars after the timestamp', () => {
    const id = newRunId(new Date('2026-05-04T13:45:12.000Z'));
    assert.equal(isValidRunId(id), true);
    const suffix = id.match(/Z-([0-9a-f]+)$/);
    assert.ok(suffix, id);
    assert.ok(suffix[1].length >= 12, suffix[1]);
    assert.match(suffix[1], /^[0-9a-f]{12}$/);
  });
});

describe('parseTenantPath', () => {
  it('treats debug deliverable URLs as run-scoped', () => {
    const parsed = parseTenantPath('/api/debug/deliverable/example.com/2026-05-04T13-45-12Z-aabbccddeeff/file');
    assert.equal(parsed.scoped, 'run');
    assert.equal(parsed.domain, 'example.com');
    assert.equal(parsed.runId, '2026-05-04T13-45-12Z-aabbccddeeff');
  });

  it('keeps history and audits runs domain-scoped', () => {
    assert.equal(parseTenantPath('/report/example.com/history').scoped, 'domain');
    assert.equal(parseTenantPath('/api/audits/example.com/runs').scoped, 'domain');
  });
});

describe('canAccessRun memory fallthrough', () => {
  it('does not deny when the in-memory run has a null userId', async () => {
    const ownerId = 'owner-guest-attach';
    const runId = '2026-01-01T00-00-00Z-fallthroughaa';
    await seedRun(ownerId, runId);
    assert.equal(
      await canAccessRun(
        { role: 'customer', userId: ownerId },
        domain,
        runId,
        { memoryRun: { userId: null, guestToken: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', tier: 'guest' } }
      ),
      true
    );
    assert.equal(
      await canAccessRun(
        { role: 'customer', userId: 'someone-else' },
        domain,
        runId,
        { memoryRun: { userId: null } }
      ),
      false
    );
  });
});

describe('findRunningRun owner scope', () => {
  it('does not 409 a customer on a guest run of the same domain', () => {
    const runStatus = new Map();
    runStatus.set('shared.example:guest-run', {
      status: 'running',
      userId: null,
      guestToken: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      tier: 'guest',
    });
    assert.equal(findRunningRun(runStatus, 'shared.example', { userId: 'customer-a' }), null);
    assert.equal(findRunningRun(runStatus, 'shared.example', { userId: 'staff' }), null);
    assert.equal(
      findRunningRun(runStatus, 'shared.example', { guestToken: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' })?.runId,
      'guest-run'
    );
    assert.equal(findRunningRun(runStatus, 'shared.example')?.runId, 'guest-run');
  });
});

describe('guest token expiry', () => {
  it('rejects expired tokens and prune removes them', () => {
    const token = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    persistGuestToken(token, {
      domain,
      runId: '2026-01-01T00-00-00Z-aabbccddeeff',
      url: `https://${domain}/`,
      createdAt: '2020-01-01T00:00:00.000Z',
      expiresAt: '2020-01-31T00:00:00.000Z',
    });
    assert.equal(readGuestTokenRecord(token), null);
    const { pruned } = pruneExpiredGuestTokens();
    assert.ok(pruned >= 1);
    assert.equal(readGuestTokenRecord(token), null);
  });

  it('returns a fresh token', () => {
    const token = 'cccccccccccccccccccccccccccccccc';
    persistGuestToken(token, {
      domain,
      runId: '2026-01-01T00-00-00Z-aabbccddeeff',
      url: `https://${domain}/`,
    });
    const rec = readGuestTokenRecord(token);
    assert.equal(rec.domain, domain);
    assert.ok(rec.expiresAt);
  });
});

describe('migrate domain manual-progress', () => {
  it('copies the domain file into the latest run and deletes it', () => {
    const reports = mkdtempSync(join(tmpdir(), 'wcag-mp-'));
    const runId = '2026-05-04T13-45-12Z-aabbccddeeff';
    const runFolder = join(reports, domain, runId);
    mkdirSync(runFolder, { recursive: true });
    writeFileSync(join(runFolder, 'accessibility-results.json'), '{}', 'utf8');
    writeFileSync(join(reports, domain, 'manual-progress.json'), JSON.stringify({ checked: ['x'] }), 'utf8');
    const summary = migrateDomainManualProgress(reports, { apply: true });
    const row = summary.domains.find((d) => d.domain === domain);
    assert.equal(row.copied, true);
    assert.equal(existsSync(join(reports, domain, 'manual-progress.json')), false);
    assert.equal(existsSync(join(runFolder, 'manual-progress.json')), true);
    rmSync(reports, { recursive: true, force: true });
  });
});

describe('tenant isolation HTTP', () => {
  /** @type {http.Server} */
  let server;
  /** @type {string} */
  let origin;
  /** @type {CookieJar} */
  let jarA;
  /** @type {CookieJar} */
  let jarB;
  /** @type {string} */
  let runIdA;

  it('starts the app', async () => {
    const app = createAccessibilityApp(repoRoot, {
      lookup: async () => [{ address: '1.1.1.1', family: 4 }],
    });
    app.get('/report/:domain/:runId/', (req, res) => {
      res.status(200).type('html').send('<html><body>ok</body></html>');
    });
    const started = await listen(app);
    server = started.server;
    origin = started.origin;
  });

  it('blocks customer B from customer A run on a shared domain', async () => {
    const a = await signup(origin, 'tenanta@example.com');
    const b = await signup(origin, 'tenantb@example.com');
    jarA = a.jar;
    jarB = b.jar;
    await upsertProject({ userId: b.user.id, domain, name: 'B project' });
    runIdA = newRunId();
    await seedRun(a.user.id, runIdA);
    assert.equal(await canAccessRun({ role: 'customer', userId: a.user.id }, domain, runIdA), true);
    assert.equal(await canAccessRun({ role: 'customer', userId: b.user.id }, domain, runIdA), false);

    const statusB = await fetch(`${origin}/api/status/${domain}/${runIdA}`, { headers: headers(jarB) });
    assert.equal(statusB.status, 403);

    const reportB = await fetch(`${origin}/report/${domain}/${runIdA}/`, {
      headers: headers(jarB),
      redirect: 'manual',
    });
    assert.equal(reportB.status, 403);

    const putB = await fetch(`${origin}/api/report/${domain}/${runIdA}/manual-progress`, {
      method: 'PUT',
      headers: { ...headers(jarB), 'Content-Type': 'application/json' },
      body: JSON.stringify({ checked: [] }),
    });
    assert.equal(putB.status, 403);

    const wcagB = await fetch(`${origin}/api/report/${domain}/${runIdA}/wcag-analysis`, {
      method: 'POST',
      headers: { ...headers(jarB), 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(wcagB.status, 403);

    const debugB = await fetch(
      `${origin}/api/debug/deliverable/${domain}/${runIdA}/accessibility-client.html`,
      { headers: headers(jarB) }
    );
    assert.equal(debugB.status, 403);

    const latestB = await fetch(`${origin}/report/${domain}/`, {
      headers: headers(jarB),
      redirect: 'manual',
    });
    assert.notEqual(latestB.status, 301);
    assert.notEqual(latestB.status, 302);
    const loc = latestB.headers.get('location') || '';
    assert.equal(loc.includes(runIdA), false);
    assert.equal(latestB.status, 404);

    const historyB = await fetch(`${origin}/api/audits/${domain}/runs`, { headers: headers(jarB) });
    const historyBody = await historyB.json();
    assert.equal(historyB.status, 200);
    assert.equal((historyBody.runs || []).some((row) => row.runId === runIdA), false);

    const auditsB = await fetch(`${origin}/api/audits`, { headers: headers(jarB) });
    const auditsBody = await auditsB.json();
    assert.equal(auditsB.status, 200);
    const row = (auditsBody.audits || []).find((item) => item.domain === domain);
    assert.equal(row?.latestRunId, undefined);

    const statusA = await fetch(`${origin}/api/status/${domain}/${runIdA}`, { headers: headers(jarA) });
    assert.equal(statusA.status, 200);

    const auditsA = await fetch(`${origin}/api/audits`, { headers: headers(jarA) });
    const aBody = await auditsA.json();
    const aRow = (aBody.audits || []).find((item) => item.domain === domain);
    assert.equal(aRow?.latestRunId, runIdA);

    const historyA = await fetch(`${origin}/api/audits/${domain}/runs`, { headers: headers(jarA) });
    const historyABody = await historyA.json();
    assert.equal(historyA.status, 200);
    assert.equal((historyABody.runs || []).some((row) => row.runId === runIdA), true);
  });

  it('domain history lists the customer own runs from the session cookie, not Astro.locals alone', async () => {
    assert.ok(runIdA, 'expected customer A run from the previous test');
    const anonymous = await listVisibleRunsForDomain(null, process.env.REPORTS_BASE, domain, {});
    assert.equal(
      anonymous.some((row) => row.runId === runIdA),
      false,
      'missing viewer must not leak another tenant, and must not look like an empty project to the owner'
    );

    const sessionToken = jarA.get('wcag_sid');
    assert.ok(sessionToken);
    const fromCookie = await listVisibleRunsForDomain(null, process.env.REPORTS_BASE, domain, {
      sessionToken,
    });
    assert.equal(fromCookie.some((row) => row.runId === runIdA), true);

    const astro = {
      locals: {},
      cookies: {
        get: (name) => (name === SESSION_COOKIE ? { value: sessionToken } : undefined),
      },
    };
    const fromAstroCookie = await listVisibleRunsForDomain(
      null,
      process.env.REPORTS_BASE,
      domain,
      viewerFromAstro(astro)
    );
    assert.equal(fromAstroCookie.some((row) => row.runId === runIdA), true);

    const locals = {};
    await astroOnRequest(
      {
        locals,
        request: {
          headers: {
            get: (name) => (String(name).toLowerCase() === 'cookie' ? jarA.header() : null),
          },
        },
      },
      async () => new Response('ok')
    );
    assert.equal(locals.access?.role, 'customer');
    assert.ok(locals.access?.userId);
    const fromMiddleware = await listVisibleRunsForDomain(null, process.env.REPORTS_BASE, domain, {
      access: locals.access,
    });
    assert.equal(fromMiddleware.some((row) => row.runId === runIdA), true);
  });

  it('lets a customer open an attached guest run while the memory record still exists', async () => {
    const guestDomain = 'guest-attach.example';
    const guestRunId = '2026-01-01T00-00-00Z-aabbccddeeff';
    const guestToken = 'dddddddddddddddddddddddddddddddd';
    persistGuestToken(guestToken, {
      domain: guestDomain,
      runId: guestRunId,
      url: `https://${guestDomain}/`,
    });
    const dir = runDir(guestDomain, guestRunId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'accessibility-results.json'), JSON.stringify({ urls: [`https://${guestDomain}/`] }), 'utf8');
    writeFileSync(join(dir, 'accessibility-report.html'), '<html><body>guest</body></html>', 'utf8');

    enqueueScanJob({
      id: `${guestDomain}:${guestRunId}`,
      domain: guestDomain,
      runId: guestRunId,
      userId: null,
      guestToken,
      tier: 'guest',
      urls: ['http://127.0.0.1/blocked'],
    });
    await waitFor(() => listJobs().every((job) => job.id !== `${guestDomain}:${guestRunId}`));

    const jar = new CookieJar();
    const res = await fetch(`${origin}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'guest-owner@example.com',
        password: 'longenough1',
        guestToken,
        acceptTerms: true,
      }),
    });
    jar.store(res.headers);
    assert.equal(res.status, 200, (await res.clone().json().catch(() => ({}))).error || 'signup failed');

    const status = await fetch(`${origin}/api/status/${guestDomain}/${guestRunId}`, { headers: headers(jar) });
    assert.equal(status.status, 200);

    const report = await fetch(`${origin}/report/${guestDomain}/${guestRunId}/`, {
      headers: headers(jar),
      redirect: 'manual',
    });
    assert.equal(report.status, 200);

    const attached = await listVisibleRunsForDomain(null, process.env.REPORTS_BASE, guestDomain, {
      sessionToken: jar.get('wcag_sid'),
    });
    assert.equal(attached.some((row) => row.runId === guestRunId), true);
    deleteJob(`${guestDomain}:${guestRunId}`);
  });

  it('lets customer A write manual progress only on their run', async () => {
    const putA = await fetch(`${origin}/api/report/${domain}/${runIdA}/manual-progress`, {
      method: 'PUT',
      headers: { ...headers(jarA), 'Content-Type': 'application/json' },
      body: JSON.stringify({ checked: [] }),
    });
    assert.equal(putA.status, 200);
    assert.equal(existsSync(join(runDir(domain, runIdA), 'manual-progress.json')), true);
    assert.equal(existsSync(join(tmp, domain, 'manual-progress.json')), false);
  });

  it('closes the test server', async () => {
    await new Promise((resolve) => server.close(resolve));
  });
});
