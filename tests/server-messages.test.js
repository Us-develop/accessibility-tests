import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const tmp = mkdtempSync(join(tmpdir(), 'wcag-server-messages-'));
process.env.REPORTS_BASE = tmp;
process.env.AUTH_ENABLED = 'true';
process.env.APP_USERNAME = 'root';
process.env.APP_PASSWORD = 'staff-secret-pass';
process.env.SESSION_SECRET = 'unit-test-session-secret-32chars!!';
process.env.WCAG_DISABLE_RATE_LIMIT = '1';
process.env.DEFER_ROOT_LOGIN_TO_SHELL = 'true';

const { translateServerMessage, requestLang } = await import('../server/server-messages.mjs');
const { DICTIONARY_PARTS, serverMessageLang } = await import('../i18n/index.mjs');
const { createAccessibilityApp } = await import('../server/create-app.mjs');

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
after(() => rmSync(tmp, { recursive: true, force: true }));

describe('server messages in the visitor’s language', () => {
  it('translates a known message and says which language it is in', () => {
    assert.deepEqual(translateServerMessage('Sign in first.', 'nl'), { text: 'Meld u eerst aan.', lang: 'nl' });
    assert.deepEqual(translateServerMessage('Sign in first.', 'en'), { text: 'Sign in first.', lang: 'en' });
  });

  it('fills in the values of a message with placeholders', () => {
    assert.deepEqual(
      translateServerMessage('A run for example.com is already in progress. Please wait for it to finish.', 'nl'),
      { text: 'Er loopt al een scan voor example.com. Wacht tot die klaar is.', lang: 'nl' }
    );
  });

  it('leaves an unknown message as it is, marked as English', () => {
    assert.deepEqual(translateServerMessage('Something new.', 'nl'), { text: 'Something new.', lang: 'en' });
    assert.equal(serverMessageLang({ error: 'x' }), 'en');
    assert.equal(serverMessageLang({ error: 'x', errorLang: 'nl' }), 'nl');
  });

  it('only translates for requests that carry the language cookie', () => {
    assert.equal(requestLang({ headers: { cookie: 'a=b; wcag_lang=nl' } }), 'nl');
    assert.equal(requestLang({ headers: { cookie: 'a=b' } }), null);
  });

  it('keeps every English message identical to the text in the server code', () => {
    // A message reworded in the code but not in i18n/server.en.mjs would silently stay English.
    const serverDir = join(repoRoot, 'server');
    const source = readdirSync(serverDir)
      .filter((file) => /\.(m?js)$/.test(file))
      .map((file) => readFileSync(join(serverDir, file), 'utf8'))
      .join('\n');
    for (const [key, text] of Object.entries(DICTIONARY_PARTS.en.server)) {
      const parts = text.split(/\{\w+\}/).filter((part) => part.length > 3);
      for (const part of parts) assert.ok(source.includes(part), `${key}: "${part}" is not in the server code`);
    }
  });
});

describe('JSON answers', () => {
  it('answer in Dutch with errorLang when the browser asks in Dutch, and stay English without the cookie', async () => {
    const app = createAccessibilityApp(repoRoot);
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    try {
      const nl = await fetch(`${origin}/api/account`, { headers: { cookie: 'wcag_lang=nl' } });
      assert.equal(nl.status, 401);
      const nlBody = await nl.json();
      assert.equal(nlBody.errorLang, 'nl');
      assert.notEqual(nlBody.error, 'Sign in first.');

      const plain = await fetch(`${origin}/api/account`);
      const plainBody = await plain.json();
      assert.equal(plainBody.errorLang, undefined);
      assert.match(plainBody.error, /^[A-Z][a-z]/);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

describe('pages', () => {
  it('mark a server message only when it is in another language than the page', () => {
    const read = (path) => readFileSync(join(repoRoot, path), 'utf8');
    for (const file of [
      'web/src/pages/index.astro',
      'web/src/pages/signup.astro',
      'web/src/pages/account.astro',
      'web/src/pages/reset.astro',
      'web/src/pages/audits.astro',
      'web/src/components/LoginModal.astro',
      'web/src/components/LoadingMonitor.svelte',
      'web/src/components/GuestLeadForm.svelte',
      'web/src/lib/checkout.js',
    ]) {
      assert.match(read(file), /serverMessageLang\(data\)/, file);
    }
    const middleware = read('web/src/middleware.js');
    assert.match(middleware, /langSetCookie\(locals\.lang/);
  });
});
