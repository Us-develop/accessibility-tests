import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CRITICAL_CAP, overallScore, partScore } from '../score-model.js';
import {
  axeRuleSeverity,
  customRuleSeverity,
  errorsBreakdown,
  reviewItems,
  ruleGains,
  scoreParts,
} from '../scoring.js';

const home = 'https://example.com/';
const about = 'https://example.com/about';

/** Two pages. Home fails three rules, one of them critical; about is clean. */
const report = {
  urls: [home, about],
  customResults: [
    { id: 'img-alt', status: 'fail', url: home },
    { id: 'html-lang', status: 'pass', url: home },
    { id: 'skip-link', status: 'warn', url: home, rule: 'Skip link', message: 'No skip link detected' },
    { id: 'no-auto-refresh', status: 'pass', url: about },
    { id: 'contrast-not-run', status: 'info', url: about },
    { id: 'page-load', status: 'fail', url: 'https://example.com/broken' },
  ],
  axeResults: {
    [home]: {
      violations: [{ id: 'color-contrast', nodes: [{}, {}, {}] }, { id: 'label' }],
      passes: [{ id: 'document-title' }, { id: 'html-has-lang' }],
    },
    [about]: { violations: [], passes: [{ id: 'document-title' }, { id: 'region' }] },
  },
};

describe('score model', () => {
  it('weights the three parts 60 / 15 / 25', () => {
    const r = overallScore({ errors: 90, reviewDone: 0, reviewTotal: 4, manualDone: 5, manualTotal: 10 });
    assert.deepEqual(r, { overall: 67, errors: 90, review: 0, manual: 50, capped: false });
  });

  it('is 100 only when all three parts are 100', () => {
    assert.equal(overallScore({ errors: 100, manualDone: 23, manualTotal: 23 }).overall, 100);
    assert.equal(overallScore({ errors: 100, reviewDone: 29, reviewTotal: 30, manualDone: 23, manualTotal: 23 }).overall, 99);
    assert.equal(overallScore({ errors: 100, manualDone: 22, manualTotal: 23 }).overall, 99);
  });

  it('counts an empty part as done', () => {
    assert.equal(partScore(0, 0), 100);
    assert.equal(overallScore({ errors: 100 }).overall, 100);
  });

  it('caps the overall score while a critical failure remains', () => {
    const r = overallScore({ errors: 95, manualDone: 23, manualTotal: 23, hasCritical: true });
    assert.equal(r.overall, CRITICAL_CAP);
    assert.equal(r.capped, true);
    assert.equal(overallScore({ errors: 40, hasCritical: true, manualTotal: 10 }).capped, false);
  });

  it('has no score when no page was scored', () => {
    assert.equal(overallScore({ errors: null, manualDone: 23, manualTotal: 23 }), null);
  });

  it('gives a fresh scan without automated errors 60, not 100, while reviews and manual checks are open', () => {
    // What a guest sees on the teaser: nothing reviewed, nothing ticked.
    assert.equal(overallScore({ errors: 100, reviewTotal: 4, manualTotal: 23 }).overall, 60);
    assert.equal(overallScore({ errors: 100, reviewTotal: 0, manualTotal: 23 }).overall, 75);
  });
});

describe('errors part', () => {
  it('reads rule severities from axe-core and the remediation table', () => {
    assert.equal(axeRuleSeverity('label'), 'critical');
    assert.equal(axeRuleSeverity('color-contrast'), 'serious');
    assert.equal(axeRuleSeverity('region'), 'moderate');
    assert.equal(axeRuleSeverity('not-a-real-rule'), 'moderate');
    assert.equal(customRuleSeverity('img-alt'), 'serious');
  });

  it('averages page scores, weighting each rule once per page by severity', () => {
    const r = errorsBreakdown(report);
    // home: passed 7 + 7 + 7 = 21, failed 7 + 7 + 10 = 24 -> 46.7; about: 100
    assert.equal(r.score, 73);
    assert.equal(r.pagesScored, 2);
    assert.equal(r.hasCritical, true);
  });

  it('ignores warnings, info rows, vacuous passes and pages that did not load', () => {
    const clean = errorsBreakdown({
      urls: [about],
      customResults: report.customResults,
      axeResults: { [about]: report.axeResults[about] },
    });
    assert.equal(clean.score, 100);
    assert.equal(clean.hasCritical, false);
  });

  it('does not depend on how many elements fail a rule', () => {
    const many = structuredClone(report);
    many.axeResults[home].violations[0].nodes = new Array(200).fill({});
    assert.equal(errorsBreakdown(many).score, errorsBreakdown(report).score);
  });

  it('has no score when nothing was scanned', () => {
    assert.equal(errorsBreakdown({ urls: [], customResults: [], axeResults: {} }).score, null);
  });
});

describe('to review part', () => {
  it('lists each warning once per rule and page, on scanned pages only', () => {
    const items = reviewItems({
      ...report,
      customResults: [
        ...report.customResults,
        { id: 'skip-link', status: 'warn', url: home },
        { id: 'skip-link', status: 'warn', url: 'https://example.com/broken' },
      ],
    });
    assert.deepEqual(items.map((i) => i.key), [`skip-link|${home}`]);
  });

  it('counts reviewed items toward the overall score', () => {
    // Without the critical failure, so the cap does not hide the gain.
    const noCritical = structuredClone(report);
    noCritical.axeResults[home].violations = [{ id: 'color-contrast' }];
    const before = scoreParts(noCritical, { manualDone: 23, manualTotal: 23 });
    const after = scoreParts(noCritical, { manualDone: 23, manualTotal: 23, reviewedKeys: [`skip-link|${home}`] });
    assert.equal(before.result.review, 0);
    assert.equal(after.result.review, 100);
    assert.equal(after.result.overall - before.result.overall, 15);
  });
});

describe('points to gain', () => {
  it('gives each failing rule its share of the overall score, worth more when more severe', () => {
    const gains = ruleGains(report);
    assert.deepEqual([...gains.keys()].sort(), ['axe:color-contrast', 'axe:label', 'custom:img-alt']);
    assert.ok(gains.get('axe:label') > gains.get('axe:color-contrast'), 'a critical rule is worth more');
    assert.equal(gains.get('axe:color-contrast'), gains.get('custom:img-alt'));
  });

  it('adds up to everything the errors part still has to give', () => {
    const gains = ruleGains(report);
    const total = [...gains.values()].reduce((sum, g) => sum + g, 0);
    const left = (100 - errorsBreakdown(report).exact) * 0.6;
    assert.ok(Math.abs(total - left) < 0.2, `${total} vs ${left}`);
  });

  it('matches the errors score after the rule is really fixed', () => {
    const fixed = structuredClone(report);
    fixed.axeResults[home].violations = fixed.axeResults[home].violations.filter((v) => v.id !== 'label');
    fixed.axeResults[home].passes.push({ id: 'label' });
    const gained = (errorsBreakdown(fixed).exact - errorsBreakdown(report).exact) * 0.6;
    assert.ok(Math.abs(gained - ruleGains(report).get('axe:label')) < 0.06);
  });
});
