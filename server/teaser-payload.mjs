/**
 * Sanitized guest teaser: score + counts + top issue titles. No selectors, snippets, or nodes.
 */
import { getRemediation } from '../remediation-data.js';
import { scoreFromResult } from './audit-list.js';
import { axeRuleSeverity, customRuleSeverity, PAGE_LOAD_CHECK_ID } from '../scoring.js';

const SEVERITY_RANK = { critical: 4, serious: 3, moderate: 2, minor: 1 };

/**
 * The most severe distinct findings: failures before warnings, then by the same
 * severity the score uses (scoring.js), so the teaser and the score agree on
 * what matters most.
 */
function uniqueTopIssues(reportData, limit = 3) {
  /** @type {Map<string, { title: string, wcag: string[], impact: string, rank: number }>} */
  const byId = new Map();

  function add(key, title, wcag, severity, isFailure) {
    if (!key || byId.has(key)) return;
    byId.set(key, {
      title: String(title || key).slice(0, 200),
      wcag: Array.isArray(wcag) ? wcag.map(String).slice(0, 6) : [],
      impact: severity,
      rank: (isFailure ? 10 : 0) + (SEVERITY_RANK[severity] || 0),
    });
  }

  for (const data of Object.values(reportData?.axeResults || {})) {
    for (const violation of data?.violations || []) {
      const rem = getRemediation(null, violation.id);
      add(`axe:${violation.id}`, violation.help || violation.id, rem?.wcag, axeRuleSeverity(violation.id), true);
    }
  }
  for (const row of reportData?.customResults || []) {
    if (row.status !== 'fail' && row.status !== 'warn') continue;
    if (row.id === PAGE_LOAD_CHECK_ID) continue;
    const rem = getRemediation(row.id, null);
    add(`custom:${row.id}`, row.rule || row.id, rem?.wcag, customRuleSeverity(row.id), row.status === 'fail');
  }

  return [...byId.values()]
    .sort((a, b) => b.rank - a.rank)
    .slice(0, limit)
    .map(({ title, wcag, impact }) => ({ title, wcag, impact }));
}

const LOCKED_LABEL = 'In the full report';

/**
 * What the guest teaser page may send to the browser for the locked tabs.
 *
 * The locked tabs are shown blurred behind a lock, as a preview of what an
 * account or tokens unlock. A blur is only CSS: anything sent to the browser can
 * be read in the page source. So the rows behind the blur are stand-ins with
 * the real list's length and severity mix, and none of its content: no rule
 * names, messages, WCAG references, page URLs, selectors or HTML.
 *
 * The free part is the score, the counts and the top three issue titles.
 *
 * @param {{ fixOrderItems?: any[], rulesTable?: any[] }} payload from buildAstroMainReportPayload
 * @param {object} reportData the scan result
 */
export function buildLockedDashboardData(payload, reportData) {
  const fixOrderItems = (payload?.fixOrderItems || []).map((item, index) => ({
    id: `locked-${index + 1}`,
    rule: LOCKED_LABEL,
    type: item.type,
    status: item.status,
    impact: item.impact,
    effort: item.effort,
    wcag: [],
    url: '',
    pages: [],
    message: '',
    snippet: '',
    fixCode: '',
    occurrenceDetails: [],
    occurrencesTotal: 0,
    occurrencesOnPage: 0,
    scoreGain: 0,
    reviewKey: null,
  }));
  const rulesTable = (payload?.rulesTable || []).map((row, index) => ({
    type: row.type,
    id: `locked-${index + 1}`,
    rule: LOCKED_LABEL,
    severity: row.severity,
    occurrences: 0,
    pages: [],
  }));
  return { fixOrderItems, rulesTable, topIssues: uniqueTopIssues(reportData, 3) };
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
