import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AUTO_COVERAGE, buildWcagCoverage, buildStaticNarrative } from '../wcag-coverage.js';
import { WCAG_22_AA_SC, WCAG_22_AA_COUNT } from '../wcag-sc-labels.js';
import { ALL_MANUAL_ITEMS } from '../manual-checklist.js';

describe('WCAG 2.2 A/AA catalogue', () => {
  it('has 56 Level A and AA success criteria', () => {
    assert.equal(WCAG_22_AA_COUNT, 56);
    assert.equal(WCAG_22_AA_SC.length, 56);
  });

  it('has auto-coverage metadata for every SC', () => {
    const missing = WCAG_22_AA_SC.filter((row) => !AUTO_COVERAGE[row.id]);
    assert.deepEqual(missing, []);
  });
});

describe('buildWcagCoverage', () => {
  const report = {
    urls: ['https://example.com/'],
    customResults: [
      { id: 'page-title-exists', status: 'pass', rule: 'Title exists', chapter: 'semantics' },
      { id: 'img-alt', status: 'fail', rule: 'Images need alt', chapter: 'images' },
    ],
    axeResults: {
      'https://example.com/': {
        violations: [{ id: 'color-contrast', help: 'Contrast', tags: ['wcag2aa', 'wcag143'] }],
        incomplete: [],
        passes: [],
      },
    },
  };

  it('splits automated vs not-automated without overlap', () => {
    const cov = buildWcagCoverage(report, []);
    assert.equal(cov.total, 56);
    assert.equal(cov.counts.autoAttempted + cov.counts.autoNotChecked, 56);
    const overlap = cov.buckets.autoAttempted.filter((id) => cov.buckets.autoNotChecked.includes(id));
    assert.deepEqual(overlap, []);
  });

  it('marks 3.3.8 as not automated and outside the checklist', () => {
    const row = buildWcagCoverage(report, []).criteria.find((c) => c.id === '3.3.8');
    assert.ok(row);
    assert.equal(row.auto, 'none');
    assert.equal(row.manualCanCover, false);
    assert.equal(row.needsProfessional, true);
  });

  it('lets the keyboard checklist cover 2.1.2 which automation does not test', () => {
    const row = buildWcagCoverage(report, []).criteria.find((c) => c.id === '2.1.2');
    assert.ok(row);
    assert.equal(row.auto, 'none');
    assert.equal(row.manualCanCover, true);
    assert.equal(row.manualChecked, false);
  });

  it('records automated fails on mapped SCs', () => {
    const cov = buildWcagCoverage(report, []);
    const img = cov.criteria.find((c) => c.id === '1.1.1');
    const contrast = cov.criteria.find((c) => c.id === '1.4.3');
    assert.equal(img?.thisRun, 'fail');
    assert.equal(contrast?.thisRun, 'fail');
  });
});

describe('static coverage narrative', () => {
  it('does not claim the site is fully compliant', () => {
    const cov = buildWcagCoverage({ urls: ['https://example.com/'], customResults: [], axeResults: {} }, []);
    const n = buildStaticNarrative(cov);
    const blob = Object.values(n).join(' ').toLowerCase();
    assert.equal(/\bis fully compliant\b/.test(blob), false);
    assert.equal(/\bwill be fully compliant\b/.test(blob), false);
    assert.equal(/partially conformant/.test(blob), false);
    assert.match(n.pathToConformance, /does not make the site fully compliant/i);
    assert.match(n.pathToConformance, /not sufficient/i);
    assert.match(n.disclaimer, /not an official/i);
    assert.match(n.disclaimer, /professional/i);
  });
});

describe('manual checklist SC mapping', () => {
  it('maps every manual item to at least one WCAG 2.2 A/AA criterion', () => {
    const ids = new Set(WCAG_22_AA_SC.map((r) => r.id));
    for (const item of ALL_MANUAL_ITEMS) {
      assert.ok(Array.isArray(item.coversSc) && item.coversSc.length > 0, item.id);
      for (const sc of item.coversSc) {
        assert.equal(ids.has(sc), true, `${item.id} → ${sc}`);
      }
    }
  });
});
