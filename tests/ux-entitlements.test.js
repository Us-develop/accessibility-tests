import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const tmp = mkdtempSync(join(tmpdir(), 'wcag-ux-entitlements-'));
process.env.REPORTS_BASE = tmp;
process.env.AUTH_ENABLED = 'true';
process.env.APP_USERNAME = 'root';
process.env.APP_PASSWORD = 'staff-secret-pass';
process.env.SESSION_SECRET = 'unit-test-session-secret-32chars!!';
process.env.WCAG_DISABLE_RATE_LIMIT = '1';
process.env.AUTH_EMAIL_VERIFY = 'auto';
process.env.DEFER_ROOT_LOGIN_TO_SHELL = 'true';

const { createAccessibilityApp } = await import('../server/create-app.mjs');
const { planAllows, PRO_PLAN_ID } = await import('../server/plan-catalog.mjs');
const { accessAllows, entitlementsFor } = await import('../server/entitlements.mjs');
const { applyStripeSubscription } = await import('../server/stripe.mjs');
const { attachRunToUser } = await import('../server/projects.mjs');
const { runDir } = await import('../server/run-ids.js');
const { deleteJiraOAuthForOwner, jiraOAuthFile, readJiraOAuth, writeJiraOAuth } = await import('../server/jira-oauth.mjs');
const { generateDeveloperAdvice } = await import('../generate-deliverables.js');

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(repoRoot, path), 'utf8');
after(() => rmSync(tmp, { recursive: true, force: true }));

const domain = 'entitled.example';
const RUN = '2026-10-10T10-00-00Z-eeeeeeeeeeee';

describe('plan rule', () => {
  it('keeps the sales report and Jira for active Pro', () => {
    const pro = { planId: PRO_PLAN_ID, status: 'active' };
    const cancelled = { planId: PRO_PLAN_ID, status: 'canceled' };
    for (const feature of ['salesReport', 'jira']) {
      assert.equal(planAllows(pro, feature), true);
      assert.equal(planAllows(cancelled, feature), false);
      assert.equal(planAllows(null, feature), false);
    }
    assert.equal(planAllows(null, 'fullReport'), true);
    assert.equal(planAllows(null, 'not-a-feature'), false);
  });

  it('lets staff use everything and guests nothing', async () => {
    assert.deepEqual(await entitlementsFor({ role: 'staff' }), { salesReport: true, jira: true });
    assert.deepEqual(await entitlementsFor(null), { salesReport: false, jira: false });
    assert.equal(await accessAllows({ role: 'guest' }, 'salesReport'), false);
  });
});

describe('Jira connections belong to their owner', () => {
  it('does not share a customer connection with another customer or with staff', () => {
    writeJiraOAuth(domain, { cloudId: 'cloud-a', refreshToken: 'r-a' }, 'user-a');
    assert.equal(readJiraOAuth(domain, 'user-a').cloudId, 'cloud-a');
    assert.equal(readJiraOAuth(domain, 'user-b'), null);
    assert.equal(readJiraOAuth(domain), null);
    assert.notEqual(jiraOAuthFile(domain, 'user-a'), jiraOAuthFile(domain));
    assert.equal(readFileSync(jiraOAuthFile(domain, 'user-a'), 'utf8').includes('r-a'), false, 'stored encrypted');
  });

  it('refuses an owner id that could leave its folder', () => {
    writeJiraOAuth(domain, { cloudId: 'x' }, '../../etc');
    assert.equal(readJiraOAuth(domain, '../../etc'), null);
  });

  it('is removed with the account', () => {
    deleteJiraOAuthForOwner('user-a');
    assert.equal(readJiraOAuth(domain, 'user-a'), null);
  });
});

