import { after, afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const tmp = mkdtempSync(join(tmpdir(), 'wcag-email-'));
process.env.REPORTS_BASE = tmp;
process.env.AUTH_ENABLED = 'true';
process.env.APP_USERNAME = 'root';
process.env.APP_PASSWORD = 'staff-secret-pass';
process.env.SESSION_SECRET = 'unit-test-session-secret-32chars!!';
process.env.AUTH_EMAIL_VERIFY = 'required';
process.env.DEFER_ROOT_LOGIN_TO_SHELL = 'true';
delete process.env.WCAG_DISABLE_RATE_LIMIT;
delete process.env.BREVO_API_KEY;
delete process.env.MAIL_FROM;
delete process.env.SMTP_HOST;

const {
  resolveMailTransport,
  sendViaBrevo,
  sendAccountEmail,
  sendRunNotificationEmail,
  sendLeadEmail,
  sendAccessRequestEmail,
  setSmtpTransportFactory,
} = await import('../server-email.js');
const { createAccessibilityApp } = await import('../server/create-app.mjs');
const { getUserByEmail } = await import('../server/users.mjs');
const { setUrlGuardLookup } = await import('../server/url-guard.mjs');

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const originalFetch = globalThis.fetch;

after(() => {
  globalThis.fetch = originalFetch;
  setSmtpTransportFactory(null);
  setUrlGuardLookup(null);
  rmSync(tmp, { recursive: true, force: true });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  setSmtpTransportFactory(null);
});

function listen(app) {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({ server, origin: `http://127.0.0.1:${addr.port}` });
    });
  });
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function withEnv(patch, fn) {
  const prev = {};
  for (const key of Object.keys(patch)) {
    prev[key] = Object.prototype.hasOwnProperty.call(process.env, key) ? process.env[key] : undefined;
    if (patch[key] === undefined) delete process.env[key];
    else process.env[key] = patch[key];
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const key of Object.keys(prev)) {
        if (prev[key] === undefined) delete process.env[key];
        else process.env[key] = prev[key];
      }
    });
}

function captureBrevo() {
  /** @type {{ url: string; headers: Headers; body: object }[]} */
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    if (String(url) !== 'https://api.brevo.com/v3/smtp/email') {
      return originalFetch(url, init);
    }
    const body = init.body ? JSON.parse(String(init.body)) : {};
    calls.push({ url: String(url), headers: init.headers || {}, body });
    return jsonResponse(201, { messageId: 'brevo-msg-1' });
  };
  return calls;
}

const TEMPLATE_ENV = {
  verify: 'BREVO_TEMPLATE_VERIFY',
  reset: 'BREVO_TEMPLATE_RESET',
  'email-change': 'BREVO_TEMPLATE_EMAIL_CHANGE',
  'email-change-notice': 'BREVO_TEMPLATE_EMAIL_CHANGE_NOTICE',
  'run-notification': 'BREVO_TEMPLATE_RUN_DONE',
  lead: 'BREVO_TEMPLATE_LEAD',
  'access-request': 'BREVO_TEMPLATE_ACCESS_REQUEST',
};

function brevoEnv(kind, extra = {}) {
  return {
    BREVO_API_KEY: 'secret-brevo-key-xyz',
    [TEMPLATE_ENV[kind]]: '12',
    MAIL_FROM: undefined,
    SMTP_HOST: undefined,
    ...extra,
  };
}

