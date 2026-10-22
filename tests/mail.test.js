import { after, afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const tmp = mkdtempSync(join(tmpdir(), 'wcag-mail-'));
process.env.REPORTS_BASE = tmp;
process.env.AUTH_ENABLED = 'true';
process.env.APP_USERNAME = 'root';
process.env.APP_PASSWORD = 'staff-secret-pass';
process.env.SESSION_SECRET = 'unit-test-session-secret-32chars!!';
process.env.WCAG_DISABLE_RATE_LIMIT = '1';
process.env.AUTH_EMAIL_VERIFY = 'required';
process.env.DEFER_ROOT_LOGIN_TO_SHELL = 'true';
process.env.PUBLIC_BASE_URL = 'https://wcag.example';
process.env.MAIL_FROM = 'noreply@example.com';
process.env.ACCESS_REQUEST_TO = 'team@us.example';
delete process.env.SMTP_HOST;
delete process.env.WCAG_DEFAULT_LANG;

const { buildMail, MAIL_KINDS, MAIL_PARAMS, COMMON_MAIL_PARAMS } = await import('../server/mail-messages.mjs');
const { sendMail, sendMailSafely, setSmtpTransportFactory } = await import('../server-email.js');
const { createAccessibilityApp } = await import('../server/create-app.mjs');
const { getUserByEmail, takeIssuedAuthToken } = await import('../server/users.mjs');

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Mails the fake SMTP server received; set `failing` to make it refuse them. */
const smtp = { sent: [], failing: false };
function useFakeSmtp() {
  smtp.sent = [];
  smtp.failing = false;
  setSmtpTransportFactory(() => ({
    sendMail: async (mail) => {
      if (smtp.failing) throw Object.assign(new Error('connect ECONNREFUSED to secret@person.example'), { code: 'ECONNREFUSED' });
      smtp.sent.push(mail);
      return { messageId: mail.messageId };
    },
  }));
}

function captureWarnings() {
  const lines = [];
  const original = console.warn;
  console.warn = (...args) => lines.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
  return { lines, restore: () => (console.warn = original) };
}

/** Wait for a mail sent in the background (not awaited by the route). */
async function waitForMail(predicate, ms = 2000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const found = smtp.sent.find(predicate);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return null;
}

after(() => {
  setSmtpTransportFactory(null);
  rmSync(tmp, { recursive: true, force: true });
});

const SAMPLE_DATA = {
  verify: { firstName: 'Pat', email: 'pat@example.com', link: 'https://wcag.example/api/auth/verify?token=t1' },
  'signup-existing': { firstName: 'Pat' },
  reset: { firstName: 'Pat', link: 'https://wcag.example/reset?token=t2' },
  'email-change': { firstName: 'Pat', newEmail: 'new@example.com', link: 'https://wcag.example/api/auth/verify?token=t3' },
  'email-change-notice': { firstName: 'Pat', newEmail: 'new@example.com' },
  'run-notification': {
    status: 'done',
    domain: 'example.com',
    runId: 'run-1',
    reportUrl: 'https://wcag.example/report/example.com/run-1/',
    score: 72.4,
    pages: 3,
    issues: 1,
  },
  lead: {
    name: 'Ann Smith',
    company: 'Acme',
    email: 'ann@example.com',
    phone: '+32 2 123 45 67',
    message: 'Audit please',
    source: 'pricing',
    scannedUrl: 'https://example.com/',
    domain: 'example.com',
    score: 58,
    teaserUrl: 'https://wcag.example/teaser/abc',
    visitorLang: 'en',
  },
  'lead-confirmation': {
    name: 'Ann',
    scannedUrl: 'https://example.com/',
    message: 'Audit please',
    teaserUrl: 'https://wcag.example/teaser/abc',
  },
};

describe('mail contract', () => {
  it('covers every mail type', () => {
    assert.deepEqual([...MAIL_KINDS].sort(), Object.keys(SAMPLE_DATA).sort());
  });

  for (const kind of Object.keys(SAMPLE_DATA)) {
    for (const lang of ['nl', 'en']) {
      it(`${kind} (${lang}) sends exactly its params, as strings, with every placeholder filled`, () => {
        const mail = buildMail(kind, lang, SAMPLE_DATA[kind]);
        assert.equal(mail.lang, lang);
        assert.deepEqual(Object.keys(mail.params).sort(), [...COMMON_MAIL_PARAMS, ...MAIL_PARAMS[kind]].sort());
        for (const [name, value] of Object.entries(mail.params)) {
          assert.equal(typeof value, 'string', `${name} is a string`);
        }
        assert.equal(mail.params.lang, lang);
        assert.equal(mail.params.siteUrl, 'https://wcag.example');
        assert.ok(mail.subject.trim());
        assert.ok(mail.text.trim());
        assert.doesNotMatch(`${mail.subject}\n${mail.text}`, /\{\w+\}|mail\.\w/);
      });
    }
  }

  it('is documented param by param in docs/EMAIL-TEMPLATES.md', () => {
    const doc = readFileSync(join(repoRoot, 'docs/EMAIL-TEMPLATES.md'), 'utf8');
    for (const kind of MAIL_KINDS) {
      const row = doc.split('\n').find((line) => line.startsWith(`| \`${kind}\` |`));
      assert.ok(row, `${kind} has a row`);
      const envName = `BREVO_TEMPLATE_${kind.toUpperCase().replace(/-/g, '_')}_NL`;
      assert.ok(row.includes(envName), `${kind} names ${envName}`);
      const documented = [...row.split('|')[4].matchAll(/`(\w+)`/g)].map((m) => m[1]).filter((name) => name !== 'done' && name !== 'error' && name !== 'nl' && name !== 'en');
      assert.deepEqual(documented, MAIL_PARAMS[kind], kind);
    }
    for (const name of COMMON_MAIL_PARAMS) assert.match(doc, new RegExp(`\\| \`${name}\` \\|`));
  });

  it('sends missing values as empty strings', () => {
    const mail = buildMail('verify', 'nl', {});
    assert.equal(mail.params.firstName, '');
    assert.equal(mail.params.link, '');
    assert.equal(mail.action, null);
  });

  it('writes Dutch and English, and falls back to Dutch for an unknown language', () => {
    assert.equal(buildMail('verify', 'nl').subject, 'Bevestig uw e-mailadres · Us toegankelijkheid');
    assert.equal(buildMail('verify', 'en').subject, 'Confirm your email address · Us accessibility');
    assert.equal(buildMail('verify', 'fr').lang, 'nl');
    assert.equal(buildMail('verify', null).lang, 'nl');
    assert.throws(() => buildMail('access-request', 'nl'), /Unknown mail kind/);
  });

  it('formats values for the language: expiry, score, pages and issues', () => {
    assert.equal(buildMail('verify', 'nl').params.expiresIn, '48 uur');
    assert.equal(buildMail('verify', 'en').params.expiresIn, '48 hours');
    assert.equal(buildMail('reset', 'nl').params.expiresIn, '2 uur');
    assert.equal(buildMail('reset', 'en').params.expiresIn, '2 hours');
    assert.equal(buildMail('email-change', 'en').params.expiresIn, '48 hours');

    const nl = buildMail('run-notification', 'nl', SAMPLE_DATA['run-notification']).params;
    assert.equal(nl.score, '72/100');
    assert.equal(nl.pages, "3 pagina's");
    assert.equal(nl.issues, '1 probleem');
    const en = buildMail('run-notification', 'en', { ...SAMPLE_DATA['run-notification'], pages: 1, issues: 12 }).params;
    assert.equal(en.pages, '1 page');
    assert.equal(en.issues, '12 issues');
    assert.equal(buildMail('lead', 'en', SAMPLE_DATA.lead).params.score, '58/100');
    assert.equal(buildMail('lead', 'en', { ...SAMPLE_DATA.lead, score: null }).params.score, '');
  });

  it('reports a failed scan with its error and without a score', () => {
    const mail = buildMail('run-notification', 'en', { ...SAMPLE_DATA['run-notification'], status: 'error', errorMessage: 'Timeout' });
    assert.equal(mail.params.status, 'error');
    assert.equal(mail.params.score, '');
    assert.equal(mail.params.errorMessage, 'Timeout');
    assert.match(mail.text, /Timeout/);
    assert.equal(buildMail('run-notification', 'nl', { status: 'error' }).params.errorMessage, 'Onbekende fout');
  });

  it('greets by first name, and without a name when there is none', () => {
    assert.match(buildMail('reset', 'nl', { firstName: 'Pat' }).text, /^Beste Pat,/);
    assert.match(buildMail('reset', 'nl', {}).text, /^Goeiedag,/);
    assert.match(buildMail('reset', 'en', {}).text, /^Hello,/);
  });
});

describe('sending', () => {
  afterEach(() => setSmtpTransportFactory(null));

  it('sends the text with the main link as a labelled action and a reply-to', async () => {
    useFakeSmtp();
    const result = await sendMail({
      kind: 'reset',
      to: 'pat@example.com',
      lang: 'en',
      replyTo: 'team@us.example',
      data: { firstName: 'Pat', link: 'https://wcag.example/reset?token=a&b' },
    });
    assert.equal(result.emailed, true);
    assert.equal(result.lang, 'en');
    const [mail] = smtp.sent;
    assert.equal(mail.to, 'pat@example.com');
    assert.equal(mail.from, 'noreply@example.com');
    assert.equal(mail.replyTo, 'team@us.example');
    assert.equal(mail.subject, 'Reset your Us accessibility password');
    assert.match(mail.text, /https:\/\/wcag\.example\/reset\?token=a&b/);
    assert.match(mail.html, /<a href="https:\/\/wcag\.example\/reset\?token=a&amp;b">Reset my password<\/a>/);
  });

  it('skips and logs only the domain when no mail server is configured', async () => {
    const log = captureWarnings();
    try {
      const result = await sendMail({ kind: 'verify', to: 'pat@example.com', lang: 'nl', data: SAMPLE_DATA.verify });
      assert.equal(result.emailed, false);
      assert.equal(result.skipped, true);
    } finally {
      log.restore();
    }
    const blob = log.lines.join('\n');
    assert.match(blob, /"kind":"verify"/);
    assert.match(blob, /"domain":"example\.com"/);
    assert.doesNotMatch(blob, /pat@example\.com|token=/);
  });

  it('never throws from sendMailSafely, and logs kind, language, domain and code only', async () => {
    useFakeSmtp();
    smtp.failing = true;
    const log = captureWarnings();
    let result;
    try {
      result = await sendMailSafely({ kind: 'verify', to: 'pat@example.com', lang: 'en', data: SAMPLE_DATA.verify });
    } finally {
      log.restore();
    }
    assert.deepEqual(result, { emailed: false });
    const blob = log.lines.join('\n');
    assert.match(blob, /\[email\] failed/);
    assert.match(blob, /"kind":"verify","lang":"en","domain":"example\.com","code":"ECONNREFUSED"/);
    assert.doesNotMatch(blob, /pat@example\.com|secret@person|token=/);
  });
});

describe('mails from the routes', () => {
  let server;
  let origin;

  const signup = (email, lang) =>
    fetch(`${origin}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(lang ? { Cookie: `wcag_lang=${lang}` } : {}) },
      body: JSON.stringify({ email, password: 'longenough-pass-1', firstName: 'Pat', lastName: 'Peeters', acceptTerms: true }),
    });

  it('starts the app', async () => {
    useFakeSmtp();
    server = http.createServer(createAccessibilityApp(repoRoot));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${server.address().port}`;
  });

  it('sends the verification mail in the language of the signup, with the usual link', async () => {
    smtp.sent = [];
    assert.equal((await signup('verify-en@example.com', 'en')).status, 200);
    assert.equal((await signup('verify-nl@example.com', 'nl')).status, 200);
    const en = smtp.sent.find((m) => m.to === 'verify-en@example.com');
    const nl = smtp.sent.find((m) => m.to === 'verify-nl@example.com');
    assert.equal(en.subject, 'Confirm your email address · Us accessibility');
    assert.equal(nl.subject, 'Bevestig uw e-mailadres · Us toegankelijkheid');
    assert.match(nl.text, /^Beste Pat,/);
    assert.match(en.text, /https:\/\/wcag\.example\/api\/auth\/verify\?token=[0-9a-f]{32}\n/);
  });

  it('still answers 200 when the verification mail fails', async () => {
    smtp.failing = true;
    const log = captureWarnings();
    let res;
    try {
      res = await signup('mail-down@example.com', 'nl');
    } finally {
      log.restore();
      smtp.failing = false;
    }
    const body = await res.json();
    assert.equal(res.status, 200, body.error || '');
    assert.equal(body.needsVerification, true);
    assert.ok(await getUserByEmail('mail-down@example.com'));
  });

  it('writes the reset mail in the account language, not the language of the page', async () => {
    smtp.sent = [];
    const res = await fetch(`${origin}/api/auth/forgot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: 'wcag_lang=nl' },
      body: JSON.stringify({ email: 'verify-en@example.com' }),
    });
    assert.equal(res.status, 200);
    const mail = await waitForMail((m) => m.to === 'verify-en@example.com');
    assert.ok(mail, 'reset mail sent');
    assert.equal(mail.subject, 'Reset your Us accessibility password');
    assert.match(mail.text, /https:\/\/wcag\.example\/reset\?token=[0-9a-f]{32}\n/);
  });

  it('tells the owner of an existing address in the account language', async () => {
    smtp.sent = [];
    const res = await signup('verify-en@example.com', 'nl');
    assert.equal(res.status, 200);
    const mail = await waitForMail((m) => m.to === 'verify-en@example.com');
    assert.ok(mail, 'signup-existing mail sent');
    assert.equal(mail.subject, 'You already have a Us accessibility account');
    assert.match(mail.text, /^Hello Pat,/);
    assert.match(mail.text, /Sign in: https:\/\/wcag\.example\/login/);
  });

  it('still answers 200 for an e-mail change when both mails fail', async () => {
    takeIssuedAuthToken('change-me@example.com');
    assert.equal((await signup('change-me@example.com', 'en')).status, 200);
    const token = takeIssuedAuthToken('change-me@example.com');
    const verify = await fetch(`${origin}/api/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    assert.equal(verify.status, 200);
    const cookies = new Map(
      verify.headers.getSetCookie().map((line) => line.split(';')[0].split('=')).map(([k, ...v]) => [k, v.join('=')])
    );
    const cookie = [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    smtp.failing = true;
    const log = captureWarnings();
    let res;
    try {
      res = await fetch(`${origin}/api/account/email`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', cookie, 'X-CSRF-Token': cookies.get('wcag_csrf') || '' },
        body: JSON.stringify({ email: 'changed@example.com', password: 'longenough-pass-1' }),
      });
    } finally {
      log.restore();
      smtp.failing = false;
    }
    const body = await res.json();
    assert.equal(res.status, 200, body.error || '');
    assert.equal(body.pendingEmail, 'changed@example.com');
    assert.equal(log.lines.filter((line) => line.includes('[email] failed')).length, 2);
  });

  it('sends the lead and its confirmation in the visitor language', async () => {
    smtp.sent = [];
    const res = await fetch(`${origin}/api/lead`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: 'wcag_lang=en' },
      body: JSON.stringify({ name: 'Ann', email: 'ann@example.com', message: 'Audit please', source: 'pricing' }),
    });
    const body = await res.json();
    assert.deepEqual(body, { ok: true, emailed: true, confirmationSent: true });
    const team = smtp.sent.find((m) => m.to === 'team@us.example');
    const visitor = smtp.sent.find((m) => m.to === 'ann@example.com');
    assert.equal(team.replyTo, 'ann@example.com');
    assert.match(team.subject, /^WCAG services lead/);
    assert.match(team.text, /Language: en/);
    assert.equal(visitor.replyTo, 'team@us.example');
    assert.equal(visitor.subject, 'We received your request · Us accessibility');
  });

  it('closes the test server', async () => {
    setSmtpTransportFactory(null);
    await new Promise((resolve) => server.close(resolve));
  });
});
