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
  buildChartDataPayload,
  buildChartsSectionHtml,
  buildChartSectionStyles,
} from './report-summary.js';

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

  const chartPayload = buildChartDataPayload(reportData, {
    pass,
    fail,
    warn,
    totalAxeViolations,
    scoreClamp,
  });

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

  let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Accessibility Report · Us</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root { --pass: #2e7d32; --fail: #c62828; --warn: #ed6c02; --info: #1565c0; --bg: #f8f7f4; --surface: #fff; --text: #1a1a1a; --text-muted: #5c5c5c; --accent: #2d9d78; --border: #e8e6e1; }
    * { box-sizing: border-box; }
    body { font-family: 'Plus Jakarta Sans', system-ui, sans-serif; margin: 0; padding: 0; background: var(--bg); color: var(--text); line-height: 1.5; }
    .container { max-width: 960px; margin: 0 auto; background: var(--surface); border-radius: 16px; box-shadow: 0 2px 24px rgba(0,0,0,.06); border: 1px solid var(--border); overflow: hidden; }
    header { padding: 28px 32px; border-bottom: 1px solid var(--border); }
    header .brand { font-size: 1.25rem; font-weight: 700; letter-spacing: -0.02em; }
    header h1 { margin: 0 0 6px; font-size: 1.4rem; font-weight: 700; letter-spacing: -0.02em; }
    header p { margin: 0; font-size: 0.9rem; color: var(--text-muted); }
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
    .score-hero { padding: 32px 32px 28px; text-align: center; border-bottom: 1px solid var(--border); background: var(--bg); }
    .score-value { font-size: 4rem; font-weight: 700; line-height: 1; letter-spacing: -0.04em; color: var(--text); }
    .score-value.good { color: var(--pass); }
    .score-value.mid { color: var(--warn); }
    .score-value.low { color: var(--fail); }
    .score-label { font-size: 0.9rem; color: var(--text-muted); margin-top: 6px; }
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
    .fix-order-list { margin: 0; padding-left: 20px; }
    .fix-order-list li { margin-bottom: 8px; }
    .report-meta { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; }
    .report-meta .timestamp { font-size: 0.9rem; color: var(--text-muted); }
    .btn-pdf { padding: 8px 16px; background: var(--accent); color: white; border: none; border-radius: 8px; font-weight: 600; cursor: pointer; font-size: 0.9rem; }
    .btn-pdf:hover { filter: brightness(1.05); }
    .comparison-section { padding: 16px 32px; background: var(--bg); border-bottom: 1px solid var(--border); }
    .comparison-section h3 { margin: 0 0 12px; font-size: 1rem; }
    .comparison-section .improved { color: var(--pass); }
    .comparison-section .regressed { color: var(--fail); }
    .suggested-fixes { padding: 20px 32px; background: #f0f7f4; border-top: 1px solid var(--border); }
    .suggested-fixes h3 { margin: 0 0 12px; font-size: 1rem; }
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
    @media print { .sticky-bar { position: static; } .filter-row, .disability-stats, .btn-pdf, .remediation-btns, .btn-show-occurrences, .summary-item.filter-btn { display: none !important; } .occurrences[hidden] { display: none !important; } }
    ${buildChartSectionStyles()}
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="report-meta">
        <div>
          <div class="brand">Us</div>
          <h1>Accessibility audit report</h1>
          <p class="timestamp">Deque University checklists · Generated ${new Date(reportData.generatedAt).toLocaleString()}</p>
        </div>
        <div style="display:flex; gap:12px; align-items:center; flex-wrap:wrap;">
          <button type="button" class="btn-pdf" onclick="window.print()" aria-label="Download as PDF">Download PDF</button>
          <span style="font-size:0.85rem; color:var(--text-muted);">Deliverables:</span>
          <a href="./accessibility-developers.html" style="font-size:0.9rem;">Developer guide</a>
          <a href="./accessibility-client.html" style="font-size:0.9rem;">Client presentation</a>
          <a href="./accessibility-statement.html" style="font-size:0.9rem;">Accessibility statement</a>
        </div>
      </div>
    </header>

    <div class="score-hero" aria-label="Overall accessibility score">
      <div class="score-value ${scoreClamp >= 80 ? 'good' : scoreClamp >= 50 ? 'mid' : 'low'}" aria-hidden="true">${scoreClamp}</div>
      <div class="score-label">out of 100</div>
      <p class="score-explanation" style="font-size:0.8rem; color:var(--text-muted); margin:8px 0 0;">Custom checks + Axe rules: passed / total (WCAG-oriented)</p>
    </div>

    ${buildChartsSectionHtml(chartPayload, 'a11y-chart-data-main')}

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
        const screenshotData = reportData.screenshots && reportData.screenshots[url];
        const showScreenshots = chapterId === Object.keys(CHECKLIST_CHAPTERS)[0] && screenshotData;
        if (showScreenshots) {
          const items = Array.isArray(screenshotData) ? screenshotData : [{ file: screenshotData, label: 'Screenshot' }];
          html += '<div class="screenshot-wrap"><p class="screenshot-caption">Viewport screenshots (desktop) when issues were found:</p><div class="screenshot-grid">';
          items.forEach((s) => {
            html += `<figure class="screenshot-fig"><img src="./screenshots/${escapeHtml(s.file)}" alt="${escapeHtml(s.label || 'Screenshot')}" loading="lazy" /><figcaption>${escapeHtml(s.label || '')}</figcaption></figure>`;
          });
          html += '</div></div>';
        }

        const custom = customByChapter[chapterId]?.filter((r) => r.url === url) || [];
        const axeData = reportData.axeResults?.[url];
        const axeViolations = (axeData?.byChapter?.[chapterId]?.violations || []);

        if (custom.length > 0) {
          const disabilityLabel = (r) => {
            const ids = DISABILITY_MAP[r.id];
            return ids ? ids.join(', ') : '—';
          };
          html += '<table><thead><tr><th>Rule</th><th>Status</th><th>Impact</th><th>Effort</th><th>Disability</th><th>Message</th><th>Fix</th></tr></thead><tbody>';
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
            html += `<tr class="filterable" data-filter="${filterVal}" data-disability="${escapeHtml(disabilities)}">
              <td>${escapeHtml(r.rule)}</td>
              <td><span class="badge ${r.status}">${r.status}</span></td>
              <td><span class="badge impact-effort-badge">${rem.impact || '—'}</span></td>
              <td>${rem.effort || '—'}</td>
              <td>${escapeHtml(disabilityLabel(r))}</td>
              <td>${escapeHtml(r.message)}</td>
              <td>
                <button type="button" class="btn-show-fix" data-target="${rowId}" aria-expanded="false">Show fix</button>
                <button type="button" class="btn-copy-fix" data-snippet="${snippetEsc}" title="Copy fix">Copy fix</button>
                <button type="button" class="btn-show-occurrences" data-target="${occId}" aria-expanded="false">Show occurrences</button>
                <div id="${rowId}" class="remediation" hidden>
                  ${wcagLinks ? `<div class="wcag-links">WCAG: ${wcagLinks}</div>` : ''}
                  <pre>${snippetEsc}</pre>
                </div>
                <div id="${occId}" class="occurrences" hidden>${occContent}</div>
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
      <h3>Suggested fix order (by impact and effort)</h3>
      <p style="font-size:0.9rem; color:var(--text-muted); margin:0 0 12px;">Prioritize high-impact, simple fixes first.</p>
      <ol class="fix-order-list" start="1">
        ${fixOrderItems.map((item, i) => {
          const wcagStr = (item.wcag || []).map((sc) => `<a href="${wcagScUrl(sc)}" target="_blank" rel="noopener">${sc}</a>`).join(', ');
          return `<li><strong>${escapeHtml(item.rule)}</strong> ${item.url ? `(${escapeHtml(item.url)})` : ''} — Impact: ${item.impact}, Effort: ${item.effort}${wcagStr ? ` — WCAG: ${wcagStr}` : ''}</li>`;
        }).join('')}
      </ol>
    </div>
    ` : ''}

    <footer>
      <p>Us · Accessibility audit. Report generated by an automated suite based on Deque University checklists. Some checks require manual verification.</p>
    </footer>
  </div>
  <script>
    (function() {
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
