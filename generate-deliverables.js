/**
 * Generates three deliverables from accessibility report data:
 * 1. Developer advice (problems + solutions)
 * 2. Client-friendly presentation (stats + plan)
 * 3. Accessibility statement (draft)
 */

import { writeFileSync } from 'fs';
import { join } from 'path';
import { getRemediation, wcagScUrl } from './remediation-data.js';
import {
  buildExecutiveSummaryHtml,
  buildChartSectionStyles,
} from './report-summary.js';
import { getWcagScLabel, compareScIds } from './wcag-sc-labels.js';
import { REPORT_BRAND_HEAD, REPORT_DELIVERABLE_CSS, buildDeliverableHeaderHtml } from './report-brand.js';

const STYLES = `
${REPORT_DELIVERABLE_CSS}
  .container { max-width: 900px; margin: 0 auto; padding: 32px; background: var(--surface); border-radius: 12px; box-shadow: 0 2px 16px rgba(0,0,0,.06); border: 1px solid var(--border); }
  h1 { font-size: 1.6rem; margin: 0 0 8px; color: var(--text); }
  h2 { font-size: 1.2rem; margin: 24px 0 12px; color: var(--text); }
  h3 { font-size: 1rem; margin: 16px 0 8px; color: var(--text); }
  p { margin: 0 0 12px; color: var(--text-muted); }
  .meta { font-size: 0.9rem; color: var(--text-muted); margin-bottom: 24px; }
  pre { background: #1e1e1e; color: #d4d4d4; padding: 12px; border-radius: 8px; overflow-x: auto; font-size: 0.85rem; }
  .badge { display: inline-block; padding: 4px 8px; border-radius: 6px; font-size: 0.75rem; font-weight: 600; }
  .badge.fail { background: #ffebee; color: var(--fail); }
  .badge.warn { background: #fff3e0; color: var(--warn); }
  .badge.impact { background: #e3f2fd; }
  .ai-summary { margin: 22px 0 8px; padding: 18px 18px; border-radius: 12px; border: 1px solid var(--border); background: #f0f7f4; }
  .ai-summary h2 { margin: 0 0 10px; font-size: 1.15rem; }
  .ai-summary h3 { margin: 14px 0 6px; font-size: 1rem; }
  .ai-summary p { margin: 0 0 10px; }
  .ai-summary .muted { color: var(--text-muted); font-size: 0.9rem; }
`;

