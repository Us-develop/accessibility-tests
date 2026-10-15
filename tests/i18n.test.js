import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const tmp = mkdtempSync(join(tmpdir(), 'wcag-i18n-'));
process.env.REPORTS_BASE = tmp;
process.env.AUTH_ENABLED = 'true';
process.env.APP_USERNAME = 'root';
process.env.APP_PASSWORD = 'staff-secret-pass';
process.env.SESSION_SECRET = 'unit-test-session-secret-32chars!!';
process.env.WCAG_DISABLE_RATE_LIMIT = '1';
process.env.DEFER_ROOT_LOGIN_TO_SHELL = 'true';
delete process.env.WCAG_DEFAULT_LANG;

const { dateLocale, defaultLang, dictionary, langFromCookieHeader, langSetCookie, normalizeLang, t, tn, translator } =
  await import('../i18n/index.mjs');
const { createAccessibilityApp } = await import('../server/create-app.mjs');

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(repoRoot, path), 'utf8');
after(() => rmSync(tmp, { recursive: true, force: true }));

const nl = dictionary('nl');
const en = dictionary('en');
const placeholders = (text) => (text.match(/\{\w+\}/g) || []).sort().join(',');

describe('dictionaries', () => {
  it('have exactly the same keys', () => {
    assert.deepEqual(Object.keys(nl).sort(), Object.keys(en).sort());
  });

  it('use the same placeholders for every key', () => {
    for (const key of Object.keys(en)) {
      assert.equal(placeholders(nl[key]), placeholders(en[key]), key);
    }
  });

  it('have no empty text', () => {
    for (const [key, text] of [...Object.entries(nl), ...Object.entries(en)]) {
      assert.ok(typeof text === 'string' && text.trim().length > 0, key);
    }
  });

  it('address the reader as "u" in Dutch, never "je" or "jij"', () => {
    for (const [key, text] of Object.entries(nl)) {
      assert.doesNotMatch(text, /\b(je|jij|jou|jouw)\b/i, `${key}: ${text}`);
    }
  });

  it('keep each key in one file only, so one part cannot silently override another', async () => {
    const { DICTIONARY_PARTS } = await import('../i18n/index.mjs');
    for (const lang of ['nl', 'en']) {
      const seen = new Map();
      for (const [part, entries] of Object.entries(DICTIONARY_PARTS[lang])) {
        for (const key of Object.keys(entries)) {
          assert.ok(!seen.has(key), `${lang}: ${key} is in both ${seen.get(key)} and ${part}`);
          seen.set(key, part);
        }
      }
      // Each part has the same keys in both languages.
      for (const part of Object.keys(DICTIONARY_PARTS.en)) {
        assert.deepEqual(Object.keys(DICTIONARY_PARTS.nl[part]).sort(), Object.keys(DICTIONARY_PARTS.en[part]).sort(), part);
      }
    }
  });

  it('give every plural key both forms', () => {
    for (const key of Object.keys(en)) {
      if (key.endsWith('.one')) assert.ok(`${key.slice(0, -4)}.other` in en, key);
      if (key.endsWith('.other')) assert.ok(`${key.slice(0, -6)}.one` in en, key);
    }
  });
});