describe('Brevo transport', () => {
  it('uses Brevo when the key and template id are set, with exact params for each kind', async () => {
    const cases = [
      {
        kind: 'verify',
        send: () =>
          sendAccountEmail({
            kind: 'verify',
            to: 'pat@example.com',
            toName: 'Pat',
            params: {
              name: 'Pat',
              email: 'pat@example.com',
              link: 'https://wcag.example/verify',
              expiresIn: '48 hours',
              customerType: 'consumer',
            },
          }),
        params: {
          name: 'Pat',
          email: 'pat@example.com',
          link: 'https://wcag.example/verify',
          expiresIn: '48 hours',
          customerType: 'consumer',
        },
      },
      {
        kind: 'reset',
        send: () =>
          sendAccountEmail({
            kind: 'reset',
            to: 'pat@example.com',
            toName: 'Pat',
            params: { name: 'Pat', link: 'https://wcag.example/reset', expiresIn: '2 hours' },
          }),
        params: { name: 'Pat', link: 'https://wcag.example/reset', expiresIn: '2 hours' },
      },
      {
        kind: 'email-change',
        send: () =>
          sendAccountEmail({
            kind: 'email-change',
            to: 'new@example.com',
            toName: 'Pat',
            params: {
              name: 'Pat',
              newEmail: 'new@example.com',
              link: 'https://wcag.example/change',
              expiresIn: '48 hours',
            },
          }),
        params: {
          name: 'Pat',
          newEmail: 'new@example.com',
          link: 'https://wcag.example/change',
          expiresIn: '48 hours',
        },
      },
      {
        kind: 'email-change-notice',
        send: () =>
          sendAccountEmail({
            kind: 'email-change-notice',
            to: 'old@example.com',
            toName: 'Pat',
            params: { name: 'Pat', newEmail: 'new@example.com' },
          }),
        params: { name: 'Pat', newEmail: 'new@example.com' },
      },
      {
        kind: 'run-notification',
        send: () =>
          sendRunNotificationEmail({
            to: 'pat@example.com',
            domain: 'example.com',
            runId: 'run-1',
            reportUrl: 'https://wcag.example/report/example.com/run-1/',
            status: 'done',
            score: 88,
            pagesScanned: 3,
            issueCount: 12,
            error: '',
          }),
        params: {
          domain: 'example.com',
          runId: 'run-1',
          reportUrl: 'https://wcag.example/report/example.com/run-1/',
          status: 'done',
          score: 88,
          pagesScanned: 3,
          issueCount: 12,
          error: '',
        },
      },
      {
        kind: 'lead',
        send: () =>
          sendLeadEmail({
            name: 'Pat',
            company: 'Us',
            email: 'pat@example.com',
            phone: '123',
            message: 'Hello',
            scannedUrl: 'https://example.com',
            domain: 'example.com',
            score: '72',
            teaserUrl: 'https://wcag.example/teaser/abc',
          }),
        params: {
          name: 'Pat',
          company: 'Us',
          email: 'pat@example.com',
          phone: '123',
          message: 'Hello',
          scannedUrl: 'https://example.com',
          domain: 'example.com',
          score: '72',
          teaserUrl: 'https://wcag.example/teaser/abc',
        },
      },
      {
        kind: 'access-request',
        send: () =>
          sendAccessRequestEmail({
            name: 'Pat',
            company: 'Us',
            email: 'pat@example.com',
            message: 'Please',
          }),
        params: { name: 'Pat', company: 'Us', email: 'pat@example.com', message: 'Please' },
      },
    ];

    for (const item of cases) {
      await withEnv(brevoEnv(item.kind, { ACCESS_REQUEST_TO: 'inbox@example.com' }), async () => {
        const calls = captureBrevo();
        const result = await item.send();
        assert.equal(result.emailed, true, item.kind);
        assert.equal(calls.length, 1, item.kind);
        assert.equal(calls[0].url, 'https://api.brevo.com/v3/smtp/email');
        assert.equal(calls[0].headers['api-key'], 'secret-brevo-key-xyz');
        assert.equal(calls[0].headers.accept, 'application/json');
        assert.equal(calls[0].headers['content-type'], 'application/json');
        assert.deepEqual(calls[0].body.params, item.params);
        assert.equal(calls[0].body.templateId, 12);
        assert.deepEqual(calls[0].body.tags, [item.kind]);
        assert.ok(calls[0].body.headers['X-Mailin-custom']);
        assert.equal(calls[0].body.sender, undefined);
        assert.equal(calls[0].body.tracking, undefined);
        assert.doesNotMatch(JSON.stringify(calls[0].body), /openTracking|clickTracking/);
      });
    }
  });

  it('falls back to SMTP when the template id is missing', async () => {
    const smtpMails = [];
    setSmtpTransportFactory(() => ({
      sendMail: async (mail) => {
        smtpMails.push(mail);
        return { messageId: 'smtp-1' };
      },
    }));
    await withEnv(
      {
        BREVO_API_KEY: 'secret-brevo-key-xyz',
        BREVO_TEMPLATE_VERIFY: undefined,
        SMTP_HOST: 'smtp.example.com',
        MAIL_FROM: 'noreply@example.com',
      },
      async () => {
        assert.equal(resolveMailTransport('verify').type, 'smtp');
        const calls = captureBrevo();
        const result = await sendAccountEmail({
          kind: 'verify',
          to: 'pat@example.com',
          params: {
            name: 'Pat',
            email: 'pat@example.com',
            link: 'https://example.com/v',
            expiresIn: '48 hours',
            customerType: 'consumer',
          },
        });
        assert.equal(result.emailed, true);
        assert.equal(calls.length, 0);
        assert.equal(smtpMails.length, 1);
        assert.match(smtpMails[0].text, /https:\/\/example.com\/v/);
        assert.match(smtpMails[0].text, /48 hours/);
      }
    );
  });

  it('throws EBREVO on 4xx without including the API key', async () => {
    await withEnv(brevoEnv('verify'), async () => {
      globalThis.fetch = async (url, init) => {
        if (String(url) === 'https://api.brevo.com/v3/smtp/email') {
          return jsonResponse(401, { message: `invalid api-key secret-brevo-key-xyz` });
        }
        return originalFetch(url, init);
      };
      await assert.rejects(
        () =>
          sendViaBrevo({
            to: 'pat@example.com',
            templateId: 12,
            params: { name: 'Pat' },
            tags: ['verify'],
          }),
        (err) => {
          assert.equal(err.code, 'EBREVO');
          assert.doesNotMatch(String(err.message), /secret-brevo-key-xyz/);
          assert.doesNotMatch(String(err.stack || ''), /secret-brevo-key-xyz/);
          return true;
        }
      );
    });
  });

  it('does not send sender when MAIL_FROM is unset', async () => {
    await withEnv(brevoEnv('verify'), async () => {
      const calls = captureBrevo();
      await sendViaBrevo({
        to: 'pat@example.com',
        toName: 'Pat',
        templateId: 12,
        params: { name: 'Pat' },
        tags: ['verify'],
      });
      assert.equal(Object.prototype.hasOwnProperty.call(calls[0].body, 'sender'), false);
    });
  });
});

