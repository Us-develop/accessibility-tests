import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPublishedBenchmarks, COMMON_FAILURES, WEBAIM_MILLION } from '../benchmarks.js';
import { generateReport } from '../generate-report.js';

const tmp = mkdtempSync(join(tmpdir(), 'wcag-benchmarks-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

const urls = ['https://example.com/', 'https://example.com/contact'];
const report = {
  generatedAt: '2026-10-13T10:00:00.000Z',
  urls,
  axeResults: {
    [urls[0]]: {
      url: urls[0],
      violations: [{ id: 'color-contrast', impact: 'serious', help: 'Contrast', tags: ['wcag143'], nodes: [{ html: '<p>', target: ['p'] }] }],
      incomplete: [{ id: 'link-name', nodes: [] }],
      passes: [],
    },
    [urls[1]]: { url: urls[1], violations: [], incomplete: [], passes: [] },
    // A failed load is not a scanned page and must not count.
    'https://example.com/broken': { url: 'https://example.com/broken', violations: [{ id: 'image-alt', nodes: [] }] },
  },
  customResults: [
    { id: 'form-labels', status: 'fail', rule: 'Labels', message: '1 input', chapter: 'forms', url: urls[1] },
    { id: 'img-alt', status: 'pass', rule: 'Alt', message: 'ok', chapter: 'images', url: urls[0] },
    { id: 'link-text', status: 'warn', rule: 'Links', message: 'generic', chapter: 'semantics', url: urls[0] },
  ],
  summary: { pass: 1, fail: 1, warn: 1, info: 0 },
  screenshots: {},
};

describe('published benchmarks', () => {
  it('carries the source details needed to cite the figures', () => {
    assert.equal(WEBAIM_MILLION.url, 'https://webaim.org/projects/million/');
    assert.match(WEBAIM_MILLION.edition, /\d{4}/);
    assert.equal(COMMON_FAILURES.length, 6);
    for (const type of COMMON_FAILURES) {
      assert.ok(type.pct > 0 && type.pct < 100, type.label);
      assert.ok(type.axe.length + type.custom.length > 0, type.label);
    }
  });

  it('marks a failure type as found only for fails and violations on scanned pages', () => {
    const { rows, pagesScanned } = buildPublishedBenchmarks(report);
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
    assert.equal(pagesScanned, 2);
    assert.deepEqual([byKey['low-contrast'].found, byKey['low-contrast'].pagesAffected], [true, 1]);
    assert.deepEqual([byKey['missing-labels'].found, byKey['missing-labels'].pagesAffected], [true, 1]);
    // pass, warn, "incomplete" and a page that did not load do not count
    assert.equal(byKey['missing-alt'].found, false);
    assert.equal(byKey['empty-links'].found, false);
    assert.equal(byKey['empty-buttons'].found, false);
  });

  it('handles a run with no loaded pages', () => {
    const { rows, pagesScanned } = buildPublishedBenchmarks({ urls: [], axeResults: {}, customResults: [] });
    assert.equal(pagesScanned, 0);
    assert.equal(rows.every((r) => !r.found), true);
  });
});

describe('static report benchmark section', () => {
  const dir = join(tmp, 'run');
  generateReport(report, { outputDir: dir });
  const html = readFileSync(join(dir, 'accessibility-report.html'), 'utf8');

  it('shows the published figures with source, edition and an indicative-only note', () => {
    assert.match(html, /How common are these problems\? \(indicative\)/);
    assert.match(html, /href="https:\/\/webaim\.org\/projects\/million\/"/);
    assert.match(html, new RegExp(WEBAIM_MILLION.edition));
    assert.match(html, /For indication only/);
    assert.match(html, /83\.9%/);
    assert.match(html, /Yes, on 1 of 2 pages/);
    assert.match(html, /Not detected/);
  });

  it('sources the disability figure in the business impact section from Eurostat', () => {
    assert.match(html, /82\.3% of people with a severe disability and 89\.0% of people with a moderate disability used the internet in 2024/);
    assert.match(html, /href="https:\/\/ec\.europa\.eu\/eurostat\/web\/products-eurostat-news\/w\/ddn-20250827-1"/);
    assert.doesNotMatch(html, /15% of users/);
  });

  it('no longer shows invented averages, percentiles or projected scores', () => {
    for (const gone of [
      /industry avg/i,
      /Percentile thresholds/,
      /where you sit/,
      /Projected percentile/,
      /Estimated score after fixes/,
      /Top 10%/,
      /Bottom 25%/,
      /Median 71/,
    ]) {
      assert.doesNotMatch(html, gone);
    }
  });
});