describe('translating', () => {
  it('fills placeholders and picks plural forms', () => {
    assert.equal(t('en', 'pricing.tokens.buy', { n: 50 }), 'Buy 50');
    assert.equal(t('nl', 'pricing.tokens.buy', { n: 50 }), '50 kopen');
    assert.equal(tn('nl', 'balance.tokensLeft', 1), '1 token over');
    assert.equal(tn('nl', 'balance.tokensLeft', 3), '3 tokens over');
    assert.equal(translator('en').n('balance.proPages', 2), '2 Pro pages');
  });

  it('shows the key when a text is missing, so the gap is visible', () => {
    assert.equal(t('nl', 'no.such.key'), 'no.such.key');
  });

  it('defaults to Dutch and accepts only the two languages', () => {
    assert.equal(defaultLang(), 'nl');
    assert.equal(normalizeLang('EN'), 'en');
    assert.equal(normalizeLang('nl-BE'), 'nl');
    assert.equal(normalizeLang('fr'), null);
    assert.equal(langFromCookieHeader(''), 'nl');
    assert.equal(langFromCookieHeader('a=1; wcag_lang=en; b=2'), 'en');
    assert.equal(langFromCookieHeader('wcag_lang=xx'), 'nl');
    assert.equal(dateLocale('nl'), 'nl-BE');
    assert.equal(dateLocale('en'), 'en-GB');
  });

  it('can be switched to English by default with WCAG_DEFAULT_LANG', () => {
    process.env.WCAG_DEFAULT_LANG = 'en';
    try {
      assert.equal(defaultLang(), 'en');
      assert.equal(langFromCookieHeader(''), 'en');
    } finally {
      delete process.env.WCAG_DEFAULT_LANG;
    }
  });

  it('remembers the choice for a year', () => {
    assert.match(langSetCookie('en'), /^wcag_lang=en; Path=\/; Max-Age=31536000; SameSite=Lax$/);
    assert.match(langSetCookie('en', { secure: true }), /; Secure$/);
  });
});