describe('signup and resend-verification HTTP', () => {
  /** @type {http.Server} */
  let server;
  /** @type {string} */
  let origin;

  it('starts the app', async () => {
    const app = createAccessibilityApp(repoRoot, {
      lookup: async () => [{ address: '1.1.1.1', family: 4 }],
    });
    const started = await listen(app);
    server = started.server;
    origin = started.origin;
  });

  it('returns 200 with mailSent false when send throws and keeps the user unverified', async () => {
    await withEnv(brevoEnv('verify'), async () => {
      globalThis.fetch = async (url, init) => {
        if (String(url) === 'https://api.brevo.com/v3/smtp/email') {
          return jsonResponse(500, { message: 'template missing' });
        }
        return originalFetch(url, init);
      };
      const res = await fetch(`${origin}/api/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'mail-fail@example.com',
          password: 'longenough1',
          name: 'Pat',
          acceptTerms: true,
        }),
      });
      const body = await res.json();
      assert.equal(res.status, 200, body.error || '');
      assert.equal(body.needsVerification, true);
      assert.equal(body.mailSent, false);
      const user = await getUserByEmail('mail-fail@example.com');
      assert.ok(user);
      assert.equal(user.emailVerified, false);
      assert.ok(user.verifyToken);
    });
  });

  it('returns 200 for unknown emails and rate-limits resend-verification', async () => {
    const unknown = 'nobody-resend@example.com';
    for (let i = 0; i < 3; i += 1) {
      const res = await fetch(`${origin}/api/auth/resend-verification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: unknown }),
      });
      assert.equal(res.status, 200, `attempt ${i + 1}`);
      const body = await res.json();
      assert.equal(body.ok, true);
    }
    const limited = await fetch(`${origin}/api/auth/resend-verification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: unknown }),
    });
    assert.equal(limited.status, 429);
    const other = await fetch(`${origin}/api/auth/resend-verification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'also-unknown@example.com' }),
    });
    assert.equal(other.status, 200);
  });

  it('tells the check-email page to use Resend verification', () => {
    const signup = readFileSync(join(repoRoot, 'web/src/pages/signup.astro'), 'utf8');
    assert.match(signup, /If the mail does not arrive within a few minutes, use/);
    assert.match(signup, /<em>Resend verification<\/em>/);
    assert.match(signup, /action="\/api\/auth\/resend-verification"/);
  });

  it('closes the test server', async () => {
    await new Promise((resolve) => server.close(resolve));
  });
});
