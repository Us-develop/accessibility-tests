/**
 * Sanitized guest teaser: score + counts + top issue titles. No selectors, snippets, or nodes.
 */
import { getRemediation } from '../remediation-data.js';
import { scoreFromResult } from './audit-list.js';

const IMPACT_RANK = {
  critical: 4,
  high: 3,
  serious: 3,
  medium: 2,
  moderate: 2,
  minor: 1,
  low: 1,
};

function impactRank(value) {
  return IMPACT_RANK[String(value || '').toLowerCase()] || 0;
}

function uniqueTopIssues(reportData, limit = 3) {
  /** @type {Map<string, { id: string, title: string, wcag: string[], impact: string }>} */
  const byId = new Map();

  function add(id, title, rem, fallbackImpact) {
    if (!id || byId.has(id)) return;
    const impact = rem?.impact || fallbackImpact || 'medium';
    byId.set(id, {
      id,
      title: String(title || id).slice(0, 200),
      wcag: Array.isArray(rem?.wcag) ? rem.wcag.map(String).slice(0, 6) : [],
      impact,
    });
  }

  for (const row of reportData?.customResults || []) {
    if (row.status !== 'fail' && row.status !== 'warn') continue;
    const rem = getRemediation(row.id, null);
    add(row.id, row.rule || row.id, rem, row.status === 'fail' ? 'high' : 'medium');
  }
  for (const data of Object.values(reportData?.axeResults || {})) {
    for (const violation of data?.violations || []) {
      const rem = getRemediation(null, violation.id);
      add(violation.id, violation.help || violation.id, rem, violation.impact);
    }
  }

  return [...byId.values()]
    .sort((a, b) => impactRank(b.impact) - impactRank(a.impact))
    .slice(0, limit)
    .map(({ title, wcag, impact }) => ({ title, wcag, impact }));
}

export function buildTeaserPayload(reportData, extras = {}) {
  const summary = reportData?.summary || {};
  let violations = 0;
  for (const data of Object.values(reportData?.axeResults || {})) {
    violations += Number(data?.violations?.length || 0);
  }
  const urls = Array.isArray(reportData?.urls) ? reportData.urls.map(String) : [];
  const scannedUrl = extras.url || urls[0] || extras.domain || '';
  const score = scoreFromResult(reportData);
  return {
    domain: extras.domain || '',
    url: scannedUrl,
    score: score == null ? null : score,
    summary: {
      pass: Number(summary.pass || 0),
      fail: Number(summary.fail || 0),
      warn: Number(summary.warn || 0),
      violations,
    },
    topIssues: uniqueTopIssues(reportData, 3),
  };
}
