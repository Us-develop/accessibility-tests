import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const tmp = mkdtempSync(join(tmpdir(), 'wcag-reviewed-'));
process.env.REPORTS_BASE = tmp;
process.env.AUTH_ENABLED = 'true';
process.env.APP_USERNAME = 'root';
process.env.APP_PASSWORD = 'staff-secret-pass';
process.env.SESSION_SECRET = 'unit-test-session-secret-32chars!!';
process.env.WCAG_DISABLE_RATE_LIMIT = '1';
process.env.AUTH_EMAIL_VERIFY = 'auto';
process.env.DEFER_ROOT_LOGIN_TO_SHELL = 'true';

const { createAccessibilityApp } = await import('../server/create-app.mjs');
const { attachRunToUser } = await import('../server/projects.mjs');
const { runDir } = await import('../server/run-ids.js');
const { carryReviewedForward, readReviewed, reviewableKeys, writeReviewed } = await import('../server/reviewed.mjs');

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
after(() => rmSync(tmp, { recursive: true, force: true }));

const domain = 'reviewed.example';
const home = `https://${domain}/`;
const about = `https://${domain}/about`;
const key = (id, url) => `${id}|${url}`;

/** A finished run with two warnings on home and, optionally, one on about. */
function seedRun(runId, { withAbout = true } = {}) {
  const dir = runDir(domain, runId);
  mkdirSync(dir, { recursive: true });
  const customResults = [
    { id: 'skip-link', status: 'warn', url: home, rule: 'Skip link' },
    { id: 'video-captions', status: 'warn', url: home, rule: 'Captions' },
    { id: 'img-alt', status: 'fail', url: home, rule: 'Alt text' },
  ];
  if (withAbout) customResults.push({ id: 'skip-link', status: 'warn', url: about, rule: 'Skip link' });
  writeFileSync(
    join(dir, 'accessibility-results.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), urls: [home, about], customResults, axeResults: {} }),
    'utf8'
  );
  writeFileSync(join(dir, 'accessibility-report.html'), '<html><body>ok</body></html>', 'utf8');
}

const RUN_1 = '2026-10-01T10-00-00Z-aaaaaaaaaaaa';
const RUN_2 = '2026-10-02T10-00-00Z-bbbbbbbbbbbb';
const RUN_3 = '2026-10-03T10-00-00Z-cccccccccccc';

describe('reviewed marks storage', () => {
  it('lists the warnings of a run as reviewable, not its failures', () => {
    seedRun(RUN_1);
    assert.deepEqual(reviewableKeys(domain, RUN_1), [
      key('skip-link', home),
      key('video-captions', home),
      key('skip-link', about),
    ]);
    assert.equal(reviewableKeys(domain, '2026-01-01T00-00-00Z-000000000000'), null);
  });

  it('saves only keys that are warnings of that run', () => {
    const saved = writeReviewed(domain, RUN_1, [
      key('skip-link', home),
      key('skip-link', home),
      key('img-alt', home),
      'made-up|https://elsewhere.example/',
      42,
    ]);
    assert.deepEqual(saved, [key('skip-link', home)]);
    assert.deepEqual(readReviewed(domain, RUN_1), [key('skip-link', home)]);
  });

  it('carries marks to the next run for warnings that are still there', async () => {
    writeReviewed(domain, RUN_1, [key('skip-link', home), key('skip-link', about)]);
    seedRun(RUN_2, { withAbout: false });
    const carried = await carryReviewedForward(domain, RUN_2, () => true);
    assert.deepEqual(carried, [key('skip-link', home)]);
    assert.deepEqual(readReviewed(domain, RUN_2), [key('skip-link', home)]);
  });

  it('does not inherit from a run the owner may not see', async () => {
    seedRun(RUN_3);
    const carried = await carryReviewedForward(domain, RUN_3, () => false);
    assert.deepEqual(carried, []);
    assert.deepEqual(readReviewed(domain, RUN_3), []);
  });

  it('leaves existing marks on a run alone', async () => {
    writeReviewed(domain, RUN_3, [key('video-captions', home)]);
    const carried = await carryReviewedForward(domain, RUN_3, () => true);
    assert.deepEqual(carried, [key('video-captions', home)]);
  });
});

describe('reviewed marks HTTP', () => {
  let server;
  let origin = '';

  async function signup(email) {
    const res = await fetch(`${origin}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'longenough1', name: 'T', acceptTerms: true }),
    });
    assert.equal(res.status, 200);
    const pairs = res.headers.getSetCookie().map((line) => line.split(';')[0]);
    const cookie = pairs.join('; ');
    const csrf = (pairs.find((p) => p.startsWith('wcag_csrf=')) || '').split('=')[1] || '';
    const account = await (await fetch(`${origin}/api/account`, { headers: { cookie } })).json();
    return { cookie, csrf, userId: account.user.id };
  }

  const put = (who, runId, body) =>
    fetch(`${origin}/api/report/${domain}/${runId}/reviewed`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', cookie: who.cookie, 'X-CSRF-Token': who.csrf },
      body: JSON.stringify(body),
    });

  it('lets the owner mark warnings and nobody else', async () => {
    const app = createAccessibilityApp(repoRoot, { lookup: async () => [{ address: '1.1.1.1', family: 4 }] });
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${server.address().port}`;

    const owner = await signup('review-owner@example.com');
    const other = await signup('review-other@example.com');
    const runId = '2026-10-04T10-00-00Z-dddddddddddd';
    seedRun(runId);
    await attachRunToUser(owner.userId, domain, runId);

    const saved = await put(owner, runId, { reviewed: [key('skip-link', home), 'bogus|x'] });
    assert.equal(saved.status, 200);
    assert.deepEqual((await saved.json()).reviewed, [key('skip-link', home)]);

    const read = await fetch(`${origin}/api/report/${domain}/${runId}/reviewed`, { headers: { cookie: owner.cookie } });
    assert.deepEqual((await read.json()).reviewed, [key('skip-link', home)]);

    assert.equal((await put(other, runId, { reviewed: [] })).status, 403);
    const otherRead = await fetch(`${origin}/api/report/${domain}/${runId}/reviewed`, { headers: { cookie: other.cookie } });
    assert.equal(otherRead.status, 403);
    assert.deepEqual(readReviewed(domain, runId), [key('skip-link', home)]);

    assert.equal((await put(owner, runId, { reviewed: 'all' })).status, 400);
    const noCsrf = await fetch(`${origin}/api/report/${domain}/${runId}/reviewed`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', cookie: owner.cookie },
      body: JSON.stringify({ reviewed: [] }),
    });
    assert.equal(noCsrf.status, 403);

    await new Promise((resolve) => server.close(resolve));
  });
});
