import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const tmp = mkdtempSync(join(tmpdir(), 'wcag-jira-debug-'));
process.env.REPORTS_BASE = tmp;
process.env.AUTH_ENABLED = 'true';
process.env.APP_USERNAME = 'root';
process.env.APP_PASSWORD = 'staff-secret-pass';
process.env.SESSION_SECRET = 'unit-test-session-secret-32chars!!';
process.env.WCAG_DISABLE_RATE_LIMIT = '1';
process.env.AUTH_EMAIL_VERIFY = 'auto';
process.env.DEFER_ROOT_LOGIN_TO_SHELL = 'true';
delete process.env.DEBUG_ENDPOINTS;

const { createAccessibilityApp } = await import('../server/create-app.mjs');
const {
  consumeOauthState,
  encryptJiraOAuth,
  isJiraOAuthEnvelope,
  jiraOAuthFile,
  jiraOauthState,
  JIRA_OAUTH_STATE_MAX,
  newOauthState,
  pruneJiraOauthState,
  readJiraOAuth,
  writeJiraOAuth,
} = await import('../server/jira-oauth.mjs');
const { shouldSkipFtpUpload } = await import('../server/ftp.js');
const { debugEndpointsEnabled } = await import('../server/http-utils.mjs');

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

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

function headers(jar, extra = {}) {
  return {
    cookie: jar.header(),
    'X-CSRF-Token': jar.get('wcag_csrf'),
    ...extra,
  };
}

const STAFF_JIRA_ROUTES = [
  { method: 'GET', path: '/auth/jira/connect?domain=x' },
  { method: 'GET', path: '/api/jira/oauth/status?domain=x' },
  { method: 'GET', path: '/api/jira/projects?domain=x' },
  { method: 'POST', path: '/api/jira/sprint', body: { domain: 'x', projectKey: 'AB', tickets: [{ rule: 'img-alt' }] } },
  {
    method: 'GET',
    path: '/api/debug/deliverable/x/2026-05-04T13-45-12Z-aabbccddeeff/accessibility-client.html',
  },
];

describe('jira oauth file encryption', () => {
  const domain = 'jira-encrypt.example';
  const payload = {
    domain,
    cloudId: 'cloud-1',
    siteUrl: 'https://example.atlassian.net',
    accessToken: 'at-secret-value',
    refreshToken: 'rt-secret-value',
    expiresAt: Date.now() + 60_000,
  };

  it('round-trips tokens without writing plaintext to disk', () => {
    writeJiraOAuth(domain, payload);
    const file = jiraOAuthFile(domain);
    const raw = readFileSync(file, 'utf8');
    assert.equal(raw.includes('at-secret-value'), false);
    assert.equal(raw.includes('rt-secret-value'), false);
    const envelope = JSON.parse(raw);
    assert.equal(isJiraOAuthEnvelope(envelope), true);
    assert.deepEqual(readJiraOAuth(domain), payload);
  });

  it('migrates an existing plaintext file on first read', () => {
    const domainPlain = 'jira-plain.example';
    const dir = join(tmp, domainPlain);
    mkdirSync(dir, { recursive: true });
    const file = jiraOAuthFile(domainPlain);
    writeFileSync(file, JSON.stringify(payload, null, 2), 'utf8');
    const loaded = readJiraOAuth(domainPlain);
    assert.equal(loaded.accessToken, payload.accessToken);
    assert.equal(loaded.refreshToken, payload.refreshToken);
    const after = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(isJiraOAuthEnvelope(after), true);
    assert.equal(after.accessToken, undefined);
    assert.equal(readFileSync(file, 'utf8').includes('rt-secret-value'), false);
  });

  it('encryptJiraOAuth produces a decryptable envelope', () => {
    const envelope = encryptJiraOAuth({ hello: 'world' });
    assert.equal(isJiraOAuthEnvelope(envelope), true);
  });
});

