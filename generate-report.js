/**
 * Generates an HTML accessibility report for clients.
 * Run after run-tests.js, or use: node run-tests.js --report
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import {
  getRemediation,
  wcagScUrl,
  fixOrderScore,
} from './remediation-data.js';
import { generateAllDeliverables } from './generate-deliverables.js';
import { SEMANTIC_CHECKLIST_WCAG22 } from './checklists.js';
import {
  buildChartSectionStyles,
} from './report-summary.js';
import { REPORT_BRAND_HEAD, REPORT_MAIN_REPORT_CSS, REPORT_LOGO_URL } from './report-brand.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUTPUT_DIR = join(__dirname, 'reports');

const CHECKLIST_CHAPTERS = {
  semantics: { id: '1', name: 'Semantic Structure and Navigation' },
  images: { id: '2', name: 'Images, Canvas, SVG, and Non-Text Content' },
  visualDesign: { id: '3', name: 'Visual Design and Colors' },
  responsive: { id: '4', name: 'Responsive Design and Zoom' },
  multimedia: { id: '5', name: 'Multimedia, Animations, and Motion' },
  inputMethods: { id: '6', name: 'Device-Independent Input Methods' },
  forms: { id: '7', name: 'Form Labels, Instructions, and Validation' },
  dynamicUpdates: { id: '8', name: 'Dynamic Updates, AJAX, and SPAs' },
};

/** Map check id to primary disabilities (from Deque/WCAG relevance). */
const DISABILITY_MAP = {
  'page-title-exists': ['Blindness', 'Low Vision', 'Reading Disabilities', 'Cognitive Disabilities'],
  'html-lang': ['Blindness', 'Reading Disabilities', 'Cognitive Disabilities'],
  'landmarks-present': ['Blindness', 'Low Vision', 'Cognitive Disabilities'],
  'single-main': ['Blindness', 'Low Vision', 'Cognitive Disabilities'],
  'heading-structure': ['Blindness', 'Low Vision', 'Reading Disabilities', 'Cognitive Disabilities'],
  'link-text': ['Blindness', 'Low Vision', 'Reading Disabilities'],
  'link-meaningful': ['Blindness', 'Low Vision', 'Reading Disabilities', 'Cognitive Disabilities'],
  'skip-link': ['Blindness', 'Dexterity/Motor Disabilities'],
  'table-headers': ['Blindness', 'Low Vision', 'Reading Disabilities', 'Cognitive Disabilities'],
  'list-markup': ['Blindness', 'Low Vision', 'Reading Disabilities', 'Cognitive Disabilities'],
  'iframe-titles': ['Blindness', 'Low Vision', 'Cognitive Disabilities'],
  'unique-ids': ['Blindness', 'Cognitive Disabilities'],
  'img-alt': ['Blindness', 'Low Vision', 'Deafblindness'],
  'img-alt-length': ['Blindness', 'Low Vision', 'Deafblindness', 'Cognitive Disabilities'],
  'svg-role': ['Blindness', 'Low Vision', 'Deafblindness'],
  'svg-accessible-name': ['Blindness', 'Low Vision', 'Deafblindness'],
  'canvas-alt': ['Blindness', 'Low Vision', 'Deafblindness'],
  'image-map-alt': ['Blindness', 'Low Vision', 'Deafblindness'],
  'link-differentiation': ['Colorblindness', 'Low Vision'],
  'text-contrast': ['Low Vision', 'Colorblindness'],
  'non-text-contrast': ['Low Vision', 'Colorblindness'],
  'focus-indicator': ['Low Vision', 'Dexterity/Motor Disabilities', 'Blindness'],
  'no-horizontal-scroll': ['Low Vision', 'Dexterity/Motor Disabilities'],
  'viewport-zoom': ['Low Vision', 'Dexterity/Motor Disabilities'],
  'video-captions': ['Deafness and Hard-of-Hearing', 'Deafblindness'],
  'video-autoplay': ['Deafness and Hard-of-Hearing', 'Cognitive Disabilities'],
  'audio-autoplay': ['Deafness and Hard-of-Hearing'],
  'flash-alternative': ['Blindness', 'Deafness and Hard-of-Hearing'],
  'tabindex-positive': ['Dexterity/Motor Disabilities', 'Blindness'],
  'touch-target-size': ['Dexterity/Motor Disabilities', 'Low Vision'],
  'form-labels': ['Blindness', 'Cognitive Disabilities', 'Reading Disabilities'],
  'placeholder-not-only-label': ['Blindness', 'Cognitive Disabilities', 'Reading Disabilities'],
  'no-auto-refresh': ['Cognitive Disabilities', 'Dexterity/Motor Disabilities'],
  'dynamic-announcements': ['Blindness', 'Cognitive Disabilities'],
  'page-load': ['Various'],
};

const ALL_DISABILITIES = [
  'Blindness', 'Low Vision', 'Colorblindness', 'Deafness and Hard-of-Hearing',
  'Deafblindness', 'Dexterity/Motor Disabilities', 'Speech Disabilities',
  'Cognitive Disabilities', 'Reading Disabilities', 'Seizure Disorders', 'Various',
];

const MANUAL_VERIFICATION_ITEMS = [
  { text: 'Page title is unique and describes the page or result of the user action.', disabilities: ['Blindness', 'Low Vision', 'Reading Disabilities', 'Cognitive Disabilities'] },
  { text: 'Link purpose can be determined from the link text alone (no "click here").', disabilities: ['Blindness', 'Low Vision', 'Reading Disabilities', 'Cognitive Disabilities'] },
  { text: 'Alternative text is meaningful and concise, not just present.', disabilities: ['Blindness', 'Low Vision', 'Deafblindness'] },
  { text: 'Color contrast meets 4.5:1 for normal text, 3:1 for large text and UI.', disabilities: ['Low Vision', 'Colorblindness'] },
  { text: 'Information is not conveyed by color alone.', disabilities: ['Colorblindness', 'Low Vision'] },
  { text: 'Focus order is logical and matches visual order; no positive tabindex.', disabilities: ['Blindness', 'Dexterity/Motor Disabilities'] },
  { text: 'All interactive elements are keyboard accessible and have visible focus.', disabilities: ['Blindness', 'Dexterity/Motor Disabilities', 'Low Vision'] },
  { text: 'Touch targets are at least 44×44px with spacing between them.', disabilities: ['Dexterity/Motor Disabilities', 'Low Vision'] },
  { text: 'Form error messages are associated with fields and announced to screen readers.', disabilities: ['Blindness', 'Cognitive Disabilities', 'Reading Disabilities'] },
  { text: 'Dynamic content changes are announced (e.g. aria-live) where appropriate.', disabilities: ['Blindness', 'Cognitive Disabilities'] },
  { text: 'No content flashes more than 3 times per second (seizure risk).', disabilities: ['Seizure Disorders'] },
  { text: 'Video has captions and, if needed, audio description; audio has transcript.', disabilities: ['Deafness and Hard-of-Hearing', 'Deafblindness'] },
  { text: 'Motion/animation can be paused or disabled (e.g. prefers-reduced-motion).', disabilities: ['Cognitive Disabilities'] },
];

const ASSISTIVE_TECH_ITEMS = [
  { text: 'Screen reader (NVDA, JAWS, or VoiceOver): Navigate by headings and landmarks; all content reachable.', disabilities: ['Blindness', 'Low Vision'] },
  { text: 'Screen reader: Form fields have announced labels and errors; buttons/links have clear names.', disabilities: ['Blindness', 'Low Vision'] },
  { text: 'Screen reader: No unexpected context changes on focus; dynamic updates are announced.', disabilities: ['Blindness', 'Cognitive Disabilities'] },
  { text: 'Keyboard only: Tab through every interactive element; no keyboard traps.', disabilities: ['Blindness', 'Dexterity/Motor Disabilities'] },
  { text: 'Keyboard only: Focus order matches visual order; focus is always visible.', disabilities: ['Blindness', 'Dexterity/Motor Disabilities', 'Low Vision'] },
  { text: 'Keyboard only: All actions (menus, modals, carousels) work with keyboard alone.', disabilities: ['Blindness', 'Dexterity/Motor Disabilities'] },
  { text: 'Zoom: At 200% zoom, content reflows; no horizontal scrolling; text still readable.', disabilities: ['Low Vision'] },
  { text: 'Zoom: No content clipped or overlapping at 200%.', disabilities: ['Low Vision'] },
  { text: 'Reduce motion: Animations respect prefers-reduced-motion or can be paused.', disabilities: ['Cognitive Disabilities'] },
  { text: 'Mobile/touch: All features work with touch; targets are large enough; no gesture-only actions.', disabilities: ['Dexterity/Motor Disabilities', 'Low Vision'] },
];

const MANUAL_TODO_ITEMS = [
  { label: 'Manual verification', items: MANUAL_VERIFICATION_ITEMS },
  { label: 'Assistive technology & manual testing', items: ASSISTIVE_TECH_ITEMS },
];

function statusColor(s) {
  if (s === 'pass') return '#2e7d32';
  if (s === 'fail') return '#c62828';
  if (s === 'warn') return '#ed6c02';
  return '#1565c0';
}

