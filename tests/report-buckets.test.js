import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  wcagFromAxeTags,
  principleFromWcag,
  scoreFromReport,
  buildPrinciples,
  buildDisabilities,
  buildPlainEnglishStats,
  groupFixesByPrinciple,
} from '../report-buckets.js';

describe('wcagFromAxeTags', () => {
  it('parses 1.1.1, 1.4.3 and 2.4.11 tags', () => {
    assert.deepEqual(wcagFromAxeTags(['wcag111', 'wcag143', 'wcag2411', 'wcag22aa']), [
      '1.1.1',
      '1.4.3',
      '2.4.11',
    ]);
  });
});

describe('principleFromWcag', () => {
  it('maps SC first digit to POUR', () => {
    assert.equal(principleFromWcag(['1.4.3']), 'perceivable');
    assert.equal(principleFromWcag(['2.1.1']), 'operable');
    assert.equal(principleFromWcag(['3.3.2']), 'understandable');
    assert.equal(principleFromWcag(['4.1.2']), 'robust');
  });
});

const sampleReport = {
  urls: ['https://example.com/', 'https://example.com/about'],
  customResults: [
    { id: 'img-alt', status: 'fail', chapter: 'images', url: 'https://example.com/' },
    { id: 'html-lang', status: 'pass', chapter: 'semantics', url: 'https://example.com/' },
    { id: 'no-auto-refresh', status: 'pass', chapter: 'dynamicUpdates', url: 'https://example.com/' },
    { id: 'form-labels', status: 'warn', chapter: 'forms', url: 'https://example.com/about' },
  ],
  axeResults: {
    'https://example.com/': {
      violations: [{ id: 'color-contrast', tags: ['wcag143'], help: 'Contrast' }],
      incomplete: [{ id: 'link-in-text-block' }],
      passes: [],
    },
    'https://example.com/about': {
      violations: [],
      incomplete: [],
      passes: [],
    },
  },
};

describe('scoreFromReport', () => {
  it('does not count vacuous passes and does not treat incomplete as pass', () => {
    const score = scoreFromReport(sampleReport);
    // pass: html-lang (1); fail: img-alt (1); warn: form-labels (1); axe viol: 1 → 1/4 = 25
    assert.equal(score, 25);
  });

  it('returns null when nothing scored', () => {
    assert.equal(scoreFromReport({ urls: [], customResults: [], axeResults: {} }), null);
  });
});

describe('buildPrinciples', () => {
  it('puts contrast in perceivable and forms in understandable', () => {
    const principles = buildPrinciples(sampleReport);
    const byKey = Object.fromEntries(principles.map((p) => [p.key, p]));
    assert.equal(byKey.perceivable.errors, 2); // img-alt + color-contrast
    assert.equal(byKey.understandable.warnings, 1);
    assert.equal(byKey.understandable.passed, 1); // html-lang → 3.1.1
    assert.equal(principles.every((p) => p.errors + p.warnings + p.passed >= 0), true);
    const totalErrors = principles.reduce((s, p) => s + p.errors, 0);
    assert.equal(totalErrors, 2);
  });
});

describe('buildDisabilities', () => {
  it('uses percent of pages, not a fake 100% on the worst bucket', () => {
    const disabilities = buildDisabilities(sampleReport);
    const contrast = disabilities.find((d) => d.key === 'lowvision');
    assert.ok(contrast);
    assert.equal(contrast.percent, 50);
    assert.equal(contrast.impact, 'Many pages');
  });
});

describe('buildPlainEnglishStats', () => {
  it('counts pages with errors from this run', () => {
    const stats = buildPlainEnglishStats(sampleReport);
    assert.equal(stats.errorPages, 1);
    assert.equal(stats.pageCount, 2);
    assert.match(stats.headline, /1 of 2/);
  });
});

describe('groupFixesByPrinciple', () => {
  it('does not use a 40/30/18/12 split', () => {
    const groups = groupFixesByPrinciple([
      { wcag: ['1.4.3'], rule: 'Contrast' },
      { wcag: ['1.1.1'], rule: 'Alt' },
      { wcag: ['3.3.2'], rule: 'Label' },
    ]);
    const perc = groups.find((g) => g.key === 'perceivable');
    const und = groups.find((g) => g.key === 'understandable');
    assert.equal(perc.issues.length, 2);
    assert.equal(und.issues.length, 1);
  });
});
