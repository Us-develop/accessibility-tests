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
  buildChartDataPayload,
  buildChartsSectionHtml,
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

export function generateClientPresentation(data, outputDir) {
  const { reportData, fixOrderItems, disabilityStats, score, scoreClamp, pass, fail, warn, totalAxeViolations, total } = data;
  const chartPayload = buildChartDataPayload(reportData, {
    pass,
    fail,
    warn,
    totalAxeViolations,
    scoreClamp,
    disabilityStats,
  });
  const date = new Date(reportData.generatedAt).toLocaleString();
  const issuesCount = fail + warn + totalAxeViolations;
  const uniqueByRule = (items) => [...new Map(items.map((i) => [i.rule, i])).values()];
  const quickWins = uniqueByRule(fixOrderItems.filter((i) => i.impact === 'high' && i.effort === 'simple'));
  const mediumEffort = uniqueByRule(fixOrderItems.filter((i) => (i.impact === 'high' && i.effort !== 'simple') || (i.impact === 'medium' && i.effort === 'simple')));
  const longTerm = uniqueByRule(fixOrderItems.filter((i) => i.effort === 'complex' || (i.impact === 'medium' && i.effort !== 'simple') || i.impact === 'low'));

  let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Accessibility summary – Client presentation</title>
  ${REPORT_BRAND_HEAD}
  <style>${STYLES}
    ${buildChartSectionStyles()}
    .score-hero { text-align: center; padding: 32px; background: var(--bg); border-radius: 12px; margin: 24px 0; }
    .score-value { font-size: 4rem; font-weight: 700; }
    .score-value.good { color: var(--pass); }
    .score-value.mid { color: var(--warn); }
    .score-value.low { color: var(--fail); }
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 12px; margin: 20px 0; }
    .stat-card { padding: 16px; background: var(--bg); border-radius: 8px; text-align: center; }
    .stat-card span { display: block; font-size: 1.8rem; font-weight: 700; }
    .stat-card small { font-size: 0.85rem; color: var(--text-muted); }
    .phase { padding: 16px; margin: 12px 0; border-left: 4px solid var(--accent); background: #f0f7f4; border-radius: 0 8px 8px 0; }
    .phase h3 { margin-top: 0; }
    ul { margin: 8px 0; padding-left: 24px; }
  </style>
</head>
<body>
  <div class="container">
    ${buildDeliverableHeaderHtml()}
    <h1>Accessibility summary</h1>
    <p class="meta">Generated ${date}</p>

    ${buildExecutiveSummaryHtml(data)}

    ${buildAiClientSummaryHtml({
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
    })}

    <h2>Overall score</h2>
    <div class="score-hero">
      <div class="score-value ${scoreClamp >= 80 ? 'good' : scoreClamp >= 50 ? 'mid' : 'low'}">${scoreClamp}</div>
      <p style="margin:8px 0 0;">out of 100</p>
    </div>

    <h2>Statistics</h2>
    <div class="stats-grid">
      <div class="stat-card"><span style="color:var(--pass)">${pass}</span><small>Passed</small></div>
      <div class="stat-card"><span style="color:var(--warn)">${warn}</span><small>Warnings</small></div>
      <div class="stat-card"><span style="color:var(--fail)">${fail}</span><small>Failures</small></div>
      <div class="stat-card"><span style="color:var(--fail)">${totalAxeViolations}</span><small>Axe violations</small></div>
      <div class="stat-card"><span>${total}</span><small>Total checks</small></div>
    </div>

    ${buildChartsSectionHtml(chartPayload, 'a11y-chart-data-client')}

    <h2>Step-by-step remediation plan</h2>
    <p>We recommend addressing issues in three phases, starting with quick wins.</p>

    <div class="phase">
      <h3>Phase 1: Quick wins (${quickWins.length} items)</h3>
      <p>High-impact, simple fixes. Estimated: 1–2 days.</p>
      <ul>
        ${quickWins.length ? quickWins.map((i) => `<li>${escapeHtml(i.rule)}</li>`).join('') : '<li>None</li>'}
      </ul>
    </div>

    <div class="phase">
      <h3>Phase 2: Medium effort (${mediumEffort.length} items)</h3>
      <p>Important fixes requiring some development. Estimated: 1–2 weeks.</p>
      <ul>
        ${mediumEffort.length ? mediumEffort.map((i) => `<li>${escapeHtml(i.rule)}</li>`).join('') : '<li>None</li>'}
      </ul>
    </div>

    <div class="phase">
      <h3>Phase 3: Long-term (${longTerm.length} items)</h3>
      <p>Complex changes or lower-priority items. Plan over several weeks.</p>
      <ul>
        ${longTerm.length ? longTerm.map((i) => `<li>${escapeHtml(i.rule)}</li>`).join('') : '<li>None</li>'}
      </ul>
    </div>

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
