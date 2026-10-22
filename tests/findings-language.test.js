import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(repoRoot, path), 'utf8');
const { getRemediation } = await import('../remediation-data.js');
const { buildAstroMainReportPayload } = await import('../report-astro-payload.js');

describe('findings in the language of the scan', () => {
  it('writes check texts in the scan language, English without one', () => {
    const script = "import('./tests/scan-text.js').then((m) => console.log(m.SCAN_LANG + '|' + m.say('chk.img-alt.missing', { n: 2 })))";
    const run = (env) => execFileSync(process.execPath, ['-e', script], { cwd: repoRoot, env: { ...process.env, ...env } }).toString().trim();
    assert.equal(run({ WCAG_SCAN_LANG: '' }), 'en|2 image(s) missing alt attribute');
    assert.equal(run({ WCAG_SCAN_LANG: 'nl' }), 'nl|2 afbeelding(en) zonder alt-attribuut');
  });

  it('leaves no check title or fixed message hard-coded in the checks', () => {
    for (const file of readdirSync(join(repoRoot, 'tests')).filter((f) => /^chapter\d.*\.js$/.test(f))) {
      const source = read(`tests/${file}`);
      assert.doesNotMatch(source, /\brule: ['`]/, file);
      assert.doesNotMatch(source, /\bmessage: ['`]/, file);
    }
  });

  it('records the scan language in the report and starts the scanner with it', () => {
    assert.match(read('run-tests.js'), /lang: SCAN_LANG,/);
    const app = read('server/create-app.mjs');
    assert.match(app, /const scanLang = requestLang\(req\) \|\| defaultLang\(\);/);
    // The run keeps it too (its notification mail uses it), and the scanner job gets it.
    assert.equal(app.match(/\n {6}lang: scanLang,\n/g)?.length, 2);
    assert.match(app, /WCAG_SCAN_LANG: normalizeLang\(job\.lang\)/);
  });

  it('shows fix guidance in the report language, keeping code untouched', () => {
    assert.equal(getRemediation('skip-link', null).snippet, '<a href="#main" class="skip-link">Skip to main content</a>');
    assert.equal(getRemediation('skip-link', null, 'nl').snippet, '<a href="#main" class="skip-link">Ga naar de hoofdinhoud</a>');
    // An axe rule that shares our check's guidance uses the same text.
    assert.equal(getRemediation(null, 'image-alt', 'nl').snippet, getRemediation('img-alt', null, 'nl').snippet);
    assert.match(getRemediation(null, 'color-contrast', 'nl').snippet, /^Verhoog het contrast/);
    assert.match(getRemediation(null, 'some-unknown-rule', 'nl').snippet, /^Bekijk het probleem/);
    assert.equal(getRemediation(null, 'some-unknown-rule', 'nl').impact, 'medium');
  });

  it('takes the findings language from the report, English for older reports', () => {
    const base = { urls: ['https://example.com/'], axeResults: {}, customResults: [], summary: {} };
    assert.equal(buildAstroMainReportPayload(base).findingsLang, 'en');
    assert.equal(buildAstroMainReportPayload({ ...base, lang: 'nl' }).findingsLang, 'nl');
    const withFinding = {
      ...base,
      lang: 'nl',
      customResults: [{ id: 'skip-link', rule: 'x', status: 'warn', url: 'https://example.com/', message: 'y' }],
    };
    const item = buildAstroMainReportPayload(withFinding).fixOrderItems[0];
    assert.equal(item.fixCode, '<a href="#main" class="skip-link">Ga naar de hoofdinhoud</a>');
  });
});

describe('one language per finding text', () => {
  it('marks our checks with the scan language and axe texts with the axe language', async () => {
    const report = {
      lang: 'nl',
      urls: ['https://example.com/'],
      summary: {},
      customResults: [{ id: 'skip-link', rule: 'Er is best een skiplink', status: 'warn', url: 'https://example.com/', message: 'Geen skiplink gevonden' }],
      axeResults: { 'https://example.com/': { violations: [{ id: 'image-alt', help: 'Images must have alternative text', nodes: [{}] }], passes: [], incomplete: [] } },
    };
    const payload = buildAstroMainReportPayload(report);
    const langOf = (type) => payload.fixOrderItems.find((item) => item.type === type).textLang;
    assert.equal(langOf('custom'), 'nl');
    assert.equal(langOf('violation'), 'en');
    assert.deepEqual(payload.rulesTable.map((r) => r.textLang).sort(), ['en', 'nl']);
    const { buildTeaserPayload } = await import('../server/teaser-payload.mjs');
    const teaser = buildTeaserPayload(report, { domain: 'example.com', url: 'https://example.com/' });
    assert.ok(teaser.topIssues.every((issue) => ['en', 'nl'].includes(issue.lang)));
  });
});

describe('documents generated from a Dutch scan', () => {
  it('are written in Dutch, with the English axe texts marked', async () => {
    const { mkdtempSync, readFileSync: readFile, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { generateDeveloperAdvice } = await import('../generate-deliverables.js');
    const dir = mkdtempSync(join(tmpdir(), 'wcag-doc-lang-'));
    try {
      const path = generateDeveloperAdvice(
        {
          reportData: { generatedAt: '2026-10-15T08:00:00Z', lang: 'nl', urls: ['https://example.com/'], customResults: [], axeResults: {} },
          fixOrderItems: [
            { type: 'custom', id: 'skip-link', rule: 'Er is best een skiplink', status: 'warn', textLang: 'nl', impact: 'high', effort: 'simple' },
            { type: 'violation', id: 'image-alt', rule: 'Images must have alternative text', status: 'violation', textLang: 'en', impact: 'high', effort: 'simple' },
          ],
          domain: 'example.com',
          runId: '2026-10-15T08-00-00Z-abcdef123456',
        },
        dir
      );
      const html = readFile(path, 'utf8');
      assert.match(html, /<html lang="nl">/);
      assert.match(html, /Dit lost u op, in deze volgorde\./);
      assert.doesNotMatch(html, /<span lang="nl">Er is best een skiplink<\/span>/);
      assert.match(html, /<span lang="en">Images must have alternative text<\/span>/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('accessibility statement files', () => {
  it('are written in Dutch and English, with the scan language under the plain name', async () => {
    const { mkdtempSync, readFileSync: readFile, rmSync, existsSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { generateAccessibilityStatement } = await import('../generate-deliverables.js');
    const dir = mkdtempSync(join(tmpdir(), 'wcag-statement-'));
    try {
      generateAccessibilityStatement(
        {
          reportData: { generatedAt: '2026-10-15T08:00:00Z', lang: 'nl', urls: ['https://example.com/'], customResults: [], axeResults: {} },
          fixOrderItems: [{ type: 'custom', id: 'img-alt', rule: 'Informatieve afbeeldingen moeten een tekstalternatief hebben', textLang: 'nl', wcag: ['1.1.1'], url: 'https://example.com/' }],
          statementMeta: { orgName: 'Us' },
        },
        dir
      );
      const nl = readFile(join(dir, 'accessibility-statement.nl.html'), 'utf8');
      const en = readFile(join(dir, 'accessibility-statement.en.html'), 'utf8');
      assert.match(nl, /<html lang="nl">/);
      assert.match(nl, /Toegankelijkheidsverklaring voor example\.com/);
      // Official Dutch WCAG title, and the finding in its own language.
      assert.match(nl, /1\.1\.1 Niet-tekstuele content – niveau A/);
      assert.match(en, /1\.1\.1 Non-text Content – Level A/);
      assert.match(en, /<span lang="nl">Informatieve afbeeldingen moeten een tekstalternatief hebben<\/span>/);
      assert.equal(readFile(join(dir, 'accessibility-statement.html'), 'utf8'), nl);
      assert.ok(existsSync(join(dir, 'accessibility-statement.en.html')));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