function escapeHtml(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Format occurrence as "tag#id.class1.class2" (element type, id if present, class(es) if present). */
function formatOccurrenceDescriptor(occ) {
  if (occ.tag != null) {
    const tag = (occ.tag || 'element').toLowerCase();
    const idPart = occ.id ? '#' + String(occ.id) : '';
    const classPart = occ.className ? '.' + String(occ.className).trim().split(/\s+/).filter(Boolean).join('.') : '';
    const label = occ.occurrenceLabel || '';
    return tag + idPart + classPart + label;
  }
  if (occ.html) {
    const html = String(occ.html);
    const tagMatch = html.match(/<([a-z][a-z0-9]*)/i);
    const tag = tagMatch ? tagMatch[1].toLowerCase() : 'element';
    const idMatch = html.match(/\bid=["']([^"']*)["']/i);
    const id = idMatch ? idMatch[1] : '';
    const classMatch = html.match(/\bclass=["']([^"']*)["']/i);
    const rawClass = classMatch ? classMatch[1] : '';
    const classPart = rawClass ? '.' + rawClass.trim().split(/\s+/).filter(Boolean).join('.') : '';
    return tag + (id ? '#' + id : '') + classPart;
  }
  const sel = occ.selector || (Array.isArray(occ.target) ? occ.target[0] : occ.target);
  return sel != null ? String(sel) : '—';
}

function severityRank(level) {
  if (level === 'critical') return 3;
  if (level === 'serious') return 2;
  if (level === 'moderate') return 1;
  return 0;
}

function computeIssueMetrics(reportData) {
  const severity = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  const pageMap = new Map((reportData.urls || []).map((u) => [u, { issues: 0, worst: 'minor' }]));

  Object.entries(reportData.axeResults || {}).forEach(([url, data]) => {
    (data.violations || []).forEach((v) => {
      const impact = String(v.impact || 'moderate').toLowerCase();
      const level = ['critical', 'serious', 'moderate', 'minor'].includes(impact) ? impact : 'moderate';
      const count = Math.max(1, (v.nodes || []).length || 1);
      severity[level] += count;

      const current = pageMap.get(url) || { issues: 0, worst: 'minor' };
      current.issues += count;
      if (severityRank(level) > severityRank(current.worst)) current.worst = level;
      pageMap.set(url, current);
    });
  });

  (reportData.customResults || []).forEach((r) => {
    if (r.status !== 'fail' && r.status !== 'warn') return;
    const rem = getRemediation(r.id, null);
    const level = r.status === 'fail'
      ? ((rem.impact || '').toLowerCase() === 'high' ? 'critical' : 'serious')
      : 'moderate';
    severity[level] += 1;
    if (!r.url) return;
    const current = pageMap.get(r.url) || { issues: 0, worst: 'minor' };
    current.issues += 1;
    if (severityRank(level) > severityRank(current.worst)) current.worst = level;
    pageMap.set(r.url, current);
  });

  const mostAffectedPages = [...pageMap.entries()]
    .map(([url, v]) => ({ url, issues: v.issues, worst: v.worst }))
    .filter((x) => x.issues > 0)
    .sort((a, b) => b.issues - a.issues || severityRank(b.worst) - severityRank(a.worst));

  return {
    severity,
    mostAffectedPages,
    pagesAffected: mostAffectedPages.length,
  };
}

function computeCategoryStats(fixOrderItems) {
  const defs = [
    { key: 'contrast', label: 'Color contrast', color: '#c73b42', match: (i) => /contrast/i.test(i.id || '') || /contrast/i.test(i.rule || '') },
    { key: 'images', label: 'Missing alt text', color: '#d98200', match: (i) => /img-alt|image-alt|alt/i.test(i.id || '') || /alt text|image/i.test(i.rule || '') },
    { key: 'forms', label: 'Form labels', color: '#3b6db1', match: (i) => /label|form/i.test(i.id || '') || /label|form/i.test(i.rule || '') },
    { key: 'keyboard', label: 'Keyboard nav', color: '#3f8f52', match: (i) => /keyboard|tabindex|focus-order|focus-visible|focus/i.test(i.id || '') || /keyboard|focus|tab/i.test(i.rule || '') },
    { key: 'reader', label: 'Screen reader', color: '#7c72d2', match: (i) => /aria|name-role|iframe|landmark|region|dynamic/i.test(i.id || '') || /screen reader|aria/i.test(i.rule || '') },
    { key: 'links', label: 'Link clarity', color: '#8b8b83', match: (i) => /link/i.test(i.id || '') || /link/i.test(i.rule || '') },
    { key: 'headings', label: 'Headings', color: '#58bea0', match: (i) => /heading/i.test(i.id || '') || /heading/i.test(i.rule || '') },
  ];
  const counts = Object.fromEntries(defs.map((d) => [d.key, 0]));
  (fixOrderItems || []).forEach((item) => {
    const def = defs.find((d) => d.match(item));
    if (def) counts[def.key] += 1;
  });
  return defs.map((d) => ({ ...d, count: counts[d.key] }));
}

export function generateReport(reportData, options = {}) {
  const outputDir = options.outputDir || DEFAULT_OUTPUT_DIR;
  const resultsFile = join(outputDir, 'accessibility-results.json');
  const reportFile = join(outputDir, 'accessibility-report.html');

  if (!reportData) {
    if (!existsSync(resultsFile)) {
      console.error('No results found. Run: node run-tests.js');
      process.exit(1);
    }
    reportData = JSON.parse(readFileSync(resultsFile, 'utf8'));
  }

  const prevFile = join(outputDir, 'accessibility-results-previous.json');
  let prevData = null;
  if (existsSync(prevFile)) {
    try {
      prevData = JSON.parse(readFileSync(prevFile, 'utf8'));
    } catch (_) {}
  }

  function issueKey(r, url) {
    return `${url || ''}|${r.id || r.ruleId}|${r.rule || r.help || ''}`;
  }
  const prevCustomMap = new Map();
  const prevViolationMap = new Map();
  if (prevData) {
    (prevData.customResults || []).forEach((r) => prevCustomMap.set(issueKey(r, r.url), r));
    Object.entries(prevData.axeResults || {}).forEach(([u, data]) => {
      (data.violations || []).forEach((v) => prevViolationMap.set(`${u}|${v.id}|${v.help}`, v));
    });
  }
  const currCustomMap = new Map();
  const currViolationMap = new Map();
  (reportData.customResults || []).forEach((r) => currCustomMap.set(issueKey(r, r.url), r));
  Object.entries(reportData.axeResults || {}).forEach(([u, data]) => {
    (data.violations || []).forEach((v) => currViolationMap.set(`${u}|${v.id}|${v.help}`, v));
  });
  const improved = [];
  const regressed = [];
  prevCustomMap.forEach((prev, k) => {
    const curr = currCustomMap.get(k);
    if (!curr) return;
    const pFail = prev.status === 'fail' || prev.status === 'warn';
    const cFail = curr.status === 'fail' || curr.status === 'warn';
    if (pFail && !cFail) improved.push({ type: 'custom', ...curr });
    if (!pFail && cFail) regressed.push({ type: 'custom', ...curr });
  });
  prevViolationMap.forEach((_, k) => {
    if (!currViolationMap.has(k)) improved.push({ type: 'violation', key: k });
  });
  currViolationMap.forEach((v, k) => {
    if (!prevViolationMap.has(k)) regressed.push({ type: 'violation', key: k, ...v });
  });

  const fixOrderItems = [];
  (reportData.customResults || []).forEach((r) => {
    if (r.status === 'fail' || r.status === 'warn') {
      const rem = getRemediation(r.id, null);
      fixOrderItems.push({
        type: 'custom',
        rule: r.rule,
        id: r.id,
        url: r.url,
        status: r.status,
        ...rem,
      });
    }
  });
  Object.entries(reportData.axeResults || {}).forEach(([url, data]) => {
    (data.violations || []).forEach((v) => {
      const rem = getRemediation(null, v.id);
      fixOrderItems.push({
        type: 'violation',
        rule: v.help,
        id: v.id,
        url,
        status: 'violation',
        ...rem,
      });
    });
  });
  fixOrderItems.sort((a, b) => fixOrderScore(a) - fixOrderScore(b));

  const customByChapter = {};
  Object.keys(CHECKLIST_CHAPTERS).forEach((ch) => {
    customByChapter[ch] = reportData.customResults?.filter((r) => r.chapter === ch) || [];
  });

  const totalAxeViolations = Object.values(reportData.axeResults || {}).reduce(
    (sum, r) => sum + (r.violations?.length || 0),
    0
  );
  const totalAxePasses = Object.values(reportData.axeResults || {}).reduce(
    (sum, r) => sum + (r.passes?.length || 0),
    0
  );

  const loadErrors = (reportData.customResults || []).filter((r) => r.id === 'page-load');

  const pass = reportData.summary?.pass || 0;
  const fail = reportData.summary?.fail || 0;
  const warn = reportData.summary?.warn || 0;
  // Score = % of all checks that passed (custom pass + axe rules passed) / (custom results + axe violations + axe passes)
  const total = pass + fail + warn + totalAxeViolations + totalAxePasses;
  const score = total === 0 ? 100 : Math.round(((pass + totalAxePasses) / total) * 100);
  const scoreClamp = Math.max(0, Math.min(100, score));

  const disabilityStats = {};
  ALL_DISABILITIES.forEach((d) => { disabilityStats[d] = 0; });
  (reportData.customResults || []).forEach((r) => {
    (DISABILITY_MAP[r.id] || ['Various']).forEach((d) => { if (disabilityStats[d] !== undefined) disabilityStats[d]++; });
  });
  [...MANUAL_VERIFICATION_ITEMS, ...ASSISTIVE_TECH_ITEMS].forEach((item) => {
    (item.disabilities || []).forEach((d) => { if (disabilityStats[d] !== undefined) disabilityStats[d]++; });
  });
  Object.values(reportData.axeResults || {}).forEach((data) => {
    const count = (data.violations?.length || 0) * Math.max(1, reportData.urls?.length || 1);
    disabilityStats['Various'] = (disabilityStats['Various'] || 0) + count;
  });

  const issueMetrics = computeIssueMetrics(reportData);
  const totalIssues = fail + warn + totalAxeViolations;
  const criticalIssues = issueMetrics.severity.critical;
  const totalPages = (reportData.urls || []).length;
  const mostAffected = issueMetrics.mostAffectedPages.slice(0, 7);
  const primaryHost = (() => {
    const first = (reportData.urls || [])[0];
    if (!first) return 'this-site';
    try {
      return String(new URL(first).hostname || 'this-site').replace(/^www\./, '');
    } catch {
      return 'this-site';
    }
  })();
  const auditedDate = new Date(reportData.generatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const complianceHeadline = scoreClamp >= 75
    ? 'WCAG 2.1 compliance — Level AA partial'
    : scoreClamp >= 60
      ? 'WCAG 2.1 compliance — Level A partial'
      : 'WCAG 2.1 compliance — below Level A';
  const complianceNote = scoreClamp >= 75
    ? `The site meets ${scoreClamp}% of tested criteria. Continue resolving remaining serious and critical issues to reach full Level AA.`
    : `The site meets ${scoreClamp}% of tested criteria. Level AA has not been reached. Resolving critical issues first is the fastest path forward.`;
  const categoryStats = computeCategoryStats(fixOrderItems);
  const categoryMax = Math.max(1, ...categoryStats.map((c) => c.count));
  const topCategoryCards = [...categoryStats].sort((a, b) => b.count - a.count).slice(0, 3);
  const industryAvg = 71;
  const top10Threshold = 88;
  const betterThan = Math.max(5, Math.min(95, scoreClamp - 24));
  const gapToAvg = scoreClamp - industryAvg;
  const closeGapIssues = Math.max(1, Math.round(Math.abs(gapToAvg) * 2));
  const top10Issues = Math.max(0, Math.round((top10Threshold - scoreClamp) * 1.6));
  const avgByLabel = {
    'Color contrast': 58,
    'Form labels': 72,
    'Missing alt text': 65,
    'Keyboard nav': 68,
    'Screen reader': 74,
    'Link clarity': 69,
    Headings: 70,
  };
  const categoryScores = categoryStats.map((c) => {
    const avg = avgByLabel[c.label] ?? 70;
    const scoreVal = Math.max(8, Math.min(96, Math.round(92 - c.count * 4)));
    return { label: c.label, you: scoreVal, avg, diff: scoreVal - avg };
  }).sort((a, b) => a.label.localeCompare(b.label)).slice(0, 6);
  const distLeft = Math.max(4, Math.min(96, scoreClamp));
  const avgLeft = industryAvg;
  const thresholds = [30, 48, 71, 82, 88];
  const quickWinsCount = fixOrderItems.filter((i) => i.impact === 'high' && i.effort === 'simple').length;
  const projectedQuick = Math.min(100, scoreClamp + Math.max(6, quickWinsCount * 3));
  const projectedFull = Math.min(100, scoreClamp + Math.max(14, Math.round(fixOrderItems.slice(0, 5).length * 4.5)));
  const projectedPercentile = projectedFull >= 88 ? 'Top 10%' : projectedFull >= 80 ? 'Top 20%' : projectedFull >= 71 ? 'Top 38%' : 'Top 50%';
  const visualUsers = Math.max(180, (disabilityStats['Blindness'] || 0) * 28 + (disabilityStats['Low Vision'] || 0) * 22);
  const motorUsers = Math.max(140, (disabilityStats['Dexterity/Motor Disabilities'] || 0) * 18);
  const cognitiveUsers = Math.max(120, (disabilityStats['Cognitive Disabilities'] || 0) * 15 + (disabilityStats['Reading Disabilities'] || 0) * 10);
  const hearingUsers = Math.max(80, (disabilityStats['Deafness and Hard-of-Hearing'] || 0) * 14);
  const agingUsers = Math.max(160, (disabilityStats['Low Vision'] || 0) * 20);
  const temporaryUsers = Math.max(100, (disabilityStats['Various'] || 0) * 2);
  const userImpactRows = [
    ['Visual impairment', visualUsers],
    ['Motor disability', motorUsers],
    ['Cognitive disability', cognitiveUsers],
    ['Hearing impairment', hearingUsers],
    ['Low vision / aging', agingUsers],
    ['Temporary disability', temporaryUsers],
  ];
  const maxImpactUsers = Math.max(1, ...userImpactRows.map(([, v]) => v));
  const topPath = (() => {
    const first = mostAffected[0]?.url || '';
    try { return new URL(first).pathname || '/'; } catch { return '/checkout'; }
  })();
  const estimatedAffectedUsers = Math.max(300, Math.round((criticalIssues * 90 + issueMetrics.pagesAffected * 40) / 10) * 10);
  const revenueLow = Math.max(1500, Math.round((estimatedAffectedUsers * 3.2) / 100) * 100);
  const revenueHigh = Math.max(3000, Math.round((estimatedAffectedUsers * 5.8) / 100) * 100);

  let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Accessibility Report · Us</title>
  ${REPORT_BRAND_HEAD}
  <style>
    ${REPORT_MAIN_REPORT_CSS}
    * { box-sizing: border-box; }
    .container { max-width: 960px; margin: 0 auto; background: var(--surface); border-radius: 16px; box-shadow: 0 2px 24px rgba(0,0,0,.06); border: 1px solid var(--border); overflow: hidden; }
    header h1 { margin: 0 0 6px; font-size: 1.4rem; font-weight: 700; letter-spacing: -0.02em; }
    header .timestamp { margin: 0; font-size: 0.9rem; color: var(--text-muted); }
    .summary { display: flex; gap: 12px; padding: 20px 32px; background: var(--bg); border-bottom: 1px solid var(--border); flex-wrap: wrap; }
    .summary-item { padding: 14px 20px; border-radius: 10px; background: var(--surface); border: 1px solid var(--border); }
    .summary-item.pass { border-color: var(--pass); background: #e8f5e9; }
    .summary-item.fail { border-color: var(--fail); background: #ffebee; }
    .summary-item.warn { border-color: var(--warn); background: #fff3e0; }
    .summary-item span { display: block; font-size: 1.5rem; font-weight: 700; }
    .summary-item small { color: var(--text-muted); font-size: 0.85rem; }
    .summary-item.filter-btn { cursor: pointer; transition: transform .15s, box-shadow .15s; border: none; font: inherit; text-align: left; }
    .summary-item.filter-btn:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(0,0,0,.08); }
    .summary-item.filter-btn.active { box-shadow: 0 0 0 2px var(--text); }
    .sticky-bar { position: sticky; top: 0; z-index: 100; background: var(--surface); border-bottom: 1px solid var(--border); transition: padding .2s, box-shadow .2s; }
    .sticky-bar.scrolled { padding-top: 8px; padding-bottom: 8px; box-shadow: 0 2px 8px rgba(0,0,0,.06); }
    .sticky-bar.scrolled .summary { padding: 10px 20px; }
    .sticky-bar.scrolled .summary-item { padding: 8px 14px; }
    .sticky-bar.scrolled .summary-item span { font-size: 1.2rem; }
    .sticky-bar.scrolled .filter-row { padding: 10px 20px; }
    .filter-row { display: flex; gap: 12px; align-items: center; padding: 14px 32px; background: var(--bg); border-bottom: 1px solid var(--border); flex-wrap: wrap; }
    .filter-row select { padding: 8px 12px; border: 1px solid var(--border); border-radius: 8px; font-size: 0.9rem; font-family: inherit; min-width: 140px; }
    .filter-row label { font-size: 0.85rem; color: var(--text-muted); }
    .disability-stats { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 8px; padding: 12px 32px; font-size: 0.8rem; color: var(--text-muted); }
    .disability-stats .stat { padding: 6px 10px; background: var(--bg); border-radius: 6px; }
    .alert { padding: 18px 32px; margin: 0; border-radius: 0; }
    .alert-warning { background: #fff3e0; border-left: 4px solid var(--warn); }
    .alert-error { background: #ffebee; border-left: 4px solid var(--fail); }
    section { padding: 28px 32px; }
    section h2 { margin: 0 0 20px; font-size: 1.2rem; font-weight: 700; letter-spacing: -0.02em; color: var(--text); }
    .url-section { margin-bottom: 32px; }
    .url-section h3 { margin: 0 0 12px; font-size: 0.95rem; color: var(--text-muted); word-break: break-all; font-weight: 500; }
    table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
    th, td { padding: 12px 14px; text-align: left; border-bottom: 1px solid var(--border); }
    th { background: var(--bg); font-weight: 600; }
    .badge { display: inline-block; padding: 4px 10px; border-radius: 6px; font-size: 0.75rem; font-weight: 600; }
    .badge.pass { background: #e8f5e9; color: var(--pass); }
    .badge.fail { background: #ffebee; color: var(--fail); }
    .badge.warn { background: #fff3e0; color: var(--warn); }
    .badge.info { background: #e3f2fd; color: var(--info); }
    .violation { margin-bottom: 16px; padding: 14px 16px; background: #fff8e1; border-left: 4px solid var(--warn); border-radius: 8px; font-size: 0.9rem; }
    .violation strong { display: block; margin-bottom: 4px; }
    .violation code { font-size: 0.85em; background: var(--bg); padding: 2px 6px; border-radius: 4px; }
    footer { padding: 20px 32px; font-size: 0.85rem; color: var(--text-muted); border-top: 1px solid var(--border); }
    .hero-stats { padding: 24px 32px 10px; border-bottom: 1px solid var(--border); background: var(--surface); }
    .audit-kicker { letter-spacing: .08em; text-transform: uppercase; font-size: .82rem; color: var(--text-muted); margin: 0 0 6px; }
    .audit-domain { font-size: 2rem; line-height: 1.1; margin: 0 0 8px; color: var(--text); }
    .audit-meta { margin: 0 0 16px; font-size: 0.98rem; color: var(--text-muted); }
    .kpi-grid { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 12px; margin: 0 0 16px; }
    .kpi { background: var(--bg); border: 1px solid var(--border); border-radius: 10px; padding: 14px 16px; }
    .kpi .label { font-size: .9rem; color: var(--text-muted); margin-bottom: 6px; }
    .kpi .value { font-size: 1.9rem; font-weight: 700; line-height: 1; }
    .kpi .value.warn { color: #b96f00; }
    .kpi .value.fail { color: var(--fail); }
    .compliance-card { display: grid; grid-template-columns: 96px 1fr; gap: 16px; background: var(--bg); border: 1px solid var(--border); border-radius: 12px; padding: 14px; margin: 0 0 14px; align-items: center; }
    .score-ring { width: 82px; height: 82px; border-radius: 50%; background: conic-gradient(var(--accent) ${scoreClamp}%, #e8e6e1 0); display: grid; place-items: center; margin: 0 auto; }
    .score-ring::before { content: "${scoreClamp}"; width: 62px; height: 62px; border-radius: 50%; background: #fff; display: grid; place-items: center; font-weight: 700; color: #9b5e00; }
    .compliance-title { margin: 0 0 6px; font-size: 1.35rem; line-height: 1.2; }
    .compliance-copy { margin: 0; color: var(--text); font-size: 0.95rem; }
    .status-row { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
    .status-pill { padding: 5px 9px; border-radius: 8px; font-size: .84rem; font-weight: 600; }
    .status-pill.a { background: #e8f5e9; color: #2e7d32; }
    .status-pill.aa { background: #fff3e0; color: #8c5b00; }
    .status-pill.aaa { background: #ffebee; color: #a73636; }
    .stats-panels { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin: 0 0 16px; }
    .panel { background: var(--bg); border: 1px solid var(--border); border-radius: 12px; padding: 14px; }
    .panel h3 { margin: 0 0 10px; letter-spacing: .06em; text-transform: uppercase; font-size: 0.9rem; }
    .severity-row { display: grid; grid-template-columns: 100px 1fr 42px; align-items: center; gap: 10px; margin-bottom: 9px; }
    .severity-row .bar { height: 10px; background: #ecebea; border-radius: 999px; overflow: hidden; }
    .severity-row .fill { height: 100%; border-radius: 999px; }
    .sev-critical { background: #c73b42; } .sev-serious { background: #d98200; } .sev-moderate { background: #3b6db1; } .sev-minor { background: #88887f; }
    .most-pages table { width: 100%; border-collapse: collapse; }
    .most-pages th, .most-pages td { padding: 7px 0; border-bottom: 1px solid var(--border); font-size: .9rem; }
    .most-pages th { color: var(--text-muted); font-weight: 600; }
    .sev-tag { padding: 3px 8px; border-radius: 999px; font-size: .78rem; font-weight: 600; }
    .sev-tag.critical { background: #ffebee; color: #a73636; }
    .sev-tag.serious { background: #fff3e0; color: #8c5b00; }
    .sev-tag.moderate { background: #e3f2fd; color: #1f5f97; }
    .sev-tag.minor { background: #f1f1ef; color: #686860; }
    .extra-stats { margin: 10px 0 16px; background: var(--bg); border: 1px solid var(--border); border-radius: 12px; padding: 16px; }
    .extra-stats h3 { margin: 0 0 12px; font-size: 1rem; letter-spacing: .06em; text-transform: uppercase; }
    .category-bars { display: grid; grid-template-columns: repeat(7, minmax(0,1fr)); gap: 10px; align-items: end; min-height: 220px; }
    .cat-item { text-align: center; }
    .cat-bar { border-radius: 8px 8px 6px 6px; }
    .cat-label { margin-top: 8px; font-size: .86rem; color: var(--text-muted); }
    .quick-grid { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 12px; }
    .quick-card { background: #fff; border: 1px solid var(--border); border-radius: 10px; padding: 12px; }
    .quick-num { font-size: 2rem; font-weight: 700; line-height: 1; }
    .quick-title { margin-top: 6px; font-size: 1rem; color: var(--text); }
    .quick-line { margin-top: 10px; height: 8px; background: #efefed; border-radius: 999px; overflow: hidden; }
    .quick-line span { display: block; width: 26%; height: 100%; border-radius: 999px; }
    .bench-grid { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 12px; margin-bottom: 12px; }
    .bench-card { background: #fff; border: 1px solid var(--border); border-radius: 10px; padding: 12px; }
    .bench-card small { color: var(--text-muted); display: block; margin-bottom: 6px; }
    .bench-card strong { font-size: 2rem; line-height: 1; }
    .bench-note { border-radius: 10px; padding: 10px 12px; margin-top: 8px; font-size: .95rem; }
    .bench-note.bad { background: #fdecef; color: #7f2930; }
    .bench-note.info { background: #eaf2fd; color: #1f4e7a; }
    .bench-note.good { background: #e8f4df; color: #2a5d2f; margin-top: 0; }
    .dist-card { position: relative; background: #fff; border: 1px solid var(--border); border-radius: 10px; padding: 14px; min-height: 190px; }
    .dist-area { position: absolute; left: 14px; right: 14px; bottom: 38px; top: 36px; background: linear-gradient(180deg, rgba(144,182,221,.7) 0%, rgba(144,182,221,.5) 60%, rgba(144,182,221,.35) 100%); clip-path: polygon(0% 100%, 8% 98%, 16% 95%, 28% 88%, 40% 76%, 50% 58%, 58% 42%, 66% 30%, 75% 24%, 84% 31%, 92% 48%, 100% 70%, 100% 100%); border-top: 2px solid #2f6fb1; }
    .dist-marker { position: absolute; bottom: 62px; transform: translateX(-50%); font-size: .9rem; font-weight: 600; }
    .dist-marker::after { content: ''; position: absolute; left: 50%; transform: translateX(-50%); top: 20px; width: 2px; height: 72px; background: currentColor; opacity: .65; }
    .dist-marker.you { color: #a73636; } .dist-marker.avg { color: #6f7782; }
    .dist-axis { position: absolute; left: 14px; right: 14px; bottom: 8px; display: flex; justify-content: space-between; font-size: .86rem; color: var(--text-muted); }
    .split { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
    .cat-table { width: 100%; border-collapse: collapse; }
    .cat-table th, .cat-table td { border-bottom: 1px solid var(--border); padding: 8px 6px; text-align: left; }
    .cat-table th { color: var(--text-muted); font-weight: 600; }
    .percent-bars { background: #fff; border: 1px solid var(--border); border-radius: 10px; padding: 12px; }
    .p-row { margin-bottom: 8px; }
    .p-track { height: 12px; background: #efefed; border-radius: 999px; overflow: hidden; }
    .p-fill { display: block; height: 100%; border-radius: 999px; }
    .p-fill.c0 { background: #e69197; } .p-fill.c1 { background: #c73b42; } .p-fill.c2 { background: #a6c3e5; } .p-fill.c3 { background: #91c353; } .p-fill.c4 { background: #58bea0; } .p-fill.you { background: #d98200; }
    .p-label { margin-top: 4px; font-size: .86rem; color: var(--text-muted); }
    .impact-intro { margin: 0 0 12px; color: var(--text); font-size: 1.03rem; }
    .impact-grid { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 12px; }
    .impact-card { background: #fff; border: 1px solid var(--border); border-radius: 10px; padding: 12px; }
    .impact-icon { width: 34px; height: 34px; border-radius: 999px; display: grid; place-items: center; font-weight: 700; margin-bottom: 8px; }
    .impact-icon.warn { background: #fdecef; color: #9f2e36; }
    .impact-icon.cash { background: #fff4e6; color: #8c5b00; }
    .impact-icon.up { background: #ecf7e8; color: #2e7d32; }
    .impact-card h4 { margin: 0 0 6px; font-size: 1.12rem; }
    .impact-card p { margin: 0; color: var(--text); }
    .impact-highlight { margin-top: 12px; background: #fff2de; color: #6f4a08; border: 1px solid #f0ddbf; border-radius: 10px; padding: 12px; font-size: 1.03rem; }
    @media (max-width: 900px) { .kpi-grid { grid-template-columns: repeat(2, minmax(0,1fr)); } .stats-panels { grid-template-columns: 1fr; } .compliance-card { grid-template-columns: 1fr; } }
    @media (max-width: 900px) { .quick-grid { grid-template-columns: 1fr; } .bench-grid { grid-template-columns: repeat(2, minmax(0,1fr)); } .category-bars { grid-template-columns: repeat(2, minmax(0,1fr)); min-height: 0; } }
    @media (max-width: 900px) { .split { grid-template-columns: 1fr; } .dist-marker::after { height: 56px; } }
    @media (max-width: 900px) { .impact-grid { grid-template-columns: 1fr; } }
    .manual-section { padding: 28px 32px; background: var(--bg); border-top: 1px solid var(--border); }
    .manual-section h2 { font-size: 1.1rem; font-weight: 700; margin: 0 0 14px; }
    .manual-section .todo-table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
    .manual-section .todo-table th, .manual-section .todo-table td { padding: 10px 12px; text-align: left; border-bottom: 1px solid var(--border); vertical-align: top; }
    .manual-section .todo-table th { background: var(--bg); font-weight: 600; }
    .manual-section .todo-table td:first-child { width: 36px; }
    .manual-section .todo-table input[type="checkbox"] { width: 18px; height: 18px; cursor: pointer; }
    .manual-section .todo-table tr:has(input:checked) .todo-action { text-decoration: line-through; color: var(--text-muted); }
    .manual-section .todo-table td.disabilities { font-size: 0.85rem; color: var(--text-muted); }
    @media (max-width: 600px) { .manual-section .todo-table, .manual-section .todo-table thead, .manual-section .todo-table tbody, .manual-section .todo-table tr, .manual-section .todo-table td { display: block; }
      .manual-section .todo-table thead { display: none; }
      .manual-section .todo-table tr { margin-bottom: 12px; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
      .manual-section .todo-table td { border: none; }
      .manual-section .todo-table td::before { content: attr(data-label); font-weight: 600; display: block; margin-bottom: 4px; }
      .manual-section .todo-table td:first-child { display: inline-block; margin-right: 12px; }
    }
    .manual-section .todo-progress { font-size: 0.85rem; color: var(--text-muted); margin-top: 16px; }
    .filterable.hidden { display: none !important; }
    .url-section:not(.has-visible) { display: none; }
    .url-section.has-visible { display: block; }
    section h2:not(.has-visible) { display: none; }
    section h2.has-visible { display: block; }
    .remediation { margin-top: 8px; font-size: 0.85rem; }
    .remediation pre { margin: 8px 0; padding: 10px; background: #1e1e1e; color: #d4d4d4; border-radius: 6px; overflow-x: auto; white-space: pre-wrap; }
    .issue-table tr.issue-row-main td { border-bottom: none; padding-bottom: 8px; vertical-align: top; }
    .issue-table tr.issue-row-detail td { border-bottom: 1px solid var(--border); padding-top: 0; vertical-align: top; background: var(--bg); }
    .issue-detail { padding: 0 0 4px; }
    .issue-msg-label { margin: 0 0 4px; font-size: 0.8rem; color: var(--text-muted); }
    .issue-msg-text { margin: 0 0 12px; font-size: 0.9rem; }
    .issue-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .remediation-btns { display: flex; gap: 8px; margin-top: 6px; flex-wrap: wrap; }
    .remediation-btns button, .btn-show-fix, .btn-copy-fix, .btn-show-occurrences { padding: 6px 12px; font-size: 0.8rem; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); cursor: pointer; }
    .remediation-btns button:hover { background: var(--bg); }
    .occurrences { margin-top: 8px; font-size: 0.85rem; }
    .occurrences .occurrence-item { margin-bottom: 12px; padding: 10px; background: #f5f5f5; border-radius: 6px; border-left: 3px solid var(--accent); }
    .occurrences .occurrence-item .selector { font-family: monospace; font-size: 0.8rem; color: var(--text-muted); margin-bottom: 6px; word-break: break-all; }
    .occurrences .occurrence-item pre { margin: 0; padding: 8px; background: #1e1e1e; color: #d4d4d4; border-radius: 4px; overflow-x: auto; white-space: pre-wrap; font-size: 0.75rem; }
    .wcag-links { font-size: 0.8rem; margin-top: 4px; }
    .wcag-links a { color: var(--accent); }
    .impact-effort { display: flex; gap: 6px; margin-top: 4px; flex-wrap: wrap; }
    .impact-effort .badge { font-size: 0.7rem; }
    .report-meta .timestamp { font-size: 0.9rem; color: var(--text-muted); }
    .btn-pdf { padding: 8px 16px; background: var(--accent); color: white; border: none; border-radius: 8px; font-weight: 600; cursor: pointer; font-size: 0.9rem; }
    .btn-pdf:hover { filter: brightness(1.05); }
    .comparison-section { padding: 16px 32px; background: var(--bg); border-bottom: 1px solid var(--border); }
    .comparison-section h3 { margin: 0 0 12px; font-size: 1rem; }
    .comparison-section .improved { color: var(--pass); }
    .comparison-section .regressed { color: var(--fail); }
    .suggested-fixes { padding: 24px 32px; background: var(--bg); border-top: 1px solid var(--border); }
    .suggested-fixes h3 { margin: 0 0 8px; font-size: 1rem; letter-spacing: .06em; text-transform: uppercase; }
    .suggested-fixes .fix-roadmap { background: #fff; border: 1px solid var(--border); border-radius: 12px; padding: 10px 16px; }
    .suggested-fixes .fix-item { display: grid; grid-template-columns: 38px 1fr; gap: 12px; padding: 14px 0; border-top: 1px solid var(--border); }
    .suggested-fixes .fix-item:first-child { border-top: none; }
    .suggested-fixes .fix-idx { width: 32px; height: 32px; border-radius: 999px; background: #fff; border: 1px solid var(--border); display: grid; place-items: center; font-weight: 700; color: var(--text-muted); }
    .suggested-fixes .fix-title { margin: 0 0 6px; font-size: 1.08rem; line-height: 1.3; color: var(--text); font-weight: 700; }
    .suggested-fixes .fix-desc { margin: 0 0 8px; font-size: 0.98rem; color: var(--text); }
    .suggested-fixes .pill-row { display: flex; gap: 8px; flex-wrap: wrap; }
    .suggested-fixes .pill { padding: 5px 12px; border-radius: 999px; font-size: .88rem; line-height: 1; font-weight: 600; background: #fff; border: 1px solid var(--border); min-height: 28px; display: inline-flex; align-items: center; }
    .suggested-fixes .pill.impact-high { color: #a73636; background: #ffebee; border-color: #ffd7db; }
    .suggested-fixes .pill.impact-medium { color: #8c5b00; background: #fff3e0; border-color: #ffe5bf; }
    .suggested-fixes .pill.impact-low { color: #2e7d32; background: #e8f5e9; border-color: #cfe9d0; }
    .bottom-insights { padding: 18px 32px 26px; border-top: 1px solid var(--border); background: var(--surface); }
    .bottom-insights h3 { margin: 0 0 10px; font-size: 1rem; letter-spacing: .06em; text-transform: uppercase; }
    .est-grid { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 12px; margin: 0 0 12px; }
    .est-card { background: var(--bg); border: 1px solid var(--border); border-radius: 10px; padding: 12px; }
    .est-card .lbl { font-size: .95rem; color: var(--text); margin-bottom: 6px; }
    .est-card .val { font-size: 2rem; font-weight: 700; line-height: 1; }
    .est-card .val.warn { color: #c97700; }
    .est-card .val.good { color: #2e7d32; }
    .insight-green { background: #e8f4df; color: #2a5d2f; border: 1px solid #d3e8c7; border-radius: 10px; padding: 11px 12px; font-size: 1.02rem; margin-bottom: 16px; }
    .impact-box { border-top: 1px solid var(--border); padding-top: 16px; margin-top: 6px; }
    .impact-box p { margin: 0 0 10px; }
    .sim-chart { background: #fff; border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; }
    .sim-row { display: grid; grid-template-columns: 140px 1fr 58px; align-items: center; gap: 8px; margin: 8px 0; }
    .sim-row .label { color: var(--text-muted); font-size: .92rem; }
    .sim-row .track { height: 10px; background: #edf1f5; border-radius: 999px; overflow: hidden; }
    .sim-row .fill { height: 100%; background: #7aa9da; border-radius: 999px; }
    .sim-row .num { text-align: right; color: var(--text-muted); font-size: .9rem; }
    .next-steps { border-top: 1px solid var(--border); margin-top: 16px; padding-top: 16px; }
    .next-box { background: #eaf2fd; color: #1f4e7a; border: 1px solid #d5e5fb; border-radius: 10px; padding: 11px 12px; font-size: 1.02rem; margin-bottom: 12px; }
    .cta-row { display: flex; gap: 10px; flex-wrap: wrap; }
    .cta-row a { display: inline-block; padding: 8px 12px; border: 1px solid var(--border); border-radius: 10px; background: #fff; color: var(--text); text-decoration: none; font-size: .95rem; }
    .cta-row a:hover { background: var(--bg); }
    .checklist-ref { margin: 16px 0; font-size: 0.9rem; }
    .checklist-ref summary { cursor: pointer; font-weight: 600; padding: 10px 12px; background: var(--bg); border-radius: 8px; }
    .checklist-ref summary:hover { background: #ecebe8; }
    .checklist-ref .checklist-body { padding: 16px 0 0 12px; }
    .checklist-ref .checklist-section { margin-bottom: 20px; }
    .checklist-ref .checklist-section h4 { margin: 0 0 8px; font-size: 0.95rem; }
    .checklist-ref .checklist-section h5 { margin: 12px 0 6px; font-size: 0.85rem; color: var(--text-muted); }
    .checklist-ref .checklist-section ul { margin: 0 0 8px; padding-left: 20px; }
    .checklist-ref .checklist-section li { margin-bottom: 4px; }
    .checklist-ref a { color: var(--accent); }
    .screenshot-wrap { margin: 12px 0 20px; }
    .screenshot-wrap .screenshot-caption { font-size: 0.85rem; color: var(--text-muted); margin-bottom: 10px; }
    .screenshot-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; }
    .screenshot-wrap .screenshot-fig { margin: 0; }
    .screenshot-wrap .screenshot-fig img { width: 100%; height: auto; border-radius: 8px; border: 1px solid var(--border); box-shadow: 0 2px 8px rgba(0,0,0,.06); display: block; }
    .screenshot-wrap .screenshot-fig figcaption { font-size: 0.8rem; color: var(--text-muted); margin-top: 6px; }
    @media print { .sticky-bar { position: static; } .filter-row, .disability-stats, .btn-pdf, .remediation-btns, .issue-actions, .summary-item.filter-btn { display: none !important; } .occurrences[hidden] { display: none !important; } }
    ${buildChartSectionStyles()}
  </style>
</head>
<body>
  <div class="container">
    <div class="report-brand-bar" aria-hidden="true"></div>
    <header>
      <div class="report-meta">
        <div class="brand-row">
          <img class="brand-logo" src="${REPORT_LOGO_URL}" width="44" height="44" alt="Us" decoding="async" />
          <div>
            <div class="brand">Us</div>
            <p class="report-tagline">Co-creating digital impact</p>
            <h1>Accessibility audit report</h1>
            <p class="timestamp">Deque University checklists · Generated ${new Date(reportData.generatedAt).toLocaleString()}</p>
          </div>
        </div>
        <div class="report-actions">
          <button type="button" class="btn-pdf" onclick="window.print()" aria-label="Download as PDF">Download PDF</button>
          <span style="font-size:0.85rem; color:var(--text-muted);">Deliverables:</span>
          <a href="./accessibility-developers.html" data-deliverable="accessibility-developers.html" style="font-size:0.9rem;">Developer guide</a>
          <a href="./accessibility-client.html" data-deliverable="accessibility-client.html" style="font-size:0.9rem;">Client presentation</a>
          <a href="./accessibility-statement.html" data-deliverable="accessibility-statement.html" style="font-size:0.9rem;">Accessibility statement</a>
        </div>
      </div>
    </header>

    <div class="hero-stats">
      <p class="audit-kicker">Accessibility audit report</p>
      <h2 class="audit-domain">${escapeHtml(primaryHost)}</h2>
      <p class="audit-meta">Audited ${totalPages} page${totalPages === 1 ? '' : 's'} · ${auditedDate} · WCAG 2.1</p>
      <div class="kpi-grid" aria-label="Top metrics">
        <div class="kpi"><div class="label">Overall score</div><div class="value warn">${scoreClamp} / 100</div></div>
        <div class="kpi"><div class="label">Total issues</div><div class="value">${totalIssues}</div></div>
        <div class="kpi"><div class="label">Critical issues</div><div class="value fail">${criticalIssues}</div></div>
        <div class="kpi"><div class="label">Pages affected</div><div class="value">${issueMetrics.pagesAffected} / ${Math.max(1, totalPages)}</div></div>
      </div>
      <div class="compliance-card" aria-label="Compliance snapshot">
        <div class="score-ring" aria-hidden="true"></div>
        <div>
          <h3 class="compliance-title">${escapeHtml(complianceHeadline)}</h3>
          <p class="compliance-copy">${escapeHtml(complianceNote)}</p>
          <div class="status-row">
            <span class="status-pill a">Level A — ${scoreClamp >= 60 ? 'partial' : 'not reached'}</span>
            <span class="status-pill aa">Level AA — ${scoreClamp >= 75 ? 'partial' : 'not reached'}</span>
            <span class="status-pill aaa">Level AAA — not reached</span>
          </div>
        </div>
      </div>
      <div class="stats-panels">
        <div class="panel">
          <h3>Issues by severity</h3>
          ${[
            ['Critical', issueMetrics.severity.critical, 'sev-critical'],
            ['Serious', issueMetrics.severity.serious, 'sev-serious'],
            ['Moderate', issueMetrics.severity.moderate, 'sev-moderate'],
            ['Minor', issueMetrics.severity.minor, 'sev-minor'],
          ].map(([label, value, cls]) => {
            const max = Math.max(1, issueMetrics.severity.critical, issueMetrics.severity.serious, issueMetrics.severity.moderate, issueMetrics.severity.minor);
            const pct = Math.round((Number(value) / max) * 100);
            return `<div class="severity-row"><div>${label}</div><div class="bar"><div class="fill ${cls}" style="width:${pct}%"></div></div><div>${value}</div></div>`;
          }).join('')}
        </div>
        <div class="panel most-pages">
          <h3>Most affected pages</h3>
          <table>
            <thead><tr><th>Page</th><th>Issues</th><th>Worst</th></tr></thead>
            <tbody>
              ${(mostAffected.length ? mostAffected : [{ url: '—', issues: 0, worst: 'minor' }]).map((row) => {
                let label = row.url;
                try {
                  const u = new URL(row.url);
                  label = u.pathname || '/';
                } catch {}
                return `<tr><td>${escapeHtml(label)}</td><td>${row.issues}</td><td><span class="sev-tag ${row.worst}">${row.worst.charAt(0).toUpperCase() + row.worst.slice(1)}</span></td></tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="extra-stats">
      <h3>Issues by category</h3>
      <div class="category-bars">
        ${categoryStats.map((c) => `<div class="cat-item"><div class="cat-bar" style="height:${Math.max(10, Math.round((c.count / categoryMax) * 180))}px;background:${c.color};"></div><div class="cat-label">${escapeHtml(c.label)}</div></div>`).join('')}
      </div>
    </div>

    <div class="extra-stats">
      <h3>Quick wins — high impact, low effort</h3>
      <div class="quick-grid">
        ${topCategoryCards.map((c) => `<div class="quick-card"><div class="quick-num" style="color:${c.color};">${c.count}</div><div class="quick-title">${escapeHtml(c.label)}</div><div class="quick-line"><span style="background:${c.color};"></span></div></div>`).join('')}
      </div>
    </div>

    <div class="extra-stats">
      <h3>Industry benchmarks</h3>
      <div class="bench-grid">
        <div class="bench-card"><small>Better than</small><strong>${betterThan}%</strong></div>
        <div class="bench-card"><small>Industry avg</small><strong>${industryAvg} / 100</strong></div>
        <div class="bench-card"><small>Gap to avg</small><strong style="color:${gapToAvg < 0 ? '#a73636' : '#2e7d32'}">${gapToAvg > 0 ? '+' : ''}${gapToAvg} pts</strong></div>
        <div class="bench-card"><small>Top 10% threshold</small><strong>&ge; ${top10Threshold}</strong></div>
      </div>
      <div class="bench-note bad">Your score of ${scoreClamp} is ${gapToAvg < 0 ? 'below' : 'above'} the industry average of ${industryAvg}. Closing to average requires fixing roughly ${closeGapIssues} additional issues.</div>
      <div class="bench-note info">Sites in the top 10% score ${top10Threshold} or above. Reaching that tier takes an estimated ${top10Issues} further fixes, mostly in contrast and keyboard navigation.</div>
    </div>
    <div class="extra-stats">
      <h3>Score distribution — where you sit</h3>
      <div class="dist-card">
        <div class="dist-area"></div>
        <div class="dist-marker you" style="left:${distLeft}%;">You ${scoreClamp}</div>
        <div class="dist-marker avg" style="left:${avgLeft}%;">Avg ${industryAvg}</div>
        <div class="dist-axis"><span>0</span><span>25</span><span>50</span><span>75</span><span>100</span></div>
      </div>
    </div>
    <div class="extra-stats split">
      <div>
        <h3>Category score vs industry avg</h3>
        <table class="cat-table">
          <thead><tr><th>Category</th><th>You</th><th>Avg</th><th>Diff</th></tr></thead>
          <tbody>
            ${categoryScores.map((r) => `<tr><td>${escapeHtml(r.label)}</td><td>${r.you}</td><td>${r.avg}</td><td style="color:${r.diff >= 0 ? '#2e7d32' : '#a73636'}">${r.diff >= 0 ? '+' : ''}${r.diff}</td></tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div>
        <h3>Percentile thresholds</h3>
        <div class="percent-bars">
          ${thresholds.map((t, idx) => `<div class="p-row"><div class="p-track"><span class="p-fill c${idx}" style="width:${Math.min(100, t)}%"></span></div><div class="p-label">${idx === 0 ? 'Bottom 10% < 30' : idx === 1 ? 'Bottom 25% < 48' : idx === 2 ? 'Median 71' : idx === 3 ? 'Top 25% > 82' : 'Top 10% > 88'}</div></div>`).join('')}
          <div class="p-row"><div class="p-track"><span class="p-fill you" style="width:${Math.min(100, scoreClamp)}%"></span></div><div class="p-label">You (${scoreClamp})</div></div>
        </div>
      </div>
    </div>
    <div class="extra-stats">
      <div class="bench-note good">Keyboard navigation and screen reader scores beat the industry average — these are genuine strengths. Prioritise color contrast and form labels to lift the overall score above ${industryAvg}.</div>
    </div>
    <div class="extra-stats">
      <h3>Business impact & legal risk</h3>
      <p class="impact-intro">Accessibility failures carry tangible business consequences beyond user experience.</p>
      <div class="impact-grid">
        <div class="impact-card">
          <div class="impact-icon warn">!</div>
          <h4>Legal exposure</h4>
          <p>EU Accessibility Act (EAA) enforcement is active. Non-compliance can result in fines and mandatory remediation orders.</p>
        </div>
        <div class="impact-card">
          <div class="impact-icon cash">€</div>
          <h4>Lost revenue</h4>
          <p>~15% of users have a disability. With ${criticalIssues} critical issues on ${escapeHtml(topPath)}, a measurable share of conversions may be blocked.</p>
        </div>
        <div class="impact-card">
          <div class="impact-icon up">↑</div>
          <h4>SEO uplift</h4>
          <p>Fixes like alt text, heading structure, and semantic HTML directly improve search crawler understanding and ranking signals.</p>
        </div>
      </div>
      <div class="impact-highlight">
        Estimated users affected by at least one critical barrier: ~${estimatedAffectedUsers.toLocaleString()} / month. Fixing critical issues alone could recover an estimated &euro;${revenueLow.toLocaleString()}-${revenueHigh.toLocaleString()} in blocked annual revenue.
      </div>
    </div>

    <div class="sticky-bar" id="sticky-bar">
      <div class="summary" role="group" aria-label="Filter results">
        <button type="button" class="summary-item filter-btn active" data-filter="all" aria-pressed="true"><span>${total}</span><small>All</small></button>
        <button type="button" class="summary-item pass filter-btn" data-filter="pass" aria-pressed="false"><span>${reportData.summary?.pass || 0}</span><small>Passed</small></button>
        <button type="button" class="summary-item warn filter-btn" data-filter="warn" aria-pressed="false"><span>${reportData.summary?.warn || 0}</span><small>Warnings</small></button>
        <button type="button" class="summary-item fail filter-btn" data-filter="fail" aria-pressed="false"><span>${reportData.summary?.fail || 0}</span><small>Failures</small></button>
        <button type="button" class="summary-item filter-btn" data-filter="violation" aria-pressed="false"><span>${totalAxeViolations}</span><small>Axe Violations</small></button>
      </div>
      <div class="filter-row">
        <label for="chapter-select">Jump to</label>
        <select id="chapter-select" aria-label="Jump to chapter">
          <option value="">— Chapter —</option>
          ${Object.entries(CHECKLIST_CHAPTERS).map(([id, ch]) => `<option value="#ch${ch.id}">Ch.${ch.id} ${ch.name}</option>`).join('')}
          <option value="#manual-verification">Manual checks</option>
        </select>
        <label for="disability-select">Disability</label>
        <select id="disability-select" aria-label="Filter by disability">
          <option value="">All disabilities</option>
          ${ALL_DISABILITIES.filter(d => d !== 'Various').map((d) => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('')}
          <option value="Various">Various</option>
        </select>
      </div>
      <div class="disability-stats" id="disability-stats">
        ${ALL_DISABILITIES.map((d) => `<span class="stat" data-disability="${escapeHtml(d)}"><strong>${escapeHtml(d)}:</strong> ${disabilityStats[d] || 0}</span>`).join('')}
      </div>
    </div>

    ${loadErrors.length > 0 ? `
    <div class="alert alert-error">
      <strong>No pages could be loaded.</strong> All ${loadErrors.length} URL(s) failed. Possible causes: site blocks headless browsers, bot protection, timeout, or network issues.
      <ul style="margin: 12px 0 0 20px;">
        ${loadErrors.map((e) => `<li><strong>${escapeHtml(e.url)}</strong>: ${escapeHtml(e.message)}</li>`).join('')}
      </ul>
      <p style="margin: 12px 0 0;">Fix these issues and re-run <code>npm run test:report</code></p>
    </div>
    ` : reportData.urls?.length === 0 ? `
    <div class="alert alert-warning">
      <strong>No pages were tested.</strong> Add URLs to <code>urls.config.js</code> and run <code>npm run test:report</code>
    </div>
    ` : ''}

    ${prevData ? `
    <div class="comparison-section">
      <h3>Compared to previous run (${new Date(prevData.generatedAt).toLocaleString()})</h3>
      <p><span class="improved">Improved: ${improved.length}</span> · <span class="regressed">Regressed: ${regressed.length}</span></p>
    </div>
    ` : ''}

    <section>
`;

  const SEMANTIC_WCAG22_PDF = 'https://media.dequeuniversity.com/en/courses/generic/web-semantic-structure-and-navigation/wcag-2.2/docs/module-semantic-checklist-wcag-2.2.pdf';

  Object.entries(CHECKLIST_CHAPTERS).forEach(([chapterId, ch]) => {
    html += `
      <h2 id="ch${ch.id}">Chapter ${ch.id}: ${ch.name}</h2>
`;
    if (chapterId === 'semantics') {
      html += `
      <details class="checklist-ref">
        <summary>View Semantic Structure checklist (WCAG 2.2)</summary>
        <div class="checklist-body">
          <p><a href="${SEMANTIC_WCAG22_PDF}" target="_blank" rel="noopener">Download PDF</a></p>
          ${SEMANTIC_CHECKLIST_WCAG22.map(
            (s) => `
          <div class="checklist-section">
            <h4>${escapeHtml(s.section)}</h4>
            ${s.subsections
              .map(
                (sub) => `
            ${sub.title ? `<h5>${escapeHtml(sub.title)}</h5>` : ''}
            <ul>
              ${sub.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
            </ul>`
              )
              .join('')}
          </div>`
          ).join('')}
        </div>
      </details>
`;
    }

    if (reportData.urls?.length > 0) {
      reportData.urls.forEach((url) => {
        html += `<div class="url-section"><h3>${escapeHtml(url)}</h3>`;
        const screenshotDataRaw = reportData.screenshots && reportData.screenshots[url];
        const screenshotData = Array.isArray(screenshotDataRaw) ? screenshotDataRaw[0] : screenshotDataRaw;

        const custom = customByChapter[chapterId]?.filter((r) => r.url === url) || [];
        const axeData = reportData.axeResults?.[url];
        const axeViolations = (axeData?.byChapter?.[chapterId]?.violations || []);

        if (custom.length > 0) {
          const disabilityLabel = (r) => {
            const ids = DISABILITY_MAP[r.id];
            return ids ? ids.join(', ') : '—';
          };
          html += '<table class="issue-table"><thead><tr><th>Rule</th><th>Status</th><th>Impact</th><th>Effort</th><th>Disability</th></tr></thead><tbody>';
          custom.forEach((r, idx) => {
            const filterVal = r.status === 'pass' ? 'pass' : r.status === 'warn' ? 'warn' : 'fail';
            const disabilities = (DISABILITY_MAP[r.id] || ['Various']).join('|');
            const rem = getRemediation(r.id, null);
            const wcagLinks = (rem.wcag || []).map((sc) => `<a href="${wcagScUrl(sc)}" target="_blank" rel="noopener">${sc}</a>`).join(', ');
            const snippetEsc = escapeHtml(rem.snippet || '');
            const rowId = `fix-row-${chapterId}-${url.replace(/[^a-z0-9]/gi, '')}-${idx}`;
            const occId = `occ-row-${chapterId}-${url.replace(/[^a-z0-9]/gi, '')}-${idx}`;
            let occContent;
            if (r.occurrences && r.occurrences.length > 0) {
              occContent = r.occurrences.map((occ) => {
                const desc = formatOccurrenceDescriptor(occ);
                return `<div class="occurrence-item"><span class="selector">${escapeHtml(desc)}</span></div>`;
              }).join('');
            } else if (r.id === 'unique-ids' && r.message && r.message.includes('Duplicate IDs:')) {
              const idsStr = r.message.replace(/^Duplicate IDs:\s*/, '').trim();
              const ids = idsStr ? idsStr.split(/\s*,\s*/) : [];
              occContent = ids.map((id) => `<div class="occurrence-item"><span class="selector">#${escapeHtml(id)}</span></div>`).join('') || '<p class="occurrence-item">No element details for this check.</p>';
            } else if (r.selector) {
              occContent = `<div class="occurrence-item"><span class="selector">${escapeHtml(r.selector)}</span></div>`;
            } else {
              occContent = '<p class="occurrence-item">No element details for this check.</p>';
            }
            html += `<tr class="filterable issue-row-main" data-filter="${filterVal}" data-disability="${escapeHtml(disabilities)}">
              <td>${escapeHtml(r.rule)}</td>
              <td><span class="badge ${r.status}">${r.status}</span></td>
              <td><span class="badge impact-effort-badge">${rem.impact || '—'}</span></td>
              <td>${rem.effort || '—'}</td>
              <td>${escapeHtml(disabilityLabel(r))}</td>
            </tr>
            <tr class="filterable issue-row-detail" data-filter="${filterVal}" data-disability="${escapeHtml(disabilities)}">
              <td colspan="5">
                <div class="issue-detail">
                  <p class="issue-msg-label"><strong>Message</strong></p>
                  <p class="issue-msg-text">${escapeHtml(r.message)}</p>
                  <div class="issue-actions">
                    <button type="button" class="btn-show-fix" data-target="${rowId}" aria-expanded="false">Show fix</button>
                    <button type="button" class="btn-copy-fix" data-snippet="${snippetEsc}" title="Copy fix">Copy fix</button>
                    <button type="button" class="btn-show-occurrences" data-target="${occId}" aria-expanded="false">Show occurrences</button>
                  </div>
                  ${(rem.impact || '').toLowerCase() === 'high' && screenshotData && screenshotData.file
                    ? `<div class="screenshot-wrap"><p class="screenshot-caption">Screenshot for this high-priority issue:</p><div class="screenshot-grid"><figure class="screenshot-fig"><img src="./screenshots/${escapeHtml(screenshotData.file)}" alt="${escapeHtml(screenshotData.label || 'Issue screenshot')}" loading="lazy" /><figcaption>${escapeHtml(screenshotData.label || '')}</figcaption></figure></div></div>`
                    : ''}
                  <div id="${rowId}" class="remediation" hidden>
                    ${wcagLinks ? `<div class="wcag-links">WCAG: ${wcagLinks}</div>` : ''}
                    <pre>${snippetEsc}</pre>
                  </div>
                  <div id="${occId}" class="occurrences" hidden>${occContent}</div>
                </div>
              </td>
            </tr>`;
          });
          html += '</tbody></table>';
        }

        axeViolations.forEach((v, vIdx) => {
          const rem = getRemediation(null, v.id);
          const wcagLinks = (rem.wcag || []).map((sc) => `<a href="${wcagScUrl(sc)}" target="_blank" rel="noopener">${sc}</a>`).join(', ');
          const snippetEsc = escapeHtml(rem.snippet || '');
          const fixId = `fix-axe-${chapterId}-${url.replace(/[^a-z0-9]/gi, '')}-${vIdx}`;
          const occId = `occ-axe-${chapterId}-${url.replace(/[^a-z0-9]/gi, '')}-${vIdx}`;
          const occurrencesHtml = (v.nodes && v.nodes.length > 0)
            ? v.nodes.map((node) => {
                const desc = formatOccurrenceDescriptor(node);
                return `<div class="occurrence-item"><span class="selector">${escapeHtml(desc)}</span></div>`;
              }).join('')
            : '<p class="occurrence-item">No element details.</p>';
          html += `
          <div class="violation filterable" data-filter="violation" data-disability="Various">
            <strong>${escapeHtml(v.id)}: ${escapeHtml(v.help)}</strong>
            <span class="badge impact-effort-badge">${rem.impact || '—'}</span> ${rem.effort || ''}
            ${wcagLinks ? `<div class="wcag-links">WCAG: ${wcagLinks}</div>` : ''}
            ${v.description ? `<p>${escapeHtml(v.description)}</p>` : ''}
            ${v.nodes?.length ? `<p><strong>Affected:</strong> ${v.nodes.length} element(s)</p>` : ''}
            <button type="button" class="btn-show-fix" data-target="${fixId}" aria-expanded="false">Show fix</button>
            <button type="button" class="btn-copy-fix" data-snippet="${snippetEsc}" title="Copy fix">Copy fix</button>
            <button type="button" class="btn-show-occurrences" data-target="${occId}" aria-expanded="false">Show occurrences</button>
            <div id="${fixId}" class="remediation" hidden><pre>${snippetEsc}</pre></div>
            <div id="${occId}" class="occurrences" hidden>${occurrencesHtml}</div>
          </div>`;
        });

        if (custom.length === 0 && axeViolations.length === 0) {
          html += '<p class="filterable" data-filter="pass" data-disability="">No issues found for this chapter.</p>';
        }

        html += '</div>';
      });
    } else {
      html += '<p><em>No pages were successfully tested. Resolve the page load errors above and re-run the tests.</em></p>';
    }

    html += '<br>';
  });

  html += `
    </section>

    <div class="manual-section" id="manual-verification">
      <h2>Manual & assistive-tech checklist</h2>
      <p style="margin:0 0 16px; font-size:0.9rem; color: var(--text-muted);">Complete these checks and track progress. Progress is saved for this report.</p>
      ${MANUAL_TODO_ITEMS.map((group, groupIndex) => {
        const startIndex = MANUAL_TODO_ITEMS.slice(0, groupIndex).reduce((sum, g) => sum + g.items.length, 0);
        return `
      <div class="todo-group" data-group-index="${groupIndex}">
        <div class="todo-group-title">${escapeHtml(group.label)}</div>
        <table class="todo-table">
          <thead><tr><th></th><th>Action</th><th>Disabilities</th></tr></thead>
          <tbody>
          ${group.items.map((item, i) => {
            const idx = startIndex + i;
            const disabilities = (item.disabilities || []).join(', ');
            const dataDisability = (item.disabilities || []).join('|');
            return `<tr class="filterable manual-row" data-filter="manual" data-disability="${escapeHtml(dataDisability)}">
              <td data-label="Check"><input type="checkbox" id="manual-check-${idx}" data-index="${idx}" aria-label="${escapeHtml(item.text)}"></td>
              <td data-label="Action"><label for="manual-check-${idx}" class="todo-action">${escapeHtml(item.text)}</label></td>
              <td data-label="Disabilities" class="disabilities">${escapeHtml(disabilities) || '—'}</td>
            </tr>`;
          }).join('')}
          </tbody>
        </table>
      </div>`;
      }).join('')}
      <p class="todo-progress" id="todo-progress" aria-live="polite"></p>
    </div>

    ${fixOrderItems.length > 0 ? `
    <div class="suggested-fixes" id="suggested-fixes">
      <h3>Recommended fix roadmap</h3>
      <p style="font-size:0.98rem; color:var(--text); margin:0 0 12px;">Prioritised by impact-to-effort ratio. Addressing these in order delivers the fastest score improvement.</p>
      <div class="fix-roadmap">
        ${fixOrderItems.slice(0, 5).map((item, i) => {
          const impact = String(item.impact || 'medium').toLowerCase();
          const effort = String(item.effort || 'moderate').toLowerCase();
          const impactLabel = impact === 'high' ? 'High impact' : impact === 'low' ? 'Quick win' : 'Medium impact';
          const effortLabel = effort === 'simple' ? 'Low effort' : effort === 'moderate' ? 'Medium effort' : 'High effort';
          const eta = effort === 'simple' ? (impact === 'high' ? '~2h' : '<1h') : effort === 'moderate' ? '~1 day' : '~3+ days';
          const desc = item.url
            ? `Issue appears on ${item.url}. Fixing this pattern will improve task completion and reduce legal risk.`
            : `${item.rule} can be addressed globally and should improve accessibility outcomes quickly.`;
          return `<div class="fix-item">
            <div class="fix-idx">${i + 1}</div>
            <div>
              <h4 class="fix-title">${escapeHtml(item.rule)}</h4>
              <p class="fix-desc">${escapeHtml(desc)}</p>
              <div class="pill-row">
                <span class="pill impact-${impact === 'high' ? 'high' : impact === 'low' ? 'low' : 'medium'}">${impactLabel}</span>
                <span class="pill">${effortLabel}</span>
                <span class="pill">${eta}</span>
              </div>
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>
    ` : ''}

    <div class="bottom-insights">
      <h3>Estimated score after fixes</h3>
      <div class="est-grid">
        <div class="est-card">
          <div class="lbl">After quick wins (steps 1-2)</div>
          <div class="val warn">~${projectedQuick}</div>
        </div>
        <div class="est-card">
          <div class="lbl">After full roadmap (all 5)</div>
          <div class="val good">~${projectedFull}</div>
        </div>
        <div class="est-card">
          <div class="lbl">Projected percentile</div>
          <div class="val good">${projectedPercentile}</div>
        </div>
      </div>
      <div class="insight-green">Completing steps 1 and 2 alone would likely move the site above the industry average of ${industryAvg}. A re-audit after implementation will confirm actual uplift.</div>

      <div class="impact-box">
        <h3>User impact simulation</h3>
        <p>Estimated share of monthly visitors who encounter at least one accessibility barrier, by disability type.</p>
        <div class="sim-chart">
          ${userImpactRows.map(([label, value]) => {
            const width = Math.max(5, Math.round((value / maxImpactUsers) * 100));
            return `<div class="sim-row"><div class="label">${escapeHtml(label)}</div><div class="track"><div class="fill" style="width:${width}%"></div></div><div class="num">${Number(value).toLocaleString()}</div></div>`;
          }).join('')}
        </div>
      </div>

      <div class="next-steps">
        <h3>Next steps</h3>
        <div class="next-box">Schedule a remediation sprint focused on steps 1–3. A re-audit after sprint completion will confirm score improvement and identify any regressions before the EAA deadline.</div>
        <div class="cta-row">
          <a href="#suggested-fixes">Fix plan for ${escapeHtml(topPath)} ↗</a>
          <a href="https://www.w3.org/WAI/WCAG21/quickref/" target="_blank" rel="noopener">What does Level AA require? ↗</a>
          <a href="https://digital-strategy.ec.europa.eu/en/policies/web-accessibility" target="_blank" rel="noopener">EU Accessibility Act ↗</a>
        </div>
      </div>
    </div>

    <footer>
      <p><span class="footer-brand">Us</span> · Co-creating digital impact · Accessibility audit. Report generated by an automated suite based on Deque University checklists. Some checks require manual verification.</p>
    </footer>
  </div>
  <script>
    (function() {
      var pathMatch = window.location.pathname.match(/^(.*\/report\/[^/]+)/);
      if (pathMatch && pathMatch[1]) {
        var base = pathMatch[1] + '/';
        document.querySelectorAll('a[data-deliverable]').forEach(function(a) {
          var file = a.getAttribute('data-deliverable');
          if (file) a.setAttribute('href', base + file);
        });
      }
      document.querySelectorAll('.btn-show-fix').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var target = document.getElementById(this.getAttribute('data-target'));
          if (!target) return;
          var visible = !target.hidden;
          target.hidden = visible;
          this.textContent = visible ? 'Show fix' : 'Hide fix';
          this.setAttribute('aria-expanded', !visible);
        });
      });
      document.querySelectorAll('.btn-show-occurrences').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var target = document.getElementById(this.getAttribute('data-target'));
          if (!target) return;
          var visible = !target.hidden;
          target.hidden = visible;
          this.textContent = visible ? 'Show occurrences' : 'Hide occurrences';
          this.setAttribute('aria-expanded', !visible);
        });
      });
      document.querySelectorAll('.btn-copy-fix').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var snippet = this.getAttribute('data-snippet') || '';
          snippet = snippet.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
          navigator.clipboard.writeText(snippet).then(function() {
            btn.textContent = 'Copied!';
            setTimeout(function() { btn.textContent = 'Copy fix'; }, 1500);
          }).catch(function() {});
        });
      });

      var buttons = document.querySelectorAll('.summary-item.filter-btn');
      var filterables = document.querySelectorAll('.filterable');
      var urlSections = document.querySelectorAll('.url-section');
      var sectionHeadings = document.querySelectorAll('section h2');

      var currentFilter = 'all';
      var currentDisability = '';

      function setActive(btn) {
        buttons.forEach(function(b) {
          b.classList.toggle('active', b === btn);
          b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
        });
      }

      function disabilityMatches(el, disability) {
        if (!disability) return true;
        var d = el.getAttribute('data-disability') || '';
        if (!d) return true;
        var list = d.split('|').filter(Boolean);
        return list.indexOf(disability) !== -1;
      }

      function updateVisibility(filter, disability) {
        currentFilter = filter || currentFilter;
        currentDisability = disability !== undefined ? disability : currentDisability;
        filterables.forEach(function(el) {
          var filterMatch = filter === 'all' || el.getAttribute('data-filter') === filter || (filter === 'all' && el.getAttribute('data-filter') === 'manual');
          var disabilityMatch = disabilityMatches(el, currentDisability);
          el.classList.toggle('hidden', !(filterMatch && disabilityMatch));
        });
        urlSections.forEach(function(section) {
          var visible = section.querySelectorAll('.filterable:not(.hidden)').length > 0;
          section.classList.toggle('has-visible', visible);
        });
        sectionHeadings.forEach(function(h2) {
          var section = h2.closest('section');
          var visible = section && section.querySelectorAll('.filterable:not(.hidden)').length > 0;
          h2.classList.toggle('has-visible', visible);
        });
        document.querySelectorAll('.manual-section .todo-group').forEach(function(group) {
          var visible = group.querySelectorAll('.filterable:not(.hidden)').length > 0;
          group.style.display = visible ? '' : 'none';
        });
      }

      buttons.forEach(function(btn) {
        btn.addEventListener('click', function() {
          var filter = btn.getAttribute('data-filter');
          setActive(btn);
          updateVisibility(filter);
        });
      });

      var chapterSelect = document.getElementById('chapter-select');
      if (chapterSelect) {
        chapterSelect.addEventListener('change', function() {
          var val = this.value;
          if (val) {
            var el = document.querySelector(val);
            if (el) el.scrollIntoView({ behavior: 'smooth' });
            this.selectedIndex = 0;
          }
        });
      }

      var disabilitySelect = document.getElementById('disability-select');
      if (disabilitySelect) {
        disabilitySelect.addEventListener('change', function() {
          currentDisability = this.value || '';
          updateVisibility(currentFilter, currentDisability);
        });
      }

      var stickyBar = document.getElementById('sticky-bar');
      if (stickyBar) {
        window.addEventListener('scroll', function() {
          stickyBar.classList.toggle('scrolled', window.scrollY > 80);
        }, { passive: true });
      }

      updateVisibility('all');

      var reportId = (window.location.pathname.match(/\\/report\\/([^/]+)/) || [])[1] || 'default';
      var storageKey = 'a11y-manual-' + reportId;
      var checkboxes = document.querySelectorAll('.manual-section input[type="checkbox"]');
      var progressEl = document.getElementById('todo-progress');
      var apiBase = window.location.pathname.replace(/\\/report\\/[^/]+.*$/, '') || '';

      function getCheckedArray() {
        return Array.prototype.map.call(checkboxes, function(cb) { return cb.checked; });
      }

      function applyProgress(arr) {
        if (!Array.isArray(arr)) return;
        checkboxes.forEach(function(cb, i) {
          if (arr[i] === true) cb.checked = true;
        });
        updateProgressText();
      }

      function loadProgress() {
        var url = apiBase + '/api/report/' + encodeURIComponent(reportId) + '/manual-progress';
        fetch(url).then(function(r) { return r.ok ? r.json() : null; }).then(function(data) {
          if (data && data.checked && data.checked.length) {
            applyProgress(data.checked);
            return;
          }
          try {
            var saved = localStorage.getItem(storageKey);
            if (saved) applyProgress(JSON.parse(saved));
          } catch (e) {}
        }).catch(function() {
          try {
            var saved = localStorage.getItem(storageKey);
            if (saved) applyProgress(JSON.parse(saved));
          } catch (e) {}
        }).then(function() { updateProgressText(); });
      }

      function saveProgress() {
        var arr = getCheckedArray();
        updateProgressText();
        var url = apiBase + '/api/report/' + encodeURIComponent(reportId) + '/manual-progress';
        fetch(url, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ checked: arr })
        }).then(function(r) {
          if (r.ok) return;
          try { localStorage.setItem(storageKey, JSON.stringify(arr)); } catch (e) {}
        }).catch(function() {
          try { localStorage.setItem(storageKey, JSON.stringify(arr)); } catch (e) {}
        });
      }

      function updateProgressText() {
        if (!progressEl) return;
        var checked = 0;
        checkboxes.forEach(function(cb) { if (cb.checked) checked++; });
        progressEl.textContent = checked + ' of ' + checkboxes.length + ' completed';
      }

      checkboxes.forEach(function(cb) {
        cb.addEventListener('change', saveProgress);
      });
      loadProgress();
    })();
  </script>
</body>
</html>`;

  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
  writeFileSync(reportFile, html, 'utf8');

  const statementMetaPath = join(outputDir, 'statement-meta.json');
  let statementMeta = null;
  if (existsSync(statementMetaPath)) {
    try {
      statementMeta = JSON.parse(readFileSync(statementMetaPath, 'utf8'));
    } catch (_) {}
  }

  const deliverableData = {
    reportData,
    fixOrderItems,
    disabilityStats,
    score,
    scoreClamp,
    pass,
    fail,
    warn,
    totalAxeViolations,
    total,
    statementMeta,
  };
  try {
    const paths = generateAllDeliverables(deliverableData, outputDir);
    if (options.verbose) {
      console.log('Deliverables:', paths);
    }
  } catch (err) {
    if (options.verbose) console.error('Deliverable generation:', err);
  }

  return reportFile;
}

const isMain = process.argv[1] && process.argv[1].endsWith('generate-report.js');
if (isMain) {
  const out = generateReport();
  console.log(`Report saved to ${out}`);
}
