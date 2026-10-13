import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const tmp = mkdtempSync(join(tmpdir(), 'wcag-ux-contact-'));
process.env.REPORTS_BASE = tmp;
process.env.AUTH_ENABLED = 'true';
process.env.APP_USERNAME = 'root';
process.env.APP_PASSWORD = 'staff-secret-pass';
process.env.SESSION_SECRET = 'unit-test-session-secret-32chars!!';
process.env.WCAG_DISABLE_RATE_LIMIT = '1';
process.env.AUTH_EMAIL_VERIFY = 'auto';
process.env.DEFER_ROOT_LOGIN_TO_SHELL = 'true';
// A mail server that refuses connections: a lead must survive it.
process.env.SMTP_HOST = '127.0.0.1';
process.env.SMTP_PORT = '1';
process.env.MAIL_FROM = 'noreply@example.com';

const { createAccessibilityApp } = await import('../server/create-app.mjs');
const { commercialCtas, contactHref, LEAD_SOURCES } = await import('../server/plan-catalog.mjs');
const { leadConfirmationText, verifyEmailText } = await import('../server-email.js');

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(repoRoot, path), 'utf8');
after(() => rmSync(tmp, { recursive: true, force: true }));

const leads = () =>
  existsSync(join(tmp, '_leads.jsonl'))
    ? readFileSync(join(tmp, '_leads.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
    : [];

describe('one contact route', () => {
  it('sends every "talk to an expert" link to the in-app form', () => {
    assert.equal(commercialCtas().services, '/contact?source=scan-limit');
    assert.equal(contactHref('pricing'), '/contact?source=pricing');
    assert.equal(contactHref('not-a-source'), '/contact?source=contact');

    const walk = (dir) =>
      readdirSync(join(repoRoot, dir), { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]
      );
    for (const file of walk('web/src')) {
      assert.equal(read(file).includes('about-us.be/contact'), false, `${file} still links to the external contact page`);
    }
    for (const [file, source] of [
      ['web/src/layouts/Layout.astro', 'footer'],
      ['web/src/pages/pricing.astro', 'pricing'],
      ['web/src/pages/account.astro', 'account'],
      ['web/src/pages/index.astro', 'home'],
      ['web/src/components/LoginModal.astro', 'login'],
      ['web/src/components/ResultsDashboard.svelte', 'report'],
      ['web/src/pages/report/[domain]/history.astro', 'history'],
    ]) {
      assert.ok(LEAD_SOURCES.includes(source));
      assert.match(read(file), new RegExp(`/contact\\?source=${source}`), file);
    }
  });

  it('replaces the sent form with a status panel that takes focus', () => {
    const form = read('web/src/components/GuestLeadForm.svelte');
    assert.match(form, /\{#if sent\}/);
    assert.match(form, /role="status" tabindex="-1" bind:this=\{successEl\}/);
    assert.match(form, /successEl\?\.focus\(\)/);
    assert.match(form, /source,/);
    assert.match(read('web/src/pages/contact.astro'), /<GuestLeadForm[\s\S]*source=\{source\}/);
  });
});

describe('lead API', () => {
  let server;
  let origin = '';
  const send = (body) =>
    fetch(`${origin}/api/lead`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  it('starts the app', async () => {
    const app = createAccessibilityApp(repoRoot);
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${server.address().port}`;
  });

  it('keeps the lead and answers ok when the mail server is down', async () => {
    const res = await send({ name: 'Ann', email: 'ann@example.com', message: 'Audit please', source: 'pricing' });
    const data = await res.json();
    assert.equal(res.status, 200, JSON.stringify(data));
    assert.deepEqual(data, { ok: true, emailed: false, confirmationSent: false });
    const row = leads().find((lead) => lead.email === 'ann@example.com');
    assert.ok(row, 'the lead is stored');
    assert.equal(row.source, 'pricing');
    assert.equal(row.emailed, false);
  });

  it('stores an unknown source as "other"', async () => {
    await send({ name: 'Bob', email: 'bob@example.com', source: '<script>' });
    assert.equal(leads().find((lead) => lead.email === 'bob@example.com').source, 'other');
  });

  it('still validates name and email', async () => {
    assert.equal((await send({ name: '', email: 'x@example.com' })).status, 400);
    assert.equal((await send({ name: 'X', email: 'not-an-email' })).status, 400);
  });

  it('does not send a guest to the login page for /contact', async () => {
    const res = await fetch(`${origin}/contact?source=footer`, { redirect: 'manual' });
    assert.notEqual(res.status, 302);
    assert.notEqual(res.status, 401);
  });

  it('closes the test server', async () => {
    await new Promise((resolve) => server.close(resolve));
  });
});

describe('mail content', () => {
  it('confirms a request with real content', () => {
    const text = leadConfirmationText({ name: 'Ann', message: 'Audit please', scannedUrl: 'https://example.com/' });
    assert.match(text, /^Hello Ann,/);
    assert.match(text, /We received your request/);
    assert.match(text, /two working days/);
    assert.match(text, /Your message:\nAudit please/);
    assert.match(text, /Page you scanned: https:\/\/example\.com\//);
  });

  it('opens the verification mail with what it is and labels the link', () => {
    const text = verifyEmailText('https://wcag.example/api/auth/verify?token=abc');
    assert.match(text.split('\n')[0], /confirm that this email address is yours/);
    assert.match(text, /Confirm my email address:\nhttps:\/\/wcag\.example\/api\/auth\/verify\?token=abc/);
    assert.match(text, /48 hours/);
    assert.match(read('server/account-routes.mjs'), /action: \{ label: 'Confirm my email address', url: link \}/);
  });
});

describe('free scan used and result actions', () => {
  const home = read('web/src/pages/index.astro');
  const dashboard = read('web/src/components/ResultsDashboard.svelte');

  it('explains a used free scan under the URL field with ways to continue', () => {
    const field = home.indexOf('id="guest-url"');
    const box = home.indexOf('id="guest-freebie-used"');
    const submit = home.indexOf('id="guest-submit-btn"');
    assert.ok(field > 0 && box > field && box < submit, 'the message sits between the field and the submit button');
    assert.match(home, /id="guest-freebie-used" class="guest-freebie-used" role="alert" tabindex="-1" hidden/);
    assert.match(home, /href="\/pricing#tokens">Buy tokens/);
    assert.match(home, /data-open-login>Sign in/);
    assert.match(home, /data\.code === 'guest_freebie_used'/);
    assert.match(read('web/src/components/AppHeader.astro'), /\[data-open-login\]/);
  });

  it('names result actions by what they do and offers the next step', () => {
    assert.match(dashboard, /Export sales report \(PDF\)/);
    assert.match(dashboard, /Developer fix list/);
    assert.doesNotMatch(dashboard, /Developer next-steps/);
    assert.doesNotMatch(dashboard, />\s*Export PDF\s*</);
    assert.match(dashboard, /href="\/">Scan another page<\/a>/);
    assert.match(dashboard, /balanceLong\(balance\)/);
  });
});