describe('Pro-only surfaces over HTTP', () => {
  let server;
  let origin = '';

  async function signup(email) {
    const res = await fetch(`${origin}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'longenough1', acceptTerms: true }),
    });
    const pairs = res.headers.getSetCookie().map((line) => line.split(';')[0]);
    return {
      cookie: pairs.join('; '),
      csrf: (pairs.find((p) => p.startsWith('wcag_csrf=')) || '').split('=')[1] || '',
      userId: (await res.json()).user.id,
    };
  }

  const makePro = (userId, id) =>
    applyStripeSubscription({
      id,
      status: 'active',
      customer: `cus_${id}`,
      metadata: { userId },
      items: { data: [{ price: { id: 'price_x', recurring: { interval: 'month' } } }] },
    });

  const get = (who, path) => fetch(`${origin}${path}`, { headers: { cookie: who.cookie }, redirect: 'manual' });
  const sprint = (who, body) =>
    fetch(`${origin}/api/jira/sprint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: who.cookie, 'X-CSRF-Token': who.csrf },
      body: JSON.stringify(body),
    });

  let tokenUser;
  let proOwner;
  let proStranger;

  it('sets up a token customer, a Pro owner and a Pro stranger', async () => {
    const app = createAccessibilityApp(repoRoot);
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${server.address().port}`;

    tokenUser = await signup('token-tier@example.com');
    proOwner = await signup('pro-owner@example.com');
    proStranger = await signup('pro-stranger@example.com');
    await makePro(proOwner.userId, 'sub_owner');
    await makePro(proStranger.userId, 'sub_stranger');

    const dir = runDir(domain, RUN);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'accessibility-results.json'), JSON.stringify({ urls: [`https://${domain}/`], customResults: [], axeResults: {} }));
    await attachRunToUser(tokenUser.userId, domain, RUN);
    const proRun = '2026-10-11T10-00-00Z-ffffffffffff';
    mkdirSync(runDir(domain, proRun), { recursive: true });
    writeFileSync(join(runDir(domain, proRun), 'accessibility-results.json'), JSON.stringify({ urls: [], customResults: [], axeResults: {} }));
    await attachRunToUser(proOwner.userId, domain, proRun);
    proOwner.runId = proRun;
  });

  it('answers 403 for the sales report on a token-only account, on its own run', async () => {
    for (const path of [`/report/${domain}/${RUN}/sales`, `/report/${domain}/${RUN}/sales/`]) {
      const res = await get(tokenUser, path);
      assert.equal(res.status, 403, path);
      const html = await res.text();
      assert.match(html, /The sales report is part of Pro/);
      assert.match(html, /href="\/pricing#pro"/);
    }
  });

  it('lets a Pro owner through to the sales report', async () => {
    const res = await get(proOwner, `/report/${domain}/${proOwner.runId}/sales`);
    // No Astro app behind Express in this test, so "through" means not refused.
    assert.notEqual(res.status, 403);
    assert.notEqual(res.status, 401);
  });

  it('answers 403 on every Jira endpoint for a token-only account', async () => {
    for (const path of [`/api/jira/oauth/status?domain=${domain}`, `/api/jira/projects?domain=${domain}`, `/auth/jira/connect?domain=${domain}`]) {
      const res = await get(tokenUser, path);
      assert.equal(res.status, 403, path);
      assert.equal((await res.json()).code, 'pro_required', path);
    }
    const post = await sprint(tokenUser, { projectKey: 'ABC', tickets: [{ title: 't' }], domain, runId: RUN });
    assert.equal(post.status, 403);
    assert.equal((await post.json()).code, 'pro_required');
  });

  it('opens Jira to a Pro customer for their own site only', async () => {
    const own = await get(proOwner, `/api/jira/oauth/status?domain=${domain}`);
    assert.equal(own.status, 200);
    assert.deepEqual(await own.json(), { connected: false });

    const stranger = await get(proStranger, `/api/jira/oauth/status?domain=${domain}`);
    assert.equal(stranger.status, 403);
    assert.notEqual((await stranger.json()).code, 'pro_required');

    // A Pro customer cannot create tickets against someone else's run.
    const post = await sprint(proOwner, { projectKey: 'ABC', tickets: [{ title: 't' }], domain, runId: RUN });
    assert.equal(post.status, 403);
  });

  it('keeps a guest out', async () => {
    const res = await fetch(`${origin}/api/jira/oauth/status?domain=${domain}`, { redirect: 'manual' });
    assert.ok([401, 302].includes(res.status), String(res.status));
  });

  it('closes the test server', async () => {
    await new Promise((resolve) => server.close(resolve));
  });
});

describe('what the pages show', () => {
  it('hides the sales buttons for a plan without them and says why', () => {
    const dashboard = read('web/src/components/ResultsDashboard.svelte');
    assert.match(dashboard, /\{#if !locked && hasLoadedPages && entitlements\.salesReport\}/);
    assert.match(dashboard, /\{#if entitlements\.salesReport\}\s*<button class="btn btn-cream" onclick=\{gotoSales\}>Sales report<\/button>/);
    assert.match(dashboard, /\{#if !entitlements\.salesReport\}/);
    assert.match(dashboard, /href="\/pricing#pro">See what Pro includes<\/a>/);
    assert.match(read('web/src/pages/report/[domain]/[runId]/index.astro'), /entitlements: await entitlementsFor\(Astro\.locals\.access\)/);
    assert.match(read('web/src/pages/report/[domain]/[runId]/sales.astro'), /accessAllows\(Astro\.locals\.access, 'salesReport'\)/);
  });

  it('builds a developer guide with a contact button for all and Jira only on request', () => {
    const out = join(tmp, 'guide');
    mkdirSync(out, { recursive: true });
    const url = `https://${domain}/`;
    generateDeveloperAdvice(
      {
        reportData: { generatedAt: new Date().toISOString(), urls: [url], axeResults: {}, customResults: [] },
        fixOrderItems: [{ type: 'custom', id: 'img-alt', rule: 'Images MUST have alt text', url, status: 'fail', impact: 'high', effort: 'simple', wcag: ['1.1.1'], snippet: '<img alt="">' }],
        domain,
        runId: RUN,
      },
      out
    );
    const html = readFileSync(join(out, 'accessibility-developers.html'), 'utf8');
    assert.match(html, /<a class="btn btn-secondary btn-lg" href="\/contact\?source=developer-guide">Let Us fix this<\/a>/);
    assert.match(html, /id="add-to-jira-btn" type="button" hidden>/);
    assert.match(html, /\/api\/jira\/oauth\/status\?domain=/);
    assert.match(html, /openBtn\.hidden = false;/);
    assert.match(html, /'X-CSRF-Token': csrfToken\(\)/);
    assert.match(html, /Back to report/);
  });
});
