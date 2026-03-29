/**
 * Plain-language executive summary (deterministic) and chart payloads for HTML reports.
 */

import { CHECKLIST_CHAPTERS } from './checklists.js';

function escapeHtml(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Per-chapter issue counts: custom warn/fail + axe violations (matches report chapter buckets). */
export function computeChapterIssueData(reportData) {
  const chapterKeys = Object.keys(CHECKLIST_CHAPTERS);
  const customWarnFail = {};
  const axeCounts = {};
  chapterKeys.forEach((k) => {
    customWarnFail[k] = 0;
    axeCounts[k] = 0;
  });

  (reportData.customResults || []).forEach((r) => {
    if ((r.status === 'fail' || r.status === 'warn') && r.chapter && customWarnFail[r.chapter] !== undefined) {
      customWarnFail[r.chapter]++;
    }
  });

  Object.values(reportData.axeResults || {}).forEach((data) => {
    chapterKeys.forEach((ch) => {
      const v = data.byChapter?.[ch]?.violations || [];
      axeCounts[ch] += v.length;
    });
  });

  const labels = chapterKeys.map((k) => {
    const ch = CHECKLIST_CHAPTERS[k];
    const short = ch.name.split(',')[0].trim();
    return `Ch.${ch.id} ${short}`;
  });

  const customSeries = chapterKeys.map((k) => customWarnFail[k]);
  const axeSeries = chapterKeys.map((k) => axeCounts[k]);
  const issueTotal = chapterKeys.map((k, i) => customSeries[i] + axeSeries[i]);

  return { labels, customSeries, axeSeries, issueTotal, chapterKeys };
}

export function buildChartDataPayload(reportData, { pass, fail, warn, totalAxeViolations, scoreClamp }) {
  const ch = computeChapterIssueData(reportData);
  return {
    scoreClamp,
    pass,
    fail,
    warn,
    totalAxeViolations,
    chapterLabels: ch.labels,
    chapterCustom: ch.customSeries,
    chapterAxe: ch.axeSeries,
  };
}

/**
 * Non-technical executive summary for client-facing HTML (no external AI).
 */
export function buildExecutiveSummaryHtml(data) {
  const {
    reportData,
    scoreClamp,
    pass,
    fail,
    warn,
    totalAxeViolations,
    total,
    fixOrderItems,
  } = data;
  const urlCount = (reportData.urls || []).length;
  const issuesCount = fail + warn + totalAxeViolations;

  const uniqueByRule = (items) => [...new Map(items.map((i) => [i.rule, i])).values()];
  const quickWins = uniqueByRule(fixOrderItems.filter((i) => i.impact === 'high' && i.effort === 'simple'));

  const topThree = [];
  const seen = new Set();
  for (const item of fixOrderItems) {
    if (!seen.has(item.rule)) {
      seen.add(item.rule);
      topThree.push(item.rule);
    }
    if (topThree.length >= 3) break;
  }

  let scoreHtml;
  if (scoreClamp >= 80) {
    scoreHtml = `The overall accessibility score is <strong>${scoreClamp}</strong> out of 100, indicating strong alignment with the automated WCAG-oriented checks in this run.`;
  } else if (scoreClamp >= 50) {
    scoreHtml = `The overall accessibility score is <strong>${scoreClamp}</strong> out of 100. There is clear room to improve consistency and resolve outstanding findings.`;
  } else {
    scoreHtml = `The overall accessibility score is <strong>${scoreClamp}</strong> out of 100. Addressing the findings in this report should be a priority to support more users and reduce compliance risk.`;
  }

  const p1 = `<p class="exec-summary-lead">This audit covers <strong>${urlCount}</strong> page${urlCount === 1 ? '' : 's'}, using custom checklist rules and the axe-core engine. ${scoreHtml}</p>`;

  const p2 = `<p>Across <strong>${total}</strong> automated results, <strong>${pass}</strong> passed, <strong>${warn}</strong> are warnings, <strong>${fail}</strong> are failed custom checks, and axe reported <strong>${totalAxeViolations}</strong> violation${totalAxeViolations === 1 ? '' : 's'}.</p>`;

  let p3;
  if (issuesCount === 0) {
    p3 = '<p>No failed checks or axe violations were recorded in this run. Manual testing with assistive technology is still recommended before claiming full conformance.</p>';
  } else {
    const quick = quickWins.length
      ? ` Starting with the <strong>${quickWins.length}</strong> quick win${quickWins.length === 1 ? '' : 's'} below often delivers the fastest improvement for users.`
      : '';
    const examples = topThree.length
      ? ` Representative areas to address include: ${topThree.map((r) => escapeHtml(r)).join('; ')}.`
      : '';
    p3 = `<p>Together, warnings, failures, and axe violations represent <strong>${issuesCount}</strong> issue${issuesCount === 1 ? '' : 's'} to track.${quick}${examples}</p>`;
  }

  return `<div class="exec-summary" role="region" aria-labelledby="exec-summary-heading">
    <h2 id="exec-summary-heading">Executive summary</h2>
    ${p1}
    ${p2}
    ${p3}
  </div>`;
}

/** SVG doughnut for PDF/print when Chart.js canvas may not layout; optional enhancement. */
export function buildChartSectionStyles() {
  return `
    .exec-summary { padding: 20px 24px; background: var(--bg); border-radius: 12px; border: 1px solid var(--border); margin-bottom: 24px; }
    .exec-summary h2 { margin-top: 0; font-size: 1.15rem; }
    .exec-summary p:last-child { margin-bottom: 0; }
    .exec-summary-lead { font-size: 1.02rem; color: var(--text); }
    .chart-section { margin: 24px 0; padding: 20px 0; border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); }
    .chart-section h2 { font-size: 1.1rem; margin: 0 0 16px; }
    .chart-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 24px; align-items: start; }
    .chart-card { background: var(--bg); border-radius: 12px; padding: 16px; border: 1px solid var(--border); }
    .chart-card h3 { margin: 0 0 12px; font-size: 0.95rem; font-weight: 600; }
    .chart-card .chart-wrap { position: relative; height: 220px; max-width: 100%; }
    .chart-card.chart-wide { grid-column: 1 / -1; }
    .chart-card.chart-wide .chart-wrap { height: 280px; }
    .chart-data-table { width: 100%; border-collapse: collapse; font-size: 0.8rem; margin-top: 12px; }
    .chart-data-table th, .chart-data-table td { padding: 6px 8px; text-align: left; border-bottom: 1px solid var(--border); }
    .chart-data-table caption { text-align: left; font-weight: 600; margin-bottom: 8px; }
    .visually-hidden { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
    @media print { .chart-card { break-inside: avoid; } }
  `;
}

/**
 * Chart section: canvases + accessible tables + Chart.js init (loads from CDN in caller).
 * @param {string} dataId - unique id for the JSON script tag (e.g. 'a11y-chart-data-main')
 */
export const CHART_JS_CDN = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js';

export function buildChartsSectionHtml(payload, dataId = 'a11y-chart-data') {
  const safeJson = JSON.stringify(payload).replace(/</g, '\\u003c');

  const tableRows = payload.chapterLabels
    .map((label, i) => {
      const c = payload.chapterCustom[i];
      const a = payload.chapterAxe[i];
      const t = c + a;
      return `<tr><td>${escapeHtml(label)}</td><td>${c}</td><td>${a}</td><td>${t}</td></tr>`;
    })
    .join('');

  return `
    <section class="chart-section" aria-labelledby="charts-heading">
      <h2 id="charts-heading">Overview charts</h2>
      <div class="chart-grid">
        <figure class="chart-card">
          <h3>Score</h3>
          <div class="chart-wrap"><canvas id="a11y-chart-score" role="img" aria-label="Doughnut chart of accessibility score out of 100"></canvas></div>
          <p class="visually-hidden">Score ${payload.scoreClamp} out of 100.</p>
        </figure>
        <figure class="chart-card">
          <h3>Check results</h3>
          <div class="chart-wrap"><canvas id="a11y-chart-status" role="img" aria-label="Bar chart of passed, warning, failed, and axe violation counts"></canvas></div>
          <table class="chart-data-table visually-hidden">
            <caption>Check results</caption>
            <thead><tr><th>Category</th><th>Count</th></tr></thead>
            <tbody>
              <tr><td>Passed</td><td>${payload.pass}</td></tr>
              <tr><td>Warnings</td><td>${payload.warn}</td></tr>
              <tr><td>Failures</td><td>${payload.fail}</td></tr>
              <tr><td>Axe violations</td><td>${payload.totalAxeViolations}</td></tr>
            </tbody>
          </table>
        </figure>
        <figure class="chart-card chart-wide">
          <h3>Issues by checklist chapter</h3>
          <p style="font-size:0.85rem; color:var(--text-muted); margin:0 0 8px;">Custom warnings and failures (orange) plus axe violations (red), by Deque module.</p>
          <div class="chart-wrap"><canvas id="a11y-chart-chapter" role="img" aria-label="Horizontal stacked bar chart of issues by chapter"></canvas></div>
          <table class="chart-data-table">
            <caption>Issues by chapter</caption>
            <thead><tr><th>Chapter</th><th>Custom warn/fail</th><th>Axe</th><th>Total</th></tr></thead>
            <tbody>${tableRows}</tbody>
          </table>
        </figure>
      </div>
      <script src="${CHART_JS_CDN}"></script>
      <script type="application/json" id="${dataId}">${safeJson}</script>
      <script>
(function() {
  function readData(id) {
    var el = document.getElementById(id);
    if (!el || !el.textContent) return null;
    try { return JSON.parse(el.textContent); } catch (e) { return null; }
  }
  function colorScore(n) {
    if (n >= 80) return '#2e7d32';
    if (n >= 50) return '#ed6c02';
    return '#c62828';
  }
  function initCharts() {
    if (typeof Chart === 'undefined') return;
    var d = readData('${dataId}');
    if (!d) return;
    var rem = 100 - d.scoreClamp;
    var scoreEl = document.getElementById('a11y-chart-score');
    if (scoreEl) {
      new Chart(scoreEl, {
        type: 'doughnut',
        data: {
          labels: ['Score', 'Remaining to 100'],
          datasets: [{
            data: [d.scoreClamp, rem],
            backgroundColor: [colorScore(d.scoreClamp), '#e8e6e1'],
            borderWidth: 0
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '68%',
          plugins: {
            legend: { position: 'bottom' },
            tooltip: {
              callbacks: {
                label: function(ctx) {
                  var v = ctx.raw;
                  return ctx.label + ': ' + v + (ctx.dataIndex === 0 ? ' / 100' : '');
                }
              }
            }
          }
        }
      });
    }
    var statusEl = document.getElementById('a11y-chart-status');
    if (statusEl) {
      new Chart(statusEl, {
        type: 'bar',
        data: {
          labels: ['Passed', 'Warnings', 'Failures', 'Axe violations'],
          datasets: [{
            label: 'Count',
            data: [d.pass, d.warn, d.fail, d.totalAxeViolations],
            backgroundColor: ['#2e7d32', '#ed6c02', '#c62828', '#6a1b9a']
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } }
        }
      });
    }
    var chEl = document.getElementById('a11y-chart-chapter');
    if (chEl && d.chapterLabels && d.chapterLabels.length) {
      new Chart(chEl, {
        type: 'bar',
        data: {
          labels: d.chapterLabels,
          datasets: [
            { label: 'Custom warn/fail', data: d.chapterCustom, backgroundColor: '#ed6c02' },
            { label: 'Axe violations', data: d.chapterAxe, backgroundColor: '#c62828' }
          ]
        },
        options: {
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { position: 'bottom' } },
          scales: {
            x: { stacked: true, beginAtZero: true, ticks: { stepSize: 1 } },
            y: { stacked: true }
          }
        }
      });
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCharts);
  } else {
    initCharts();
  }
})();
      </script>
    </section>
  `;
}
