import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAstroMainReportPayload } from '../report-astro-payload.js';
import { generateAllDeliverables } from '../generate-deliverables.js';
import {
  primaryHostFromReport,
  pageLoadFailures,
  reportLoadedPages,
} from '../report-buckets.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const failedDnsReport = {
  generatedAt: '2026-09-22T10:00:00.000Z',
  urls: [],
  axeResults: {},
  summary: { pass: 0, fail: 1, warn: 0, info: 0 },
  customResults: [
    {
      id: 'page-load',
      rule: 'Page load',
      status: 'fail',
      message: 'page.goto: net::ERR_NAME_NOT_RESOLVED at https://dev.mnds.agency/',
      url: 'https://dev.mnds.agency/',
    },
  ],
};

describe('failed scan hostname and completeness', () => {
  it('uses the attempted URL host instead of this-site', () => {
    assert.equal(primaryHostFromReport(failedDnsReport), 'dev.mnds.agency');
    assert.equal(reportLoadedPages(failedDnsReport), false);
    assert.equal(pageLoadFailures(failedDnsReport).length, 1);
  });

  it('builds an unscored payload with no deliverables-ready flag', () => {
    const payload = buildAstroMainReportPayload(failedDnsReport);
    assert.equal(payload.primaryHost, 'dev.mnds.agency');
    assert.equal(payload.pagesLoaded, false);
    assert.equal(payload.scoreAvailable, false);
    assert.equal(payload.urls.length, 0);
    assert.equal(payload.loadFailures[0].url, 'https://dev.mnds.agency/');
    assert.doesNotMatch(payload.executiveSummaryHtml, /score is <strong>0<\/strong> out of 100/);
  });

  it('writes honest failed-load stubs instead of example.com deliverables', () => {
    const dir = mkdtempSync(join(tmpdir(), 'a11y-failed-scan-'));
    const paths = generateAllDeliverables({ reportData: failedDnsReport, domain: 'dev.mnds.agency' }, dir);
    const html = readFileSync(paths.client, 'utf8');
    rmSync(dir, { recursive: true, force: true });
    assert.match(html, /is not ready/);
    assert.match(html, /dev\.mnds\.agency/);
    assert.match(html, /ERR_NAME_NOT_RESOLVED/);
    assert.doesNotMatch(html, /example\.com/);
    assert.doesNotMatch(html, /this-site/);
  });

  it('hides the deliverables CTA until a page has loaded', () => {
    const dashboard = readFileSync(join(repoRoot, 'web/src/components/ResultsDashboard.svelte'), 'utf8');
    assert.match(dashboard, /load-fail-banner/);
    assert.match(dashboard, /\{#if !locked && hasLoadedPages\}/);
    assert.match(dashboard, /Three deliverables, ready/);
    assert.doesNotMatch(dashboard, /\{#if !locked\}\s*\n\s*<!-- Footer CTAs -->/);
  });
});