describe('keys used in the pages', () => {
  const walk = (dir) =>
    readdirSync(join(repoRoot, dir), { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]
    );

  it('all exist in the dictionaries', () => {
    const used = new Set();
    for (const file of walk('web/src')) {
      const source = read(file);
      // tr('key'…), t(lang, 'key'…), msg('key'), tn(lang, 'key'…), tr.n('key'…)
      for (const m of source.matchAll(/\b(?:tr|msg)\('([a-zA-Z][\w.]*)'/g)) used.add(m[1]);
      for (const m of source.matchAll(/\bt\([\w().]+, '([a-zA-Z][\w.]*)'/g)) used.add(m[1]);
      for (const m of source.matchAll(/\b(?:tn|tr\.n)\((?:[\w().]+, )?'([a-zA-Z][\w.]*)'/g)) {
        used.add(`${m[1]}.one`);
        used.add(`${m[1]}.other`);
      }
    }
    assert.ok(used.size > 50, `found ${used.size} keys`);
    const missing = [...used].filter((key) => !(key in en) && !(`${key}.one` in en));
    assert.deepEqual(missing, []);
  });
});

describe('a page only claims a language it is written in', () => {
  it('sets the html language from the page, English unless the page is translated', () => {
    const layout = read('web/src/layouts/Layout.astro');
    assert.match(layout, /<html lang=\{tr\.lang\}/);
    assert.match(read('web/src/lib/page-lang.js'), /translator\(Astro\.locals\?\.pageLang \|\| 'en'\)/);
    for (const page of ['pricing', 'contact', 'signup', 'index', 'loading', 'account', 'forgot', 'reset', 'verify', 'report/[domain]/[runId]/index', 'teaser/[token]', 'report/[domain]/[runId]/coverage', 'report/[domain]/history', 'audits', 'limitations']) {
      assert.match(read(`web/src/pages/${page}.astro`), /const tr = usePageLang\(Astro\);/, page);
    }
    // Not translated yet: must not call usePageLang, so it stays lang="en".
    assert.doesNotMatch(read('web/src/pages/report/[domain]/[runId]/statement.astro'), /usePageLang/);
  });

  it('marks the parts that are still English inside a Dutch page', () => {
    // The sign-in pop-up follows the page: Dutch on translated pages, English on the others.
    assert.match(read('web/src/components/LoginModal.astro'), /const tr = chromeTranslator\(Astro\);/);
    assert.doesNotMatch(read('web/src/components/LoginModal.astro'), /pageLang !== 'en' \? 'en'/);
    assert.match(read('web/src/pages/pricing.astro'), /<span lang=\{tr\.lang === 'en' \? undefined : 'en'\}>\{WITHDRAWAL_WAIVER_TEXT\}<\/span>/);
    assert.match(read('web/src/lib/checkout.js'), /el\.setAttribute\('lang', textLang\)/);
  });
});

describe('language switch', () => {
  it('sets the cookie on a form post and goes back to the page, without needing a login', async () => {
    const app = createAccessibilityApp(repoRoot);
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const post = (fields) =>
      fetch(`${origin}/lang`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(fields).toString(),
        redirect: 'manual',
      });
    try {
      const res = await post({ lang: 'en', next: '/pricing?x=1' });
      assert.equal(res.status, 303);
      assert.equal(res.headers.get('location'), '/pricing?x=1');
      assert.match(res.headers.getSetCookie().join(';'), /wcag_lang=en/);

      const offsite = await post({ lang: 'nl', next: '/\\evil.com' });
      assert.equal(offsite.headers.get('location'), '/');

      const unknown = await post({ lang: 'fr', next: '/pricing' });
      assert.equal(unknown.status, 303);
      assert.equal(unknown.headers.getSetCookie().some((c) => c.startsWith('wcag_lang=')), false);

      // A GET must never change the language: links are prefetched on hover.
      const get = await fetch(`${origin}/lang/en?next=%2Fpricing`, { redirect: 'manual' });
      assert.equal(get.headers.getSetCookie().some((c) => c.startsWith('wcag_lang=')), false);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('is a small form in the header, each button in its own language', () => {
    const header = read('web/src/components/AppHeader.astro');
    assert.match(header, /<form class="wcag-lang-switch" method="post" action="\/lang"/);
    assert.match(header, /name="lang"\s+value=\{code\}\s+lang=\{code\}/);
    assert.match(header, /aria-pressed=\{Astro\.locals\?\.lang === code \? 'true' : 'false'\}/);
    assert.doesNotMatch(header, /href=\{`\/lang\//);
  });
});

describe('report pages from phase F', () => {
  it('explain the three-part score on the limitations page in both languages', () => {
    assert.match(t('en', 'lim.score.body'), /three parts: automated errors \(60%\), warnings to review \(15%\) and the manual checks \(25%\)/);
    assert.match(t('nl', 'lim.score.body'), /drie delen: automatische fouten \(60%\), na te kijken waarschuwingen \(15%\) en de handmatige controles \(25%\)/);
    assert.doesNotMatch(read('web/src/pages/limitations.astro'), /share of applicable automated checks/);
  });

  it('mark coverage content that is still English when the page is not', () => {
    const coverage = read('web/src/components/WcagCoverage.svelte');
    assert.match(coverage, /const contentLang = \$derived\(lang === 'en' \? undefined : 'en'\);/);
    assert.match(coverage, /<strong lang=\{contentLang\}>\{c\.title\}<\/strong>/);
    assert.match(coverage, /<p lang=\{contentLang\}>\{data\.narrative\.checked\}<\/p>/);
    // Manual checks it lists come from the translated checklist.
    assert.match(coverage, /known\(`manual\.item\.\$\{item\.id\}`, item\.text\)/);
  });
});

describe('sales report', () => {
  const deck = read('web/src/components/SalesDeck.svelte');
  const sales = read('web/src/pages/report/[domain]/[runId]/sales.astro');

  it('says what the trend did instead of always "trending up"', () => {
    assert.doesNotMatch(deck, /You're trending up/);
    assert.match(deck, /delta == null \? tr\('deck\.trend\.first'\) : delta > 0 \? tr\('deck\.trend\.up'\) : delta < 0 \? tr\('deck\.trend\.down'\) : tr\('deck\.trend\.flat'\)/);
    assert.doesNotMatch(t('en', 'deck.next.h'), /eight tickets/);
  });

  it('counts only the reviewed marks of this scan, like the report does', () => {
    assert.match(sales, /reviewDone: payload\.scoreModel\.reviewKeys\.filter\(\(key\) => reviewed\.has\(key\)\)\.length/);
  });

  it('follows the page language and marks fix titles from the scan', () => {
    assert.match(sales, /const tr = usePageLang\(Astro\);/);
    assert.match(sales, /lang: tr\.lang,/);
    assert.match(deck, /<div lang=\{findingsAttr\}>/);
  });
});