describe('jira oauth state map', () => {
  it('prunes expired entries on newOauthState', () => {
    jiraOauthState.clear();
    jiraOauthState.set('expired', { domain: 'a.example', expiresAt: Date.now() - 1 });
    const state = newOauthState('b.example');
    assert.equal(jiraOauthState.has('expired'), false);
    assert.equal(jiraOauthState.has(state), true);
    jiraOauthState.clear();
  });

  it('caps the map at 100 entries', () => {
    const map = new Map();
    for (let i = 0; i < 120; i += 1) {
      map.set(`s${i}`, { domain: 'cap.example', expiresAt: Date.now() + 60_000 });
    }
    pruneJiraOauthState(map);
    assert.equal(map.size, JIRA_OAUTH_STATE_MAX - 1);
    assert.equal(map.has('s0'), false);
    assert.equal(map.has('s20'), false);
    assert.equal(map.has('s21'), true);

    jiraOauthState.clear();
    for (let i = 0; i < 130; i += 1) {
      newOauthState('cap.example');
    }
    assert.equal(jiraOauthState.size, JIRA_OAUTH_STATE_MAX);
    jiraOauthState.clear();
  });

  it('consumes a live state once', () => {
    jiraOauthState.clear();
    const state = newOauthState('c.example');
    const row = consumeOauthState(state);
    assert.equal(row.domain, 'c.example');
    assert.equal(consumeOauthState(state), null);
    jiraOauthState.clear();
  });
});

describe('ftp jira-oauth skip', () => {
  it('refuses to upload jira-oauth.json by local or remote name', () => {
    assert.equal(shouldSkipFtpUpload('/tmp/reports/x/jira-oauth.json', 'x/jira-oauth.json'), true);
    assert.equal(shouldSkipFtpUpload('/tmp/other.json', 'x/jira-oauth.json'), true);
    assert.equal(shouldSkipFtpUpload('/tmp/reports/x/manual-progress.json', 'x/run/manual-progress.json'), false);
  });
});

describe('debug endpoints env', () => {
  it('defaults off', () => {
    const prev = process.env.DEBUG_ENDPOINTS;
    delete process.env.DEBUG_ENDPOINTS;
    try {
      assert.equal(debugEndpointsEnabled(), false);
    } finally {
      if (prev === undefined) delete process.env.DEBUG_ENDPOINTS;
      else process.env.DEBUG_ENDPOINTS = prev;
    }
  });
});

describe('staff-only jira and debug HTTP', () => {
  /** @type {http.Server} */
  let server;
  /** @type {string} */
  let origin;
  /** @type {CookieJar} */
  let customerJar;

  it('starts the app', async () => {
    const app = createAccessibilityApp(repoRoot);
    const started = await listen(app);
    server = started.server;
    origin = started.origin;
  });

  it('signs up a customer', async () => {
    customerJar = new CookieJar();
    const res = await fetch(`${origin}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'jira-customer@example.com',
        password: 'longenough1',
        name: 'Jira Customer',
        acceptTerms: true,
      }),
    });
    customerJar.store(res.headers);
    const data = await res.json();
    assert.equal(res.status, 200, data.error || 'signup failed');
  });

  it('returns 403 JSON for a customer on all five staff jira/debug routes', async () => {
    for (const route of STAFF_JIRA_ROUTES) {
      const res = await fetch(`${origin}${route.path}`, {
        method: route.method,
        headers: {
          ...headers(customerJar),
          ...(route.body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: route.body ? JSON.stringify(route.body) : undefined,
        redirect: 'manual',
      });
      const body = await res.json();
      assert.equal(res.status, 403, `${route.method} ${route.path} status`);
      assert.equal(body.error, 'Staff only.', `${route.method} ${route.path} body`);
    }
  });

  it('sends unauthenticated GET /auth/jira/connect to login (401 or 302)', async () => {
    const res = await fetch(`${origin}/auth/jira/connect?domain=x`, { redirect: 'manual' });
    assert.ok(res.status === 401 || res.status === 302, `expected 401 or 302, got ${res.status}`);
    if (res.status === 302) {
      const loc = res.headers.get('location') || '';
      assert.match(loc, /\/auth\/login/);
    }
  });

  it('returns 404 for staff debug routes when DEBUG_ENDPOINTS is off', async () => {
    const jar = new CookieJar();
    const login = await fetch(`${origin}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'root', password: 'staff-secret-pass' }),
    });
    jar.store(login.headers);
    assert.equal(login.status, 200);
    const res = await fetch(
      `${origin}/api/debug/deliverable/x/2026-05-04T13-45-12Z-aabbccddeeff/accessibility-client.html`,
      { headers: headers(jar) }
    );
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error, 'Not found');
  });

  it('closes the test server', async () => {
    await new Promise((resolve) => server.close(resolve));
  });
});
