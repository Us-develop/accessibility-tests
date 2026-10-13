/**
 * Turns a scan result into the inputs of the score model (score-model.js).
 *
 * Errors part, per page:
 *   100 x (weight of rules that passed) / (weight of rules that passed or failed)
 * and the site figure is the average over the scanned pages, so each page
 * counts the same however many rules apply to it.
 *
 * - A rule counts once per page, however many elements fail it.
 * - A rule's weight comes from its severity (SEVERITY_WEIGHTS). For axe rules
 *   that is the rule's own severity in axe-core, the same whether it passed or
 *   failed, so fixing a rule moves exactly its weight from failed to passed.
 * - Warnings are not errors. They are the "To review" part.
 * - Info rows, failed page loads and passes that are true on almost every page
 *   (VACUOUS_PASS_IDS) are left out.
 */
import { createRequire } from 'module';
import { getRemediation } from './remediation-data.js';
import { OVERALL_WEIGHTS, SEVERITY_WEIGHTS, overallScore } from './score-model.js';

/** Custom-check passes that are true on almost every modern page and must not inflate the score. */
export const VACUOUS_PASS_IDS = new Set(['no-auto-refresh', 'tabindex-positive', 'flash-alternative']);

/** Infrastructure failure recorded when Playwright cannot open a URL. Not a WCAG check. */
export const PAGE_LOAD_CHECK_ID = 'page-load';

const DEFAULT_SEVERITY = 'moderate';
const SEVERITY_RANK = { minor: 1, moderate: 2, serious: 3, critical: 4 };
const CUSTOM_IMPACT_TO_SEVERITY = { high: 'serious', medium: 'moderate', low: 'minor' };

/** @type {Map<string, string> | null} */
let axeSeverityByRule = null;

/**
 * Severity of each axe rule: the highest impact among its checks, which is how
 * axe itself rates a violation of that rule. Read from the installed axe-core
 * so it always matches the engine that ran the scan.
 */
function loadAxeSeverities() {
  const map = new Map();
  try {
    const axe = createRequire(import.meta.url)('axe-core');
    const checks = axe?._audit?.data?.checks || {};
    for (const rule of axe?._audit?.rules || []) {
      let best = null;
      for (const check of [...(rule.any || []), ...(rule.all || []), ...(rule.none || [])]) {
        const impact = checks[typeof check === 'string' ? check : check?.id]?.impact;
        if (impact && (!best || SEVERITY_RANK[impact] > SEVERITY_RANK[best])) best = impact;
      }
      if (best) map.set(rule.id, best);
    }
  } catch (err) {
    console.error('[scoring] could not read rule severities from axe-core:', err?.message || err);
  }
  return map;
}

export function axeRuleSeverity(ruleId) {
  if (!axeSeverityByRule) axeSeverityByRule = loadAxeSeverities();
  return axeSeverityByRule.get(ruleId) || DEFAULT_SEVERITY;
}

export function customRuleSeverity(checkId) {
  return CUSTOM_IMPACT_TO_SEVERITY[getRemediation(checkId)?.impact] || DEFAULT_SEVERITY;
}

/** Key of a rule across pages, matching the dashboard's fix items: `axe:<id>` or `custom:<id>`. */
export function ruleKey(type, id) {
  return `${type === 'axe' || type === 'violation' ? 'axe' : 'custom'}:${id}`;
}

/** Key of one "to review" finding: a rule on a page. Stable across scans of the same URL. */
export function reviewKey(id, url) {
  return `${id}|${url}`;
}

function scannedUrls(reportData) {
  return Array.isArray(reportData?.urls) ? reportData.urls : [];
}

/**
 * Per page: the rules that passed and failed, with weights.
 * @param {object} reportData
 * @param {{ assumeFixed?: Set<string> }} [opts] rule keys to treat as passed everywhere
 */
