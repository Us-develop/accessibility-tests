import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const tmp = mkdtempSync(join(tmpdir(), 'wcag-retention-'));
process.env.REPORTS_BASE = tmp;
process.env.AUTH_ENABLED = 'true';
process.env.APP_USERNAME = 'root';
process.env.APP_PASSWORD = 'staff-secret-pass';
process.env.SESSION_SECRET = 'unit-test-session-secret-32chars!!';
process.env.WCAG_DISABLE_RATE_LIMIT = '1';
process.env.AUTH_EMAIL_VERIFY = 'auto';
process.env.DEFER_ROOT_LOGIN_TO_SHELL = 'true';
delete process.env.SMTP_HOST;

const { createAccessibilityApp } = await import('../server/create-app.mjs');
const { persistGuestToken, appendLeadFile, readLeadFileRows, hashGuestIp, turnstileSendIp } =
  await import('../server/guest.mjs');
const { csvEscape } = await import('../server/account-routes.mjs');
const { sendAccountEmail } = await import('../server-email.js');
const { runRetention } = await import('../server/retention.mjs');
const { setStripeClientForTests } = await import('../server/stripe.mjs');
const { upsertSubscription, getSubscription } = await import('../server/billing.mjs');
const { getUserByEmail } = await import('../server/users.mjs');
const { writeJob } = await import('../server/queue.mjs');
const { upsertProject } = await import('../server/projects.mjs');
const { readJsonStore } = await import('../server/json-store.mjs');

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