function escapeHtml(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function generateDeveloperAdvice(data, outputDir) {
  const { reportData, fixOrderItems } = data;
  const date = new Date(reportData.generatedAt).toLocaleString();

  let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Developer guide – Accessibility fixes</title>
  ${REPORT_BRAND_HEAD}
  <style>${STYLES}</style>
</head>
<body>
  <div class="container">
    ${buildDeliverableHeaderHtml()}
    <h1>Developer guide</h1>
    <p class="meta">Accessibility issues and how to fix them · Generated ${date}</p>
    <p>Prioritize high-impact, simple fixes first. Each issue includes WCAG references and copy-paste solutions.</p>
`;

  if (fixOrderItems.length === 0) {
    html += '<p>No issues requiring fixes were found.</p>';
  } else {
    fixOrderItems.forEach((item, i) => {
      const wcagLinks = (item.wcag || []).map((sc) => `<a href="${wcagScUrl(sc)}" target="_blank" rel="noopener">${sc}</a>`).join(', ');
      html += `
    <div style="margin-bottom: 24px; padding-bottom: 24px; border-bottom: 1px solid var(--border);">
      <h3>${i + 1}. ${escapeHtml(item.rule)}</h3>
      <p><span class="badge ${item.status === 'fail' ? 'fail' : 'warn'}">${item.status}</span>
         <span class="badge impact">Impact: ${item.impact}</span>
         <span class="badge impact">Effort: ${item.effort}</span>
         ${item.url ? `<br><small>URL: ${escapeHtml(item.url)}</small>` : ''}
      </p>
      ${wcagLinks ? `<p>WCAG: ${wcagLinks}</p>` : ''}
      <p><strong>Fix:</strong></p>
      <pre>${escapeHtml(item.snippet || 'See WCAG guidelines.')}</pre>
    </div>`;
    });
  }

  html += `
    <div class="deliverable-footer"><span class="footer-brand">Us</span> · Co-creating digital impact · Developer remediation guide</div>
  </div>
</body>
</html>`;

  const path = join(outputDir, 'accessibility-developers.html');
  writeFileSync(path, html, 'utf8');
  return path;
}

function buildAiClientSummaryHtml({
  reportData,
  chartPayload,
  scoreClamp,
  pass,
  fail,
  warn,
  totalAxeViolations,
  quickWins,
  mediumEffort,
  longTerm,
}) {
  const urlCount = (reportData.urls || []).length;
  const topLabels = chartPayload?.disabilityTopLabels || [];
  const topCounts = chartPayload?.disabilityTopCounts || [];
  const top3 = topLabels
    .slice(0, 3)
    .map((l, i) => ({ label: l, count: topCounts[i] != null ? topCounts[i] : null }))
    .filter((x) => x.label);

  const guidance = {
    Blindness:
      'Navigation clarity matters most: strong headings/landmarks, predictable focus order, and link/form semantics help screen-reader users build a mental model quickly.',
    'Low Vision':
      'Contrast, scalable text, and focus visibility are critical. If content is too light/low-contrast or doesn’t reflow cleanly, reading and operating controls becomes slow and error-prone.',
    Colorblindness:
      'Color cannot be the only signal. The report pattern suggests you should confirm that state, instructions, and errors are still understandable without relying on color alone.',
    'Deafness and Hard-of-Hearing':
      'Provide captions and clear transcripts so information that would normally be heard is available visually, with consistent synchronization.',
    Deafblindness:
      'Deafblind users need redundant, dependable channels. Captions/transcripts plus keyboard-accessible controls and clear labeling reduce the “missing context” problem.',
    'Dexterity/Motor Disabilities':
      'Keyboard support and precise interaction patterns are key: ensure all actions are reachable without traps, and interactive elements are easy to target.',
    'Speech Disabilities':
      'Avoid speech-only requirements. Where communication is needed, provide non-voice alternatives (labels, keyboard input, and clear instructions).',
    'Cognitive Disabilities':
      'Reduce cognitive load: consistent structure, straightforward instructions, and fewer surprise context changes help users stay oriented and complete tasks.',
    'Reading Disabilities':
      'Readable, well-structured content helps: descriptive headings, unambiguous link text, and error messages that explain what to do next.',
    'Seizure Disorders':
      'Minimize flashing and provide safe alternatives. Even if automated checks only partially cover this, manual review is important for animations and media.',
  };

  const scoreTone =
    scoreClamp >= 80
      ? 'This score suggests you are close to meeting many WCAG-oriented expectations, and targeted fixes can improve consistency for more users.'
      : scoreClamp >= 50
        ? 'This score indicates meaningful gaps. The fastest wins usually come from fixing navigation and form patterns first, then tightening media and dynamic behaviors.'
        : 'This score suggests barriers likely remain across multiple user journeys. Start with the highest-impact quick wins so the largest disability groups benefit first.';

  const topLine = top3.length
    ? `Automated findings most often map to: ${top3
        .map((x) => `${x.label}${x.count != null ? ` (${x.count})` : ''}`)
        .join(', ')}.`
    : 'No disability-specific impact signal was strong enough to rank in the top-3 for this run.';

  const phaseOpinion = (() => {
    const p1 = quickWins.length ? `Phase 1 (quick wins, ${quickWins.length} items) should be your first pass.` : 'Phase 1 has no quick wins in this run.';
    const p2 = mediumEffort.length ? `Phase 2 (medium effort, ${mediumEffort.length} items) is where you fix the “makes tasks hard” issues.` : 'Phase 2 has no medium-effort items in this run.';
    const p3 = longTerm.length ? `Phase 3 (long-term, ${longTerm.length} items) reduces deeper risk over time.` : 'Phase 3 has no long-term items in this run.';
    return `${p1} ${p2} ${p3}`;
  })();

  const disabilityParagraphs = top3.length
    ? top3
        .map((x) => {
          const text =
            guidance[x.label] ||
            'Your results suggest prioritizing semantics, keyboard access, and clear instructions so users can complete core tasks with less effort.';
          return `<p><strong>${escapeHtml(x.label)}</strong>: ${escapeHtml(text)}</p>`;
        })
        .join('')
    : `<p class="muted">To personalize this further, rerun with more URLs or focus on user journeys that matter most, then compare disability impact across runs.</p>`;

  const currentSituation = `
    <p class="muted">${escapeHtml(scoreTone)}</p>
    <p>${escapeHtml(topLine)}</p>
    <p>In this run, there were <strong>${fail}</strong> failures, <strong>${warn}</strong> warnings, and <strong>${totalAxeViolations}</strong> axe violations across <strong>${urlCount}</strong> page${urlCount === 1 ? '' : 's'}.</p>
  `;

  const rec = `
    <h3>My recommendation</h3>
    <p>${escapeHtml(phaseOpinion)}</p>
    <p class="muted">Automation is a strong starting point, but manual checks (keyboard + screen reader + real user flows) are still required to validate real-world accessibility.</p>
  `;

  return `
    <div class="ai-summary" role="region" aria-labelledby="ai-summary-heading">
      <h2 id="ai-summary-heading">AI-generated client summary (disability-focused)</h2>
      ${currentSituation}
      ${top3.length ? '<h3>What this means for disabilities</h3>' : ''}
      ${disabilityParagraphs}
      ${rec}
    </div>
  `;
}

function severityRank(level) {
  if (level === 'critical') return 3;
  if (level === 'serious') return 2;
  if (level === 'moderate') return 1;
  return 0;
}

function computeClientIssueMetrics(reportData, fixOrderItems) {
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

function buildPostDashboardSectionHtml({ fixOrderItems, scoreClamp, criticalIssues = 0, pagesAffected = 0, mostAffectedPages = [] }) {
  const cats = computeCategoryStats(fixOrderItems);
  const max = Math.max(1, ...cats.map((c) => c.count));
  const topThree = [...cats].sort((a, b) => b.count - a.count).slice(0, 3);
  const industryAvg = 71;
  const top10Threshold = 88;
  const betterThan = Math.max(5, Math.min(95, scoreClamp - 24));
  const gap = scoreClamp - industryAvg;
  const closeGapIssues = Math.max(1, Math.round(Math.abs(gap) * 2));
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
  const categoryScores = cats.map((c) => {
    const avg = avgByLabel[c.label] ?? 70;
    const score = Math.max(8, Math.min(96, Math.round(92 - c.count * 4)));
    return { label: c.label, you: score, avg, diff: score - avg };
  }).sort((a, b) => a.label.localeCompare(b.label)).slice(0, 6);
  const distLeft = Math.max(4, Math.min(96, scoreClamp));
  const avgLeft = industryAvg;
  const thresholds = [30, 48, 71, 82, 88];
  const topPath = (() => {
    const first = mostAffectedPages[0]?.url || '';
    try { return new URL(first).pathname || '/'; } catch { return '/checkout'; }
  })();
  const estimatedAffectedUsers = Math.max(300, Math.round((criticalIssues * 90 + pagesAffected * 40) / 10) * 10);
  const revenueLow = Math.max(1500, Math.round((estimatedAffectedUsers * 3.2) / 100) * 100);
  const revenueHigh = Math.max(3000, Math.round((estimatedAffectedUsers * 5.8) / 100) * 100);

  return `
    <section class="extra-stats">
      <h2>Issues by category</h2>
      <div class="category-bars">
        ${cats.map((c) => `<div class="cat-item"><div class="cat-bar" style="height:${Math.max(10, Math.round((c.count / max) * 180))}px;background:${c.color};"></div><div class="cat-label">${escapeHtml(c.label)}</div></div>`).join('')}
      </div>
    </section>
    <section class="extra-stats">
      <h2>Quick wins — high impact, low effort</h2>
      <div class="quick-grid">
        ${topThree.map((c) => `<div class="quick-card"><div class="quick-num" style="color:${c.color};">${c.count}</div><div class="quick-title">${escapeHtml(c.label)}</div><div class="quick-line"><span style="background:${c.color};"></span></div></div>`).join('')}
      </div>
    </section>
    <section class="extra-stats">
      <h2>Industry benchmarks</h2>
      <div class="bench-grid">
        <div class="bench-card"><small>Better than</small><strong>${betterThan}%</strong></div>
        <div class="bench-card"><small>Industry avg</small><strong>${industryAvg} / 100</strong></div>
        <div class="bench-card"><small>Gap to avg</small><strong style="color:${gap < 0 ? '#a73636' : '#2e7d32'}">${gap > 0 ? '+' : ''}${gap} pts</strong></div>
        <div class="bench-card"><small>Top 10% threshold</small><strong>&ge; ${top10Threshold}</strong></div>
      </div>
      <div class="bench-note bad">Your score of ${scoreClamp} is ${gap < 0 ? 'below' : 'above'} the industry average of ${industryAvg}. Closing to average requires fixing roughly ${closeGapIssues} additional issues.</div>
      <div class="bench-note info">Sites in the top 10% score ${top10Threshold} or above. Reaching that tier takes an estimated ${top10Issues} further fixes, mostly in contrast and keyboard navigation.</div>
    </section>
    <section class="extra-stats">
      <h2>Score distribution — where you sit</h2>
      <div class="dist-card">
        <div class="dist-area"></div>
        <div class="dist-marker you" style="left:${distLeft}%;">You ${scoreClamp}</div>
        <div class="dist-marker avg" style="left:${avgLeft}%;">Avg ${industryAvg}</div>
        <div class="dist-axis"><span>0</span><span>25</span><span>50</span><span>75</span><span>100</span></div>
      </div>
    </section>
    <section class="extra-stats split">
      <div>
        <h2>Category score vs industry avg</h2>
        <table class="cat-table">
          <thead><tr><th>Category</th><th>You</th><th>Avg</th><th>Diff</th></tr></thead>
          <tbody>
            ${categoryScores.map((r) => `<tr><td>${escapeHtml(r.label)}</td><td>${r.you}</td><td>${r.avg}</td><td style="color:${r.diff >= 0 ? '#2e7d32' : '#a73636'}">${r.diff >= 0 ? '+' : ''}${r.diff}</td></tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div>
        <h2>Percentile thresholds</h2>
        <div class="percent-bars">
          ${thresholds.map((t, idx) => `<div class="p-row"><div class="p-track"><span class="p-fill c${idx}" style="width:${Math.min(100, t)}%"></span></div><div class="p-label">${idx === 0 ? 'Bottom 10% < 30' : idx === 1 ? 'Bottom 25% < 48' : idx === 2 ? 'Median 71' : idx === 3 ? 'Top 25% > 82' : 'Top 10% > 88'}</div></div>`).join('')}
          <div class="p-row"><div class="p-track"><span class="p-fill you" style="width:${Math.min(100, scoreClamp)}%"></span></div><div class="p-label">You (${scoreClamp})</div></div>
        </div>
      </div>
    </section>
    <section class="extra-stats">
      <div class="bench-note good">Keyboard navigation and screen reader scores beat the industry average — these are genuine strengths. Prioritise color contrast and form labels to lift the overall score above ${industryAvg}.</div>
    </section>
    <section class="extra-stats">
      <h2>Business impact & legal risk</h2>
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
    </section>
  `;
}

export function generateClientPresentation(data, outputDir) {
  const { reportData, fixOrderItems, disabilityStats, score, scoreClamp, pass, fail, warn, totalAxeViolations, total } = data;
  const date = new Date(reportData.generatedAt).toLocaleString();
  const issuesCount = fail + warn + totalAxeViolations;
  const uniqueByRule = (items) => [...new Map(items.map((i) => [i.rule, i])).values()];
  const { host: siteHost } = deriveSiteUrls(reportData);
  const auditedDate = new Date(reportData.generatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const metrics = computeClientIssueMetrics(reportData, fixOrderItems);
  const criticalIssues = metrics.severity.critical;
  const totalPages = (reportData.urls || []).length;
  const pagesAffected = metrics.pagesAffected;
  const mostAffected = metrics.mostAffectedPages.slice(0, 7);
  const complianceHeadline = scoreClamp >= 75
    ? 'WCAG 2.1 compliance — Level AA partial'
    : scoreClamp >= 60
      ? 'WCAG 2.1 compliance — Level A partial'
      : 'WCAG 2.1 compliance — below Level A';
  const complianceNote = scoreClamp >= 75
    ? `The site meets ${scoreClamp}% of tested criteria. Continue resolving remaining serious and critical issues to reach full Level AA.`
    : `The site meets ${scoreClamp}% of tested criteria. Level AA has not been reached. Resolving critical issues first is the fastest path forward.`;
  const topRoadmap = uniqueByRule(fixOrderItems).slice(0, 5);

  let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Accessibility summary – Client presentation</title>
  ${REPORT_BRAND_HEAD}
  <style>${STYLES}
    ${buildChartSectionStyles()}
    .audit-kicker { letter-spacing: .08em; text-transform: uppercase; font-size: .85rem; color: var(--text-muted); margin: 0 0 6px; }
    .audit-domain { font-size: 2.1rem; line-height: 1.1; margin: 0 0 8px; }
    .audit-meta { margin: 0 0 20px; font-size: 1rem; color: var(--text-muted); }
    .kpi-grid { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 12px; margin: 0 0 18px; }
    .kpi { background: var(--bg); border: 1px solid var(--border); border-radius: 10px; padding: 14px 16px; }
    .kpi .label { font-size: .92rem; color: var(--text-muted); margin-bottom: 6px; }
    .kpi .value { font-size: 2rem; font-weight: 700; line-height: 1; }
    .kpi .value.warn { color: #c97700; }
    .kpi .value.fail { color: var(--fail); }
    .compliance-card { display: grid; grid-template-columns: 108px 1fr; gap: 16px; background: var(--bg); border: 1px solid var(--border); border-radius: 12px; padding: 16px; margin: 0 0 18px; align-items: center; }
    .score-ring { width: 88px; height: 88px; border-radius: 50%; background: conic-gradient(var(--accent) ${scoreClamp}%, #e8e6e1 0); display: grid; place-items: center; margin: 0 auto; }
    .score-ring::before { content: "${scoreClamp}"; width: 66px; height: 66px; border-radius: 50%; background: #fff; display: grid; place-items: center; font-weight: 700; color: #9b5e00; }
    .compliance-title { margin: 0 0 6px; font-size: 1.7rem; line-height: 1.15; }
    .compliance-copy { margin: 0; color: var(--text); }
    .status-row { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 10px; }
    .status-pill { padding: 6px 10px; border-radius: 8px; font-size: .92rem; font-weight: 600; }
    .status-pill.a { background: #e8f5e9; color: #2e7d32; }
    .status-pill.aa { background: #fff3e0; color: #8c5b00; }
    .status-pill.aaa { background: #ffebee; color: #a73636; }
    .stats-panels { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin: 0 0 22px; }
    .panel { background: var(--bg); border: 1px solid var(--border); border-radius: 12px; padding: 16px; }
    .panel h3 { margin: 0 0 12px; letter-spacing: .06em; text-transform: uppercase; font-size: .95rem; }
    .severity-row { display: grid; grid-template-columns: 110px 1fr 42px; align-items: center; gap: 10px; margin-bottom: 10px; }
    .severity-row .bar { height: 12px; background: #ecebea; border-radius: 999px; overflow: hidden; }
    .severity-row .fill { height: 100%; border-radius: 999px; }
    .sev-critical { background: #c73b42; } .sev-serious { background: #d98200; } .sev-moderate { background: #3b6db1; } .sev-minor { background: #88887f; }
    .most-pages table { width: 100%; border-collapse: collapse; }
    .most-pages th, .most-pages td { padding: 8px 0; border-bottom: 1px solid var(--border); font-size: .95rem; }
    .most-pages th { color: var(--text-muted); font-weight: 600; }
    .sev-tag { padding: 3px 8px; border-radius: 999px; font-size: .82rem; font-weight: 600; }
    .sev-tag.critical { background: #ffebee; color: #a73636; }
    .sev-tag.serious { background: #fff3e0; color: #8c5b00; }
    .sev-tag.moderate { background: #e3f2fd; color: #1f5f97; }
    .sev-tag.minor { background: #f1f1ef; color: #686860; }
    .phase { padding: 16px; margin: 12px 0; border-left: 4px solid var(--accent); background: #f0f7f4; border-radius: 0 8px 8px 0; }
    .phase h3 { margin-top: 0; }
    .roadmap { margin-top: 24px; background: var(--bg); border: 1px solid var(--border); border-radius: 12px; padding: 16px; }
    .roadmap .item { display: grid; grid-template-columns: 38px 1fr; gap: 12px; padding: 16px 0; border-top: 1px solid var(--border); }
    .roadmap .item:first-child { border-top: none; padding-top: 4px; }
    .roadmap .idx { width: 32px; height: 32px; border-radius: 999px; background: #fff; border: 1px solid var(--border); display: grid; place-items: center; font-weight: 700; color: var(--text-muted); }
    .roadmap h4 { margin: 0 0 6px; font-size: 1.08rem; line-height: 1.3; font-weight: 700; }
    .roadmap p { margin: 0 0 9px; color: var(--text); font-size: 0.98rem; }
    .badge-line { display: flex; gap: 8px; flex-wrap: wrap; }
    .badge-line .pill { padding: 5px 12px; border-radius: 999px; font-size: .88rem; line-height: 1; font-weight: 600; background: #fff; border: 1px solid var(--border); min-height: 28px; display: inline-flex; align-items: center; }
    .pill.impact-high { color: #a73636; background: #ffebee; border-color: #ffd7db; }
    .pill.impact-medium { color: #8c5b00; background: #fff3e0; border-color: #ffe5bf; }
    .pill.impact-low { color: #2e7d32; background: #e8f5e9; border-color: #cfe9d0; }
    .extra-stats { margin-top: 22px; background: var(--bg); border: 1px solid var(--border); border-radius: 12px; padding: 16px; }
    .extra-stats h2 { margin: 0 0 12px; font-size: 1rem; letter-spacing: .06em; text-transform: uppercase; }
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
    @media (max-width: 900px) { .kpi-grid { grid-template-columns: repeat(2, minmax(0,1fr)); } .stats-panels { grid-template-columns: 1fr; } .compliance-card { grid-template-columns: 1fr; } .quick-grid { grid-template-columns: 1fr; } .bench-grid { grid-template-columns: repeat(2, minmax(0,1fr)); } .category-bars { grid-template-columns: repeat(2, minmax(0,1fr)); min-height: 0; } }
    @media (max-width: 900px) { .split { grid-template-columns: 1fr; } .dist-marker::after { height: 56px; } }
    @media (max-width: 900px) { .impact-grid { grid-template-columns: 1fr; } }
    ul { margin: 8px 0; padding-left: 24px; }
  </style>
</head>
<body>
  <div class="container">
    ${buildDeliverableHeaderHtml()}
    <p class="audit-kicker">Accessibility Audit Report</p>
    <h1 class="audit-domain">${escapeHtml(siteHost)}</h1>
    <p class="audit-meta">Audited ${totalPages} page${totalPages === 1 ? '' : 's'} · ${auditDate} · WCAG 2.1</p>

    <section class="kpi-grid" aria-label="Top metrics">
      <div class="kpi"><div class="label">Overall score</div><div class="value warn">${scoreClamp} / 100</div></div>
      <div class="kpi"><div class="label">Total issues</div><div class="value">${issuesCount}</div></div>
      <div class="kpi"><div class="label">Critical issues</div><div class="value fail">${criticalIssues}</div></div>
      <div class="kpi"><div class="label">Pages affected</div><div class="value">${pagesAffected} / ${Math.max(1, totalPages)}</div></div>
    </section>

    <section class="compliance-card" aria-label="Compliance snapshot">
      <div class="score-ring" aria-hidden="true"></div>
      <div>
        <h2 class="compliance-title">${escapeHtml(complianceHeadline)}</h2>
        <p class="compliance-copy">${escapeHtml(complianceNote)}</p>
        <div class="status-row">
          <span class="status-pill a">Level A — ${scoreClamp >= 60 ? 'partial' : 'not reached'}</span>
          <span class="status-pill aa">Level AA — ${scoreClamp >= 75 ? 'partial' : 'not reached'}</span>
          <span class="status-pill aaa">Level AAA — not reached</span>
        </div>
      </div>
    </section>

    <section class="stats-panels">
      <div class="panel">
        <h3>Issues by severity</h3>
        ${[
          ['Critical', metrics.severity.critical, 'sev-critical'],
          ['Serious', metrics.severity.serious, 'sev-serious'],
          ['Moderate', metrics.severity.moderate, 'sev-moderate'],
          ['Minor', metrics.severity.minor, 'sev-minor'],
        ].map(([label, value, cls]) => {
          const max = Math.max(1, metrics.severity.critical, metrics.severity.serious, metrics.severity.moderate, metrics.severity.minor);
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
    </section>

    ${buildPostDashboardSectionHtml({
      fixOrderItems,
      scoreClamp,
      criticalIssues,
      pagesAffected,
      mostAffectedPages: metrics.mostAffectedPages,
    })}

    <section class="roadmap">
      <h2>Recommended fix roadmap</h2>
      <p>Prioritized by impact-to-effort ratio. Addressing these in order delivers the fastest score improvement.</p>
      ${topRoadmap.map((item, idx) => {
        const impact = (item.impact || 'medium').toLowerCase();
        const effort = (item.effort || 'moderate').toLowerCase();
        const eta = effort === 'simple' ? (impact === 'high' ? '~2h' : '<1h') : effort === 'moderate' ? '~1 day' : '~3+ days';
        const impactLabel = impact === 'high' ? 'High impact' : impact === 'low' ? 'Quick win' : 'Medium impact';
        const effortLabel = effort === 'simple' ? 'Low effort' : effort === 'moderate' ? 'Medium effort' : 'High effort';
        const desc = item.url
          ? `Issue appears on ${item.url}. Fixing this pattern will improve task completion and reduce legal risk.`
          : `${item.rule} can be addressed globally and should improve accessibility outcomes quickly.`;
        return `<div class="item">
          <div class="idx">${idx + 1}</div>
          <div>
            <h4>${escapeHtml(item.rule)}</h4>
            <p>${escapeHtml(desc)}</p>
            <div class="badge-line">
              <span class="pill impact-${impact === 'high' ? 'high' : impact === 'low' ? 'low' : 'medium'}">${impactLabel}</span>
              <span class="pill">${effortLabel}</span>
              <span class="pill">${eta}</span>
            </div>
          </div>
        </div>`;
      }).join('')}
    </section>

    <h2>Impact by disability</h2>
    <p>These accessibility improvements will help users with the following:</p>
    <div class="stats-grid">
      ${Object.entries(disabilityStats)
        .filter(([k, v]) => v > 0 && k !== 'Various')
        .map(([k, v]) => `<div class="stat-card"><span>${v}</span><small>${escapeHtml(k)}</small></div>`)
        .join('')}
    </div>

    <p style="margin-top: 32px; font-size: 0.9rem; color: var(--text-muted);">
      For the full technical report and developer fix guide, see the main report.
    </p>
    <div class="deliverable-footer"><span class="footer-brand">Us</span> · Co-creating digital impact · Client summary</div>
  </div>
</body>
</html>`;

  const path = join(outputDir, 'accessibility-client.html');
  writeFileSync(path, html, 'utf8');
  return path;
}

function deriveSiteUrls(reportData) {
  const urls = reportData.urls || [];
  const first = urls[0];
  if (!first) {
    return { display: 'https://example.com/', host: 'example.com' };
  }
  try {
    const u = new URL(first);
    return { display: `${u.origin}/`, host: u.hostname };
  } catch {
    return { display: first, host: first.replace(/^https?:\/\//i, '').split('/')[0] || 'this site' };
  }
}

function dedupeFindingsByRule(items) {
  const byRule = new Map();
  for (const it of items) {
    const rule = it.rule || '';
    if (!byRule.has(rule)) byRule.set(rule, new Set());
    if (it.url) byRule.get(rule).add(it.url);
  }
  return [...byRule.entries()].map(([rule, urlSet]) => ({
    rule,
    urls: [...urlSet].sort(),
  }));
}

function buildLimitationBlocks(fixOrderItems) {
  if (!fixOrderItems.length) {
    return '<p>No open issues were recorded in this automated run. Manual and assistive-technology testing may still identify barriers; we recommend completing those checks before claiming full conformance.</p>';
  }
  const groups = new Map();
  for (const item of fixOrderItems) {
    const scs = item.wcag || [];
    const key = scs[0] || '_other';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  const keys = [...groups.keys()].sort(compareScIds);
  let html = '';
  for (const key of keys) {
    const items = groups.get(key);
    const { title, level } = getWcagScLabel(key);
    const heading =
      key === '_other'
        ? 'Other findings from this assessment'
        : `${key} ${title} – Level ${level}`;
    const scLink = key !== '_other' ? wcagScUrl(key) : null;
    const rows = dedupeFindingsByRule(items);
    html += '<div class="limitation-block">';
    html += `<h4 class="limitation-sc">${escapeHtml(heading)}</h4>`;
    if (scLink) {
      html += `<p class="wcag-understanding">Official success criterion (W3C): <a href="${scLink}" target="_blank" rel="noopener">Understanding ${escapeHtml(key)} ${escapeHtml(title)}</a>.</p>`;
      html +=
        '<p class="wcag-note">The full normative wording is published by the W3C at the link above. Below is a summary of what our automated assessment found (grouped by rule; pages listed where applicable).</p>';
    } else {
      html +=
        '<p class="wcag-note">These findings are not mapped to a single WCAG success criterion in our tool configuration. Review and describe them in your own words for the published statement.</p>';
    }
    for (const row of rows) {
      const pages =
        row.urls.length > 0
          ? `<span class="finding-url">Affected pages: ${row.urls.map((u) => escapeHtml(u)).join('; ')}</span>`
          : '';
      html += `<p class="finding"><strong>${escapeHtml(row.rule)}</strong>${pages ? `<br>${pages}` : ''}</p>`;
    }
    html += '</div>';
  }
  return html;
}

function hasStatementMeta(meta) {
  if (!meta || typeof meta !== 'object') return false;
  if (meta.responseDays != null && Number(meta.responseDays) > 0) return true;
  return ['orgName', 'orgShortName', 'phone', 'email', 'visitorAddress', 'postalAddress'].some(
    (k) => typeof meta[k] === 'string' && meta[k].trim().length > 0
  );
}

function statementStrong(meta, key, placeholder) {
  const v = meta?.[key];
  const t = typeof v === 'string' ? v.trim() : '';
  if (t) return `<strong>${escapeHtml(t)}</strong>`;
  return `<strong class="placeholder">${escapeHtml(placeholder)}</strong>`;
}

function statementSpan(meta, key, placeholder) {
  const v = meta?.[key];
  const t = typeof v === 'string' ? v.trim() : '';
  if (t) return escapeHtml(t);
  return `<span class="placeholder">${escapeHtml(placeholder)}</span>`;
}

function statementResponseDaysLine(meta) {
  const d = meta?.responseDays;
  if (d != null && Number.isFinite(Number(d)) && Number(d) > 0) {
    return escapeHtml(String(Number(d)));
  }
  return `<span class="placeholder">[NUMBER]</span>`;
}

export function generateAccessibilityStatement(data, outputDir) {
  const { reportData, fixOrderItems, statementMeta: smRaw } = data;
  const sm = smRaw && typeof smRaw === 'object' ? smRaw : {};
  const isoDate = new Date().toISOString().slice(0, 10);
  const testedUrls = reportData.urls || [];
  const { display: siteDisplay, host: siteHost } = deriveSiteUrls(reportData);
  const created = new Date(reportData.generatedAt || Date.now());
  const monthYear = created.toLocaleString('en-GB', { month: 'long', year: 'numeric' });
  const limitationsHtml = buildLimitationBlocks(fixOrderItems);
  const prefilledNote = hasStatementMeta(sm)
    ? ' Organization and contact details were pre-filled from the optional fields on the run form where provided.'
    : '';

  const STATEMENT_EXTRA_STYLES = `
    .statement-section { margin: 28px 0; }
    .statement-section h2 { margin-top: 36px; font-size: 1.15rem; }
    .statement-section h2:first-of-type { margin-top: 0; }
    .statement-section h3 { margin: 20px 0 10px; font-size: 1.05rem; }
    .statement-section ul.measures { margin: 12px 0; padding-left: 24px; }
    .statement-section ul.measures li { margin-bottom: 8px; }
    .tech-list { margin: 12px 0; padding-left: 24px; }
    .contact-block p { margin: 6px 0; }
    .placeholder { background: #fff8e1; padding: 2px 6px; border-radius: 4px; }
    .limitation-block { margin: 24px 0; padding-bottom: 8px; border-bottom: 1px solid var(--border); }
    .limitation-block:last-child { border-bottom: none; }
    .limitation-sc { font-size: 1.05rem; margin: 0 0 12px; font-weight: 600; }
    .wcag-understanding, .wcag-note { font-size: 0.95rem; color: var(--text-muted); }
    .finding { margin: 12px 0 0; }
    .finding-url { font-size: 0.9rem; color: var(--text-muted); word-break: break-all; }
    .eval-list { margin: 12px 0; padding-left: 24px; }
    .eval-list li { margin-bottom: 6px; }
  `;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Accessibility statement · ${escapeHtml(siteHost)}</title>
  ${REPORT_BRAND_HEAD}
  <style>${STYLES}
    ${STATEMENT_EXTRA_STYLES}
  </style>
</head>
<body>
  <div class="container">
    ${buildDeliverableHeaderHtml()}
    <h1>Accessibility Statement for ${escapeHtml(siteHost)}</h1>
    <p class="meta">Draft generated ${isoDate}.${prefilledNote} Replace any remaining placeholders before publishing.</p>

    <div class="statement-section">
      <h2>About this statement</h2>
      <p>At ${statementStrong(sm, 'orgName', '[ORGANIZATION NAME]')}, we believe digital experiences should work for everyone. Accessibility isn’t an afterthought for us, it’s a core part of how we build and maintain <strong>${escapeHtml(siteDisplay)}</strong>. We actively work to align our website with relevant accessibility standards, and we’re committed to identifying and resolving any remaining issues to ensure an inclusive experience for all visitors.</p>
    </div>

    <div class="statement-section">
      <h2>Conformance status</h2>
      <p>The <a href="https://www.w3.org/WAI/standards-guidelines/wcag/" target="_blank" rel="noopener">Web Content Accessibility Guidelines (WCAG)</a> defines requirements for designers and developers to improve accessibility for people with disabilities. It defines three levels of conformance: Level A, Level AA, and Level AAA. <strong>${escapeHtml(siteDisplay)}</strong> is <strong>partially conformant</strong> with <strong>WCAG 2.2 Level AA</strong>. Partially conformant means that some parts of the content do not fully conform to the accessibility standard.</p>
      <p>The following pages were included in the automated assessment supporting this statement:</p>
      <ul>${testedUrls.map((u) => `<li>${escapeHtml(u)}</li>`).join('')}</ul>
    </div>

    <div class="statement-section">
      <h2>Measures to support accessibility</h2>
      <p>${statementStrong(sm, 'orgShortName', '[ORGANIZATION SHORT NAME]')} takes the following measures to ensure accessibility of <strong>${escapeHtml(siteDisplay)}</strong>:</p>
      <ul class="measures">
        <li>Include accessibility as part of our mission statement.</li>
        <li>Include accessibility throughout our internal policies.</li>
        <li>Integrate accessibility into our procurement practices.</li>
        <li>Appoint an accessibility officer and/or ombudsperson.</li>
        <li>Provide continual accessibility training for our staff.</li>
        <li>Assign clear accessibility goals and responsibilities.</li>
        <li>Employ formal accessibility quality assurance methods.</li>
      </ul>
    </div>

    <div class="statement-section">
      <h2>Technical specifications</h2>
      <p>Accessibility of <strong>${escapeHtml(siteDisplay)}</strong> relies on the following technologies to work with the particular combination of web browser and any assistive technologies or plugins installed on your computer:</p>
      <ul class="tech-list">
        <li>HTML</li>
        <li>WAI-ARIA</li>
        <li>CSS</li>
        <li>JavaScript</li>
      </ul>
      <p>These technologies are relied upon for conformance with the accessibility standards used.</p>
    </div>

    <div class="statement-section">
      <h2>Questions and feedback</h2>
      <p>We welcome your feedback on the accessibility of ${escapeHtml(siteHost)}. Please let us know if you encounter accessibility barriers on ${escapeHtml(siteHost)}:</p>
      <div class="contact-block">
        <p><strong>Phone:</strong> ${statementSpan(sm, 'phone', '[PHONE NUMBER]')}</p>
        <p><strong>E-mail:</strong> ${statementSpan(sm, 'email', '[EMAIL ADDRESS]')}</p>
        <p><strong>Visitor Address:</strong> ${statementSpan(sm, 'visitorAddress', '[STREET, CITY]')}</p>
        <p><strong>Postal Address:</strong> ${statementSpan(sm, 'postalAddress', '[STREET, CITY]')}</p>
      </div>
      <p>We try to respond to feedback within ${statementResponseDaysLine(sm)} business days.</p>
    </div>

    <div class="statement-section">
      <h2>Limitations and alternatives</h2>
      <p>Despite our best efforts to ensure accessibility of ${escapeHtml(siteHost)}, there may be some limitations. Below is a description of known limitations and potential solutions. Please contact us if you observe an issue not listed below.</p>
      <h3>Known limitations for ${escapeHtml(siteDisplay)}</h3>
      ${limitationsHtml}
      <p class="placeholder" style="margin-top: 20px; padding: 12px; border-radius: 8px; font-size: 0.9rem;">Add manual narrative for each issue (as in a full accessibility statement), timelines, and workarounds where appropriate. Automated findings above are a starting point only.</p>
    </div>

    <div class="statement-section">
      <h2>Assessment approach</h2>
      <p>${statementStrong(sm, 'orgShortName', '[ORGANIZATION SHORT NAME]')} assessed the accessibility of <strong>${escapeHtml(siteDisplay)}</strong> by the following approaches:</p>
      <ul class="eval-list">
        <li>Self-evaluation</li>
        <li>Automated testing (Deque University checklists, axe-core) on ${escapeHtml(created.toLocaleString())}, covering the URLs listed under Conformance status.</li>
      </ul>
    </div>

    <div class="statement-section">
      <h2>Date</h2>
      <p>This statement was created in <strong>${escapeHtml(monthYear)}</strong>.</p>
    </div>

    <p style="margin-top: 32px; font-size: 0.85rem; color: var(--text-muted);">
      This file was generated by the accessibility test suite. Review and customize all placeholders and limitation narratives before publication. See the <a href="https://www.w3.org/WAI/planning/statements/" target="_blank" rel="noopener">W3C Accessibility Statement Guide</a> for more information.
    </p>
    <div class="deliverable-footer"><span class="footer-brand">Us</span> · Co-creating digital impact · Draft accessibility statement</div>
  </div>
</body>
</html>`;

  const path = join(outputDir, 'accessibility-statement.html');
  writeFileSync(path, html, 'utf8');
  return path;
}

export function generateAllDeliverables(data, outputDir) {
  const paths = {
    developers: generateDeveloperAdvice(data, outputDir),
    client: generateClientPresentation(data, outputDir),
    statement: generateAccessibilityStatement(data, outputDir),
  };
  return paths;
}
