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

const STYLES = `
  :root { --pass: #2e7d32; --fail: #c62828; --warn: #ed6c02; --accent: #2d9d78; --bg: #f8f7f4; --surface: #fff; --text: #1a1a1a; --text-muted: #5c5c5c; --border: #e8e6e1; }
  * { box-sizing: border-box; }
  body { font-family: 'Plus Jakarta Sans', system-ui, sans-serif; margin: 0; padding: 0; background: var(--bg); color: var(--text); line-height: 1.6; }
  .container { max-width: 900px; margin: 0 auto; padding: 32px; background: var(--surface); border-radius: 12px; box-shadow: 0 2px 16px rgba(0,0,0,.06); }
  h1 { font-size: 1.6rem; margin: 0 0 8px; }
  h2 { font-size: 1.2rem; margin: 24px 0 12px; }
  h3 { font-size: 1rem; margin: 16px 0 8px; }
  p { margin: 0 0 12px; color: var(--text-muted); }
  .meta { font-size: 0.9rem; color: var(--text-muted); margin-bottom: 24px; }
  pre { background: #1e1e1e; color: #d4d4d4; padding: 12px; border-radius: 8px; overflow-x: auto; font-size: 0.85rem; }
  .badge { display: inline-block; padding: 4px 8px; border-radius: 6px; font-size: 0.75rem; font-weight: 600; }
  .badge.fail { background: #ffebee; color: var(--fail); }
  .badge.warn { background: #fff3e0; color: var(--warn); }
  .badge.impact { background: #e3f2fd; }
  a { color: var(--accent); }
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
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>${STYLES}</style>
</head>
<body>
  <div class="container">
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
  </div>
</body>
</html>`;

  const path = join(outputDir, 'accessibility-developers.html');
  writeFileSync(path, html, 'utf8');
  return path;
}

export function generateClientPresentation(data, outputDir) {
  const { reportData, fixOrderItems, disabilityStats, score, scoreClamp, pass, fail, warn, totalAxeViolations, total } = data;
  const chartPayload = buildChartDataPayload(reportData, {
    pass,
    fail,
    warn,
    totalAxeViolations,
    scoreClamp,
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
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
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
    <h1>Accessibility summary</h1>
    <p class="meta">Generated ${date}</p>

    ${buildExecutiveSummaryHtml(data)}

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
  </div>
</body>
</html>`;

  const path = join(outputDir, 'accessibility-client.html');
  writeFileSync(path, html, 'utf8');
  return path;
}

export function generateAccessibilityStatement(data, outputDir) {
  const { reportData, fixOrderItems } = data;
  const date = new Date().toISOString().slice(0, 10);
  const testedUrls = reportData.urls || [];
  const uniqueRules = [...new Set(fixOrderItems.map((i) => i.rule))];
  const knownLimitations = uniqueRules
    .slice(0, 15)
    .map((r) => escapeHtml(r))
    .join('</li><li>');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Accessibility statement</title>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>${STYLES}
    .statement-section { margin: 24px 0; }
    .statement-section h2 { margin-top: 32px; }
    ul { padding-left: 24px; }
    .placeholder { background: #fff8e1; padding: 8px 12px; border-radius: 6px; margin: 8px 0; font-size: 0.9rem; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Accessibility statement</h1>
    <p class="meta">Draft generated ${date} · Customize placeholders before publishing</p>

    <div class="statement-section">
      <h2>Our commitment</h2>
      <p><strong>[ORGANIZATION NAME]</strong> is committed to ensuring digital accessibility for people with disabilities. We are continually improving the user experience for everyone and applying the relevant accessibility standards.</p>
    </div>

    <div class="statement-section">
      <h2>Conformance status</h2>
      <p>The <a href="https://www.w3.org/WAI/standards-guidelines/wcag/" target="_blank" rel="noopener">Web Content Accessibility Guidelines (WCAG)</a> define requirements for designers and developers to improve accessibility.</p>
      <p>This website is <strong>partially conformant</strong> with <strong>WCAG 2.1 Level AA</strong>. Partially conformant means that some parts of the content do not fully conform to the accessibility standard.</p>
      <p>This assessment was conducted on ${date} using automated testing. The following pages were evaluated:</p>
      <ul>${testedUrls.map((u) => `<li>${escapeHtml(u)}</li>`).join('')}</ul>
    </div>

    <div class="statement-section">
      <h2>Known limitations</h2>
      <p>Despite our best efforts to ensure accessibility, the following limitations were identified during our assessment. We are working to address them.</p>
      <ul>
        <li>${knownLimitations || 'None identified.'}</li>
      </ul>
      <p class="placeholder">Add specific workarounds or timelines for each limitation if appropriate.</p>
    </div>

    <div class="statement-section">
      <h2>Feedback</h2>
      <p>We welcome your feedback on the accessibility of this website. Please let us know if you encounter accessibility barriers:</p>
      <p class="placeholder"><strong>Contact:</strong> [Add email, phone, or contact form URL]</p>
      <p>We aim to respond to accessibility feedback within [X] business days.</p>
    </div>

    <div class="statement-section">
      <h2>Technical specifications</h2>
      <p>Accessibility of this website relies on the following technologies: HTML, WAI-ARIA, CSS, and JavaScript.</p>
    </div>

    <div class="statement-section">
      <h2>Assessment approach</h2>
      <p>This accessibility statement was prepared based on an evaluation conducted using automated accessibility testing tools and manual checks, following Deque University accessibility checklists.</p>
    </div>

    <p style="margin-top: 32px; font-size: 0.85rem; color: var(--text-muted);">
      This statement was generated on ${date}. It should be reviewed and customized before publication. See the <a href="https://www.w3.org/WAI/planning/statements/" target="_blank" rel="noopener">W3C Accessibility Statement Guide</a> for more information.
    </p>
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