function tallyPages(reportData, { assumeFixed } = {}) {
  const fixed = assumeFixed || new Set();
  /** @type {Map<string, { passed: Map<string, number>, failed: Map<string, { weight: number, critical: boolean }> }>} */
  const pages = new Map(scannedUrls(reportData).map((url) => [url, { passed: new Map(), failed: new Map() }]));

  const record = (url, key, severity, failed) => {
    const page = pages.get(url);
    if (!page) return;
    const weight = SEVERITY_WEIGHTS[severity] || SEVERITY_WEIGHTS[DEFAULT_SEVERITY];
    if (failed && !fixed.has(key)) {
      page.passed.delete(key);
      page.failed.set(key, { weight, critical: severity === 'critical' });
    } else if (!page.failed.has(key)) {
      page.passed.set(key, weight);
    }
  };

  for (const row of reportData?.customResults || []) {
    if (!row || row.id === PAGE_LOAD_CHECK_ID) continue;
    if (row.status === 'fail') record(row.url, ruleKey('custom', row.id), customRuleSeverity(row.id), true);
    else if (row.status === 'pass' && !VACUOUS_PASS_IDS.has(row.id)) {
      record(row.url, ruleKey('custom', row.id), customRuleSeverity(row.id), false);
    }
  }
  for (const [url, data] of Object.entries(reportData?.axeResults || {})) {
    for (const v of data?.violations || []) record(url, ruleKey('axe', v.id), axeRuleSeverity(v.id), true);
    for (const p of data?.passes || []) record(url, ruleKey('axe', p.id), axeRuleSeverity(p.id), false);
  }
  return pages;
}

/**
 * The Errors part.
 * `exact` is the score before rounding, for working out gains.
 * @returns {{ score: number | null, exact: number | null, passedWeight: number, applicableWeight: number, hasCritical: boolean, pagesScored: number }}
 */
export function errorsBreakdown(reportData, opts = {}) {
  let sum = 0;
  let pagesScored = 0;
  let passedWeight = 0;
  let applicableWeight = 0;
  let hasCritical = false;
  for (const page of tallyPages(reportData, opts).values()) {
    let pass = 0;
    let fail = 0;
    for (const weight of page.passed.values()) pass += weight;
    for (const rule of page.failed.values()) {
      fail += rule.weight;
      if (rule.critical) hasCritical = true;
    }
    if (pass + fail === 0) continue;
    sum += (pass / (pass + fail)) * 100;
    pagesScored += 1;
    passedWeight += pass;
    applicableWeight += pass + fail;
  }
  return {
    score: pagesScored === 0 ? null : Math.round(sum / pagesScored),
    exact: pagesScored === 0 ? null : sum / pagesScored,
    passedWeight,
    applicableWeight,
    hasCritical,
    pagesScored,
  };
}

/**
 * The "To review" list: warnings from the custom checks on scanned pages.
 * One entry per rule per page.
 * @returns {{ key: string, id: string, url: string, rule: string, message: string }[]}
 */
export function reviewItems(reportData) {
  const scanned = new Set(scannedUrls(reportData));
  const seen = new Set();
  const items = [];
  for (const row of reportData?.customResults || []) {
    if (!row || row.status !== 'warn' || !scanned.has(row.url)) continue;
    const key = reviewKey(row.id, row.url);
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ key, id: row.id, url: row.url, rule: row.rule || row.id, message: row.message || '' });
  }
  return items;
}

/**
 * Everything the report needs to show the score.
 * @param {object} reportData
 * @param {{ reviewedKeys?: Iterable<string>, manualDone?: number, manualTotal?: number }} [state]
 */
export function scoreParts(reportData, { reviewedKeys = [], manualDone = 0, manualTotal = 0 } = {}) {
  const errors = errorsBreakdown(reportData);
  const review = reviewItems(reportData);
  const reviewed = new Set(reviewedKeys);
  const reviewDone = review.filter((item) => reviewed.has(item.key)).length;
  const input = {
    errors: errors.score,
    reviewDone,
    reviewTotal: review.length,
    manualDone,
    manualTotal,
    hasCritical: errors.hasCritical,
  };
  return { ...input, result: overallScore(input), errorsDetail: errors, reviewItems: review };
}

/**
 * Overall points gained by fixing each failing rule on every page where it fails,
 * to one decimal.
 *
 * Exact for the Errors part: a fixed rule moves its weight from failed to
 * passed and nothing else changes, so the gains of all failing rules add up to
 * everything the Errors part still has to give. Worked out before rounding and
 * before the critical cap, which can hold the displayed overall score back
 * until the last critical failure is gone.
 * @returns {Map<string, number>} rule key -> points
 */
export function ruleGains(reportData) {
  const gains = new Map();
  const base = errorsBreakdown(reportData);
  if (base.exact == null) return gains;
  const failing = new Set();
  for (const page of tallyPages(reportData).values()) for (const key of page.failed.keys()) failing.add(key);
  for (const key of failing) {
    const fixed = errorsBreakdown(reportData, { assumeFixed: new Set([key]) });
    const points = ((fixed.exact ?? base.exact) - base.exact) * OVERALL_WEIGHTS.errors;
    gains.set(key, Math.max(0, Math.round(points * 10) / 10));
  }
  return gains;
}
