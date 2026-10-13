import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildAstroMainReportPayload } from '../report-astro-payload.js';
import { buildLockedDashboardData } from '../server/teaser-payload.mjs';

const url = 'https://guest-site.example/secret-landing';
const report = {
  generatedAt: '2026-10-13T10:00:00.000Z',
  urls: [url],
  axeResults: {
    [url]: {
      url,
      violations: [
        {
          id: 'color-contrast',
          impact: 'serious',
          help: 'Elements must meet minimum color contrast ratio thresholds',
          tags: ['wcag2aa', 'wcag143'],
          nodes: [{ html: '<p class="hero-tagline-xyz">Pale text</p>', target: ['p.hero-tagline-xyz'] }],
        },
        { id: 'label', impact: 'critical', help: 'Form elements must have labels', tags: ['wcag412'], nodes: [{ html: '<input id="newsletter-zzz">', target: ['#newsletter-zzz'] }] },
      ],
      incomplete: [],
      passes: [{ id: 'document-title' }],
    },
  },
  customResults: [
    { id: 'img-alt', status: 'fail', rule: 'Images MUST have alt text', message: '3 image(s) without alt', chapter: 'images', url, occurrences: [{ tag: 'img', html: '<img src="/team-photo-qqq.jpg">', selector: 'img.team-qqq' }] },
    { id: 'skip-link', status: 'warn', rule: 'Skip link SHOULD be provided', message: 'No skip link detected', chapter: 'semantics', url },
    { id: 'html-lang', status: 'pass', rule: 'Language', message: 'ok', chapter: 'semantics', url },
  ],
  summary: { pass: 1, fail: 1, warn: 1, info: 0 },
};

describe('teaser locked data', () => {
  const payload = buildAstroMainReportPayload(report);
  const locked = buildLockedDashboardData(payload, report);
  const sent = JSON.stringify({ fixOrderItems: locked.fixOrderItems, rulesTable: locked.rulesTable });

  it('keeps the shape of the lists so the blurred preview looks real', () => {
    assert.equal(locked.fixOrderItems.length, payload.fixOrderItems.length);
    assert.equal(locked.rulesTable.length, payload.rulesTable.length);
    assert.deepEqual(
      locked.fixOrderItems.map((i) => i.status).sort(),
      payload.fixOrderItems.map((i) => i.status).sort()
    );
  });

  it('sends nothing from the scan behind the blur', () => {
    for (const secret of [
      'color-contrast',
      'img-alt',
      'skip-link',
      'hero-tagline-xyz',
      'newsletter-zzz',
      'team-photo-qqq',
      'secret-landing',
      'minimum color contrast',
      'without alt',
      '1.4.3',
    ]) {
      assert.equal(sent.toLowerCase().includes(secret.toLowerCase()), false, `leaked: ${secret}`);
    }
  });

  it('gives the three most severe issue titles for free, without where or how', () => {
    assert.equal(locked.topIssues.length, 3);
    assert.equal(locked.topIssues[0].title, 'Form elements must have labels');
    const top = JSON.stringify(locked.topIssues);
    for (const secret of ['hero-tagline-xyz', 'newsletter-zzz', 'team-photo-qqq', 'secret-landing']) {
      assert.equal(top.includes(secret), false, `leaked: ${secret}`);
    }
    for (const issue of locked.topIssues) assert.deepEqual(Object.keys(issue).sort(), ['impact', 'title', 'wcag']);
  });
});