after(() => {
  setStripeClientForTests(null);
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

async function signup(origin, email, password = 'longenough1') {
  const jar = new CookieJar();
  const res = await fetch(`${origin}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, name: 'Pat', acceptTerms: true }),
  });
  jar.store(res.headers);
  const data = await res.json();
  return { jar, res, data };
}

describe('csv formula guard and guest IP hashing', () => {
  it('prefixes formula-like CSV cells', () => {
    assert.equal(csvEscape('=1+1'), "'=1+1");
    assert.equal(csvEscape('+cmd'), "'+cmd");
    assert.equal(csvEscape('-1'), "'-1");
    assert.equal(csvEscape('@SUM(A1)'), "'@SUM(A1)");
    assert.equal(csvEscape('ok'), 'ok');
  });

  it('stores a salted hash instead of the raw guest IP', () => {
    const token = 'dddddddddddddddddddddddddddddddd';
    persistGuestToken(token, {
      domain: 'hash.example',
      runId: '2026-01-01T00-00-00Z-hash12',
      url: 'https://hash.example/',
      ip: '203.0.113.9',
    });
    const rec = JSON.parse(readFileSync(join(tmp, '_guest-tokens', `${token}.json`), 'utf8'));
    assert.notEqual(rec.ip, '203.0.113.9');
    assert.equal(rec.ip, hashGuestIp('203.0.113.9'));
    assert.equal(turnstileSendIp(), false);
  });
});

describe('email logger hygiene', () => {
  it('never logs token= or the message body when SMTP is unset', async () => {
    const lines = [];
    const orig = console.warn;
    console.warn = (...args) => {
      lines.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    };
    try {
      await sendAccountEmail({
        kind: 'verify',
        to: 'person@example.com',
        subject: 'Verify',
        text: 'Confirm your email:\nhttp://localhost/api/auth/verify?token=super-secret-token\n',
      });
    } finally {
      console.warn = orig;
    }
    const blob = lines.join('\n');
    assert.doesNotMatch(blob, /token=/);
    assert.doesNotMatch(blob, /super-secret-token/);
    assert.doesNotMatch(blob, /person@example\.com/);
    assert.match(blob, /example.com/);
    assert.match(blob, /verify/);
  });
});

describe('retention job', () => {
  it('removes an aged guest token and lead and leaves fresh ones', async () => {
    const oldToken = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
    const freshToken = 'ffffffffffffffffffffffffffffffff';
    persistGuestToken(oldToken, {
      domain: 'old.example',
      runId: '2020-01-01T00-00-00Z-oldrun1',
      url: 'https://old.example/',
      createdAt: '2020-01-01T00:00:00.000Z',
      expiresAt: '2020-01-31T00:00:00.000Z',
    });
    mkdirSync(join(tmp, 'old.example', '2020-01-01T00-00-00Z-oldrun1'), { recursive: true });
    writeFileSync(join(tmp, 'old.example', '2020-01-01T00-00-00Z-oldrun1', 'note.txt'), 'gone', 'utf8');
    persistGuestToken(freshToken, {
      domain: 'fresh.example',
      runId: '2026-01-01T00-00-00Z-fresh1',
      url: 'https://fresh.example/',
    });
    appendLeadFile({
      id: 'lead-old',
      email: 'old-lead@example.com',
      name: 'Old',
      createdAt: '2020-02-01T00:00:00.000Z',
    });
    appendLeadFile({
      id: 'lead-fresh',
      email: 'fresh-lead@example.com',
      name: 'Fresh',
      createdAt: new Date().toISOString(),
    });
    writeJob({
      id: 'stale.example:stale-run',
      domain: 'stale.example',
      runId: 'stale-run',
      status: 'queued',
      createdAt: '2020-01-01T00:00:00.000Z',
    });

    const summary = await runRetention(new Date('2026-09-14T00:00:00.000Z'));
    assert.ok(summary.guestTokens >= 1);
    assert.ok(summary.leads >= 1);
    assert.equal(existsSync(join(tmp, '_guest-tokens', `${oldToken}.json`)), false);
    assert.equal(existsSync(join(tmp, '_guest-tokens', `${freshToken}.json`)), true);
    assert.equal(existsSync(join(tmp, 'old.example', '2020-01-01T00-00-00Z-oldrun1')), false);
    const leads = readLeadFileRows(20);
    assert.equal(leads.some((row) => row.id === 'lead-old'), false);
    assert.equal(leads.some((row) => row.id === 'lead-fresh'), true);
    assert.equal(existsSync(join(tmp, '_queue', 'stale.example:stale-run.json')), false);
  });

  it('does not delete a guest run that was attached to a customer', async () => {
    const token = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const runId = '2020-01-01T00-00-00Z-kept01';
    persistGuestToken(token, {
      domain: 'kept.example',
      runId,
      url: 'https://kept.example/',
      createdAt: '2020-01-01T00:00:00.000Z',
      expiresAt: '2020-01-31T00:00:00.000Z',
    });
    mkdirSync(join(tmp, 'kept.example', runId), { recursive: true });
    writeFileSync(join(tmp, 'kept.example', runId, 'accessibility-results.json'), '{}', 'utf8');
    await upsertProject({ userId: 'customer-kept', domain: 'kept.example', runId });
    await runRetention(new Date('2026-09-14T00:00:00.000Z'));
    assert.equal(existsSync(join(tmp, 'kept.example', runId)), true);
    assert.equal(existsSync(join(tmp, '_guest-tokens', `${token}.json`)), false);
  });
});

describe('account deletion, export, and email change', () => {
  /** @type {http.Server} */
  let server;
  /** @type {string} */
  let origin;
  const cancelled = [];
  const deletedCustomers = [];

  it('starts the app', async () => {
    setStripeClientForTests({
      subscriptions: {
        cancel: async (id) => {
          cancelled.push(id);
          return { id, status: 'canceled' };
        },
      },
      customers: {
        del: async (id) => {
          deletedCustomers.push(id);
          return { id, deleted: true };
        },
      },
    });
    const app = createAccessibilityApp(repoRoot);
    const started = await listen(app);
    server = started.server;
    origin = started.origin;
  });

  it('exports consents with the account payload', async () => {
    const { jar, res, data } = await signup(origin, 'export-me@example.com');
    assert.equal(res.status, 200, data.error || '');
    const exported = await fetch(`${origin}/api/account/export`, { headers: { cookie: jar.header() } });
    const payload = await exported.json();
    assert.equal(exported.status, 200);
    assert.ok(Array.isArray(payload.consents));
    const kinds = payload.consents.map((row) => row.kind).sort();
    assert.ok(kinds.includes('terms'));
    assert.ok(kinds.includes('privacy'));
    assert.ok(Array.isArray(payload.leads));
    assert.ok(Array.isArray(payload.guestBindings));
  });

  it('deletes an account after password confirmation and calls Stripe stubs', async () => {
    const { jar, res, data } = await signup(origin, 'delete-me@example.com');
    assert.equal(res.status, 200, data.error || '');
    const userId = data.user.id;
    const sub = await getSubscription(userId);
    await upsertSubscription({
      ...sub,
      stripeSubscriptionId: 'sub_delete_me',
      stripeCustomerId: 'cus_delete_me',
    });
    const runId = '2026-01-01T00-00-00Z-delrun1';
    persistGuestToken('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', {
      domain: 'delete.example',
      runId,
      url: 'https://delete.example/',
    });
    mkdirSync(join(tmp, 'delete.example', runId), { recursive: true });
    writeFileSync(join(tmp, 'delete.example', runId, 'accessibility-results.json'), '{}', 'utf8');
    const attach = await fetch(`${origin}/api/account/attach-guest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: jar.header(),
        'X-CSRF-Token': jar.get('wcag_csrf'),
      },
      body: JSON.stringify({ guestToken: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }),
    });
    assert.equal(attach.status, 200, await attach.text());
    appendLeadFile({
      id: 'lead-delete-me',
      email: 'delete-me@example.com',
      name: 'Delete',
      createdAt: new Date().toISOString(),
    });

    const missingPw = await fetch(`${origin}/api/account/delete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: jar.header(),
        'X-CSRF-Token': jar.get('wcag_csrf'),
      },
      body: JSON.stringify({}),
    });
    assert.equal(missingPw.status, 400);

    const logs = [];
    const orig = console.info;
    console.info = (...args) => {
      logs.push(args.map((a) => String(a)).join(' '));
    };
    const deleted = await fetch(`${origin}/api/account/delete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: jar.header(),
        'X-CSRF-Token': jar.get('wcag_csrf'),
      },
      body: JSON.stringify({ password: 'longenough1' }),
    });
    console.info = orig;
    const body = await deleted.json();
    assert.equal(deleted.status, 200, body.error || '');
    assert.equal(body.ok, true);
    assert.equal(await getUserByEmail('delete-me@example.com'), null);
    const leftover = readJsonStore('users.json', { users: [] });
    assert.equal(
      (Array.isArray(leftover.users) ? leftover.users : []).some((u) => u.email === 'delete-me@example.com'),
      false
    );
    assert.equal(existsSync(join(tmp, 'delete.example', runId)), false);
    assert.equal(readLeadFileRows(50).some((row) => row.id === 'lead-delete-me'), false);
    assert.deepEqual(cancelled, ['sub_delete_me']);
    assert.deepEqual(deletedCustomers, ['cus_delete_me']);
    const blob = logs.join('\n');
    assert.match(blob, new RegExp(userId));
    assert.doesNotMatch(blob, /delete-me@example\.com/);
  });

  it('keeps the local account when Stripe cancel fails', async () => {
    const { jar, res, data } = await signup(origin, 'stripe-fail@example.com');
    assert.equal(res.status, 200, data.error || '');
    const sub = await getSubscription(data.user.id);
    await upsertSubscription({
      ...sub,
      stripeSubscriptionId: 'sub_fail',
      stripeCustomerId: 'cus_fail',
    });
    setStripeClientForTests({
      subscriptions: {
        cancel: async () => {
          throw new Error('stripe down');
        },
      },
      customers: {
        del: async () => {
          throw new Error('stripe down');
        },
      },
    });
    try {
      const deleted = await fetch(`${origin}/api/account/delete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: jar.header(),
          'X-CSRF-Token': jar.get('wcag_csrf'),
        },
        body: JSON.stringify({ password: 'longenough1' }),
      });
      assert.equal(deleted.status, 409);
      assert.ok(await getUserByEmail('stripe-fail@example.com'));
    } finally {
      setStripeClientForTests({
        subscriptions: {
          cancel: async (id) => {
            cancelled.push(id);
            return { id, status: 'canceled' };
          },
        },
        customers: {
          del: async (id) => {
            deletedCustomers.push(id);
            return { id, deleted: true };
          },
        },
      });
    }
  });

  it('lets staff delete a lead by id', async () => {
    appendLeadFile({
      id: 'lead-staff-del',
      email: 'staff-lead@example.com',
      name: 'Staff',
      createdAt: new Date().toISOString(),
    });
    const jar = new CookieJar();
    const login = await fetch(`${origin}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'root', password: 'staff-secret-pass' }),
    });
    jar.store(login.headers);
    const del = await fetch(`${origin}/api/admin/leads/lead-staff-del`, {
      method: 'DELETE',
      headers: {
        cookie: jar.header(),
        'X-CSRF-Token': jar.get('wcag_csrf'),
      },
    });
    assert.equal(del.status, 200);
    assert.equal(readLeadFileRows(50).some((row) => row.id === 'lead-staff-del'), false);
  });

  it('changes email after password confirmation and verification', async () => {
    const { jar, res } = await signup(origin, 'old-mail@example.com');
    assert.equal(res.status, 200);
    const start = await fetch(`${origin}/api/account/email`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        cookie: jar.header(),
        'X-CSRF-Token': jar.get('wcag_csrf'),
      },
      body: JSON.stringify({ email: 'new-mail@example.com', password: 'longenough1' }),
    });
    const startBody = await start.json();
    assert.equal(start.status, 200, startBody.error || '');
    assert.equal(startBody.pendingEmail, 'new-mail@example.com');
    const stillOld = await getUserByEmail('old-mail@example.com');
    assert.equal(stillOld.email, 'old-mail@example.com');
    const token = stillOld.pendingEmailToken;
    assert.ok(token);
    const verify = await fetch(`${origin}/api/auth/verify?token=${encodeURIComponent(token)}`, {
      redirect: 'manual',
    });
    assert.equal(verify.status, 302);
    assert.equal(await getUserByEmail('old-mail@example.com'), null);
    const next = await getUserByEmail('new-mail@example.com');
    assert.equal(next.email, 'new-mail@example.com');
  });

  it('closes the test server', async () => {
    await new Promise((resolve) => server.close(resolve));
  });
});
