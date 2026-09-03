/**
 * Generates three deliverables from accessibility report data:
 * 1. Developer advice (problems + solutions)
 * 2. Client-friendly presentation (stats + plan)
 * 3. Accessibility statement (draft)
 */

import { writeFileSync } from 'fs';
import { join } from 'path';
import { getRemediation, wcagScUrl } from './remediation-data.js';
import { groupFixesByPrinciple } from './report-buckets.js';
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
  .badge.fail { background: var(--fail-soft); color: var(--fail); }
  .badge.warn { background: var(--warn-soft); color: var(--warn); }
  .badge.impact { background: var(--info-soft); color: var(--info); }
  .ai-summary { margin: 22px 0 8px; padding: 18px 18px; border-radius: 12px; border: 1px solid var(--border); background: var(--accent-soft); }
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

/**
 * Developer guide deliverable, restyled to match the prototype's view-developer.jsx.
 * Static HTML; the "Add sprint to Jira" CTA opens an inline modal with vanilla JS.
 */
export function generateDeveloperAdvice(data, outputDir) {
  const { reportData, fixOrderItems, domain, runId } = data;
  const date = new Date(reportData.generatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  // /report/<domain>/<runId>/ — link back to the live Astro report from this static deliverable.
  const backHref = domain && runId
    ? `/report/${encodeURIComponent(domain)}/${encodeURIComponent(runId)}/`
    : '';

  // Build a real sprint from the fix order items: severity + effort.
  const tickets = fixOrderItems.slice(0, 12).map((item, i) => {
    const sev = item.status === 'fail' || item.status === 'violation' ? 'error' : 'warning';
    const effort = typeof item.effort === 'number'
      ? item.effort
      : (item.impact || '').toLowerCase() === 'high' ? 5
      : (item.impact || '').toLowerCase() === 'medium' ? 3
      : 1;
    return {
      id: item.id || `fix-${i + 1}`,
      rule: item.rule || item.id || 'Accessibility fix',
      severity: sev,
      points: effort,
      occurrences: 1,
    };
  });
  const totalPoints = tickets.reduce((s, t) => s + t.points, 0);
  const blockers = tickets.filter((t) => t.severity === 'error').length;

  const principleGroups = groupFixesByPrinciple(fixOrderItems).map((g) => ({
    ...g,
    color: g.hex || g.color,
    textColor: g.hexText || g.textColor,
  }));

  const ticketRows = tickets.map((t) => `
        <div class="ticket-row">
          <span class="mono ticket-key">${escapeHtml(t.id)}</span>
          <span class="ticket-title">${escapeHtml(t.rule)}</span>
          <span class="ticket-assignee">${escapeHtml(t.id)}</span>
          <span class="tag tag-lilac">${t.points}</span>
          <span class="tag tag-${t.severity === 'error' ? 'error' : 'warning'}">${t.severity === 'error' ? 'Error' : 'Warning'}</span>
        </div>`).join('');

  const principleSections = principleGroups.filter((g) => g.issues.length > 0).map((g) => {
    const items = g.issues.map((i) => {
      const wcagLinks = (i.wcag || []).map((sc) => `<a href="${wcagScUrl(sc)}" target="_blank" rel="noopener">${sc}</a>`).join(', ');
      const sev = i.status === 'fail' || i.status === 'violation' ? 'error' : 'warning';
      const effort = typeof i.effort === 'number' ? i.effort
        : (i.impact || '').toLowerCase() === 'high' ? 5
        : (i.impact || '').toLowerCase() === 'medium' ? 3 : 1;
      return `
        <details class="issue-details">
          <summary>
            <span class="summary-left">
              <span class="tag tag-${sev === 'error' ? 'error' : 'warning'}">${sev === 'error' ? 'Error' : 'Warning'}</span>
              <strong>${escapeHtml(i.rule || i.id || 'Issue')}</strong>
              <span class="muted mono summary-meta">${i.id ? escapeHtml(i.id) : ''}${wcagLinks ? ` · WCAG ${wcagLinks}` : ''}</span>
            </span>
            <span class="muted summary-effort">${effort} pt${effort === 1 ? '' : 's'}</span>
          </summary>
          ${i.duplicateIdLabel ? `<p class="issue-desc"><strong>Duplicated IDs:</strong> <span class="mono">${escapeHtml(i.duplicateIdLabel)}</span></p>` : ''}
          ${!i.duplicateIdLabel && i.message && i.message !== i.rule ? `<p class="issue-desc">${escapeHtml(i.message)}</p>` : ''}
          ${i.snippet ? `<p class="issue-desc">${escapeHtml(i.snippet)}</p>` : ''}
          ${(i.occurrenceDetails || []).length
            ? `<p class="issue-desc"><strong>Where they appear</strong></p><ul class="occ-list">${i.occurrenceDetails.map((d) => `<li class="mono">${escapeHtml(d)}</li>`).join('')}</ul>`
            : ''}
          ${i.url ? `<p class="muted issue-url">Found on <span class="mono">${escapeHtml(i.url)}</span></p>` : ''}
        </details>`;
    }).join('');
    return `
      <section class="card-flat principle-card">
        <header class="principle-head">
          <span class="principle-icon" style="background:${g.color}; color:${g.textColor};">${escapeHtml(g.label[0])}</span>
          <h3>${escapeHtml(g.label)}</h3>
          <span class="muted">· ${g.issues.length} issue${g.issues.length === 1 ? '' : 's'} to fix</span>
        </header>
        <div class="principle-body">${items}</div>
      </section>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Developer guide · ${escapeHtml(reportData.urls?.[0] || 'Accessibility')}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..800&family=Public+Sans:ital,wght@0,300..900;1,400..700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      --us-cream: #F5F4E5; --us-ink: #19191B; --us-white: #FFFFFF;
      --us-peach: #FFB985; --us-peach-text: #872012;
      --us-mint: #8DFFB7; --us-mint-text: #1E625A;
      --us-sky: #A7F0FB; --us-sky-text: #0D4F6E;
      --us-pink: #F3AAFF; --us-pink-text: #7E1C74;
      --us-lilac: #BDB4FF; --us-lilac-deep: #6257E8; --us-lilac-text: #423A75;
      --us-grad-iri: linear-gradient(135deg, #FFB985 0%, #F3AAFF 25%, #BDB4FF 55%, #A7F0FB 80%, #8DFFB7 100%);
      --us-n-20: #F9F9F9; --us-n-30: #F3F3F3; --us-n-40: #EAEAEA;
      --fg-1: #19191B; --fg-2: #2E2E2E; --fg-3: #707070;
      --border-subtle: #EAEAEA; --border-default: #D9D9D9;
      --r-md: 16px; --r-lg: 24px; --r-pill: 500px;
      --shadow-card: 0 1px 2px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.06);
      --shadow-pop: 0 4px 12px rgba(0,0,0,0.08), 0 16px 40px rgba(0,0,0,0.10);
      --font-display: "Bricolage Grotesque", system-ui, sans-serif;
      --font-body: "Public Sans", system-ui, sans-serif;
      --font-mono: "JetBrains Mono", ui-monospace, "SF Mono", monospace;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0; padding: 0; background: var(--us-cream); color: var(--fg-1);
      font-family: var(--font-body); font-weight: 300; line-height: 1.65;
      -webkit-font-smoothing: antialiased;
    }
    h1, h2, h3, h4 { font-family: var(--font-display); font-weight: 700; letter-spacing: -0.02em; line-height: 1.1; margin: 0; }
    .container { max-width: 1280px; margin: 0 auto; padding: 48px 32px 96px; }
    .eyebrow {
      font-size: 12px; font-weight: 600; letter-spacing: 0.08em;
      text-transform: uppercase; color: var(--fg-3); display: inline-flex; align-items: center; gap: 8px;
    }
    .eyebrow .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--us-lilac-deep); display: inline-block; }
    .muted { color: var(--fg-3); }
    .mono { font-family: var(--font-mono); }
    .header-row { display: grid; grid-template-columns: 1fr auto; gap: 24px; align-items: center; margin-bottom: 36px; }
    .header-row h1 { font-size: clamp(36px, 4.5vw, 56px); margin-top: 12px; margin-bottom: 10px; }
    .header-row .lead { font-size: 20px; max-width: 640px; line-height: 1.6; color: var(--fg-2); }
    .btn {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 10px 16px; border-radius: var(--r-pill); border: 1px solid var(--us-ink);
      background: var(--us-ink); color: var(--us-cream); cursor: pointer;
      font-family: var(--font-body); font-size: 14px; font-weight: 500; text-decoration: none;
      transition: transform 0.1s ease, box-shadow 0.1s ease;
    }
    .btn:hover { transform: translateY(-1px); box-shadow: var(--shadow-card); }
    .btn-grad { background: var(--us-grad-iri); color: var(--us-ink); border-color: transparent; }
    .btn-secondary { background: var(--us-white); color: var(--us-ink); border-color: var(--border-default); }
    .btn-lg { padding: 14px 22px; font-size: 16px; }
    .btn-sm { padding: 6px 14px; font-size: 13px; }
    .btn-cream { background: var(--us-cream); color: var(--us-ink); border-color: transparent; }
    .btn-ghost { background: transparent; color: var(--us-ink); border-color: var(--border-default); }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .back-link { margin-bottom: 12px; }
    .stat-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 32px; }
    @media (max-width: 800px) { .stat-grid { grid-template-columns: 1fr 1fr; } }
    .stat { padding: 18px 20px; border-radius: var(--r-md); }
    .stat-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; opacity: 0.75; margin-bottom: 6px; }
    .stat-value { font-family: var(--font-display); font-size: 28px; font-weight: 700; line-height: 1.1; }
    .stat-sub { font-size: 12px; opacity: 0.7; margin-top: 4px; }
    .stat.ink { background: var(--us-ink); color: var(--us-cream); }
    .stat.lilac { background: var(--us-lilac); color: var(--us-lilac-text); }
    .stat.mint { background: var(--us-mint); color: var(--us-mint-text); }
    .stat.peach { background: var(--us-peach); color: var(--us-peach-text); }
    .card-flat { background: var(--us-white); border: 1px solid var(--border-subtle); border-radius: var(--r-md); padding: 20px; box-shadow: var(--shadow-card); }
    .ticket-card { padding: 0; margin-bottom: 40px; }
    .ticket-head { padding: 16px 24px; border-bottom: 1px solid var(--border-subtle); display: flex; justify-content: space-between; align-items: center; }
    .ticket-head h2 { font-size: 20px; }
    .ticket-row {
      display: grid; grid-template-columns: 110px 1fr 160px 80px 120px;
      gap: 16px; align-items: center; padding: 14px 24px; border-bottom: 1px solid var(--border-subtle);
    }
    .ticket-row:last-child { border-bottom: 0; }
    .ticket-row.head {
      background: var(--us-n-20); font-size: 11px; text-transform: uppercase;
      letter-spacing: 0.08em; color: var(--fg-3); font-weight: 600;
    }
    .ticket-key { font-size: 12px; font-weight: 600; }
    .ticket-title { font-weight: 500; font-size: 14px; }
    .ticket-assignee { font-size: 13px; color: var(--fg-2); }
    .tag { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: var(--r-pill); font-size: 12px; font-weight: 500; }
    .tag-error { background: #FCE8E5; color: var(--us-peach-text); }
    .tag-warning { background: var(--us-peach); color: var(--us-peach-text); }
    .tag-lilac { background: var(--us-lilac); color: var(--us-lilac-text); }
    .principles { display: flex; flex-direction: column; gap: 28px; }
    .principle-card { padding: 28px; }
    .principle-head { display: flex; align-items: center; gap: 14px; margin-bottom: 16px; }
    .principle-head h3 { font-size: 22px; }
    .principle-icon {
      width: 40px; height: 40px; border-radius: 10px;
      display: flex; align-items: center; justify-content: center;
      font-family: var(--font-display); font-weight: 700; font-size: 18px;
    }
    .principle-body { display: flex; flex-direction: column; gap: 14px; }
    .issue-details { border-top: 1px solid var(--border-subtle); padding-top: 14px; }
    .issue-details summary { cursor: pointer; display: flex; justify-content: space-between; align-items: center; list-style: none; gap: 12px; }
    .issue-details summary::-webkit-details-marker { display: none; }
    .summary-left { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .summary-meta { font-size: 12px; }
    .summary-effort { font-size: 13px; }
    .issue-desc { font-size: 14px; color: var(--fg-2); margin: 10px 0 6px; line-height: 1.6; }
    .occ-list { margin: 0 0 10px; padding-left: 18px; font-size: 12px; color: var(--fg-2); }
    .occ-list li { margin: 2px 0; word-break: break-all; }
    .issue-url { font-size: 13px; }

    /* Modal styles */
    .modal-backdrop {
      position: fixed; inset: 0; background: rgba(25, 25, 27, 0.5);
      backdrop-filter: blur(8px); z-index: 200;
      display: none; align-items: center; justify-content: center; padding: 24px;
    }
    .modal-backdrop.open { display: flex; }
    .modal {
      width: 640px; max-width: 100%; max-height: 90vh;
      background: var(--us-white); border-radius: var(--r-lg); overflow: hidden;
      box-shadow: var(--shadow-pop); display: flex; flex-direction: column;
    }
    .modal-head, .modal-body, .modal-foot { padding: 20px 28px; }
    .modal-head { border-bottom: 1px solid var(--border-subtle); display: flex; justify-content: space-between; align-items: center; }
    .modal-foot { border-top: 1px solid var(--border-subtle); background: var(--us-cream); display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
    .modal-body { flex: 1; overflow-y: auto; }
    .project-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin-bottom: 16px; }
    .project-btn {
      padding: 14px 16px; border: 1.5px solid var(--border-default);
      border-radius: 12px; background: var(--us-white);
      display: flex; align-items: center; gap: 12px; cursor: pointer;
      text-align: left; font-family: var(--font-body); font-size: 14px;
    }
    .project-btn.active { border-color: var(--us-ink); background: var(--us-cream); }
    .project-key {
      width: 32px; height: 32px; border-radius: 8px; color: white;
      display: flex; align-items: center; justify-content: center;
      font-weight: 700; font-size: 12px;
    }

    .footer-foot { margin-top: 32px; padding-top: 16px; border-top: 1px solid var(--border-subtle); font-size: 13px; color: var(--fg-3); }
  </style>
</head>
<body>
  <div class="container">
    <header class="header-row">
      <div>
        ${backHref ? `<a class="btn btn-ghost btn-sm back-link" href="${backHref}">← Back to report</a>` : ''}
        <span class="eyebrow"><span class="dot"></span>For the engineers</span>
        <h1>Here's what to fix, in what order.</h1>
        <p class="lead">${tickets.length} ticket${tickets.length === 1 ? '' : 's'} · ${totalPoints} story points · ~2 weeks. Each ticket includes the rule, an example fix, and the WCAG criterion.</p>
      </div>
      <button class="btn btn-grad btn-lg" id="add-to-jira-btn" type="button">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M11.5 2L2 11.5l3 3L11.5 8 18 14.5l-3 3 3 3 9.5-9.5L11.5 2z" opacity="0.95"/>
        </svg>
        Add sprint to Jira
      </button>
    </header>

    <section class="stat-grid">
      <div class="stat ink">
        <div class="stat-label">Sprint</div>
        <div class="stat-value">A11y sprint</div>
        <div class="stat-sub">2 weeks</div>
      </div>
      <div class="stat lilac">
        <div class="stat-label">Tickets</div>
        <div class="stat-value">${tickets.length}</div>
        <div class="stat-sub">${blockers} blocker${blockers === 1 ? '' : 's'}</div>
      </div>
      <div class="stat mint">
        <div class="stat-label">Story points</div>
        <div class="stat-value">${totalPoints}</div>
        <div class="stat-sub">Estimated by issue impact</div>
      </div>
      <div class="stat peach">
        <div class="stat-label">Generated</div>
        <div class="stat-value">${escapeHtml(date)}</div>
        <div class="stat-sub">From this audit run</div>
      </div>
    </section>

    <section class="card-flat ticket-card">
      <div class="ticket-head">
        <h2>Proposed tickets</h2>
        <span class="muted" style="font-size: 13px;">Sorted by severity → effort</span>
      </div>
      <div class="ticket-row head">
        <span>Id</span><span>Title</span><span>Rule</span><span>Points</span><span>Severity</span>
      </div>
      ${ticketRows}
    </section>

    <h2 style="font-size: 28px; margin-bottom: 18px;">Fixes by principle</h2>
    <div class="principles">
      ${principleSections || '<p class="muted">No outstanding fixes — well done!</p>'}
    </div>
    <p class="muted" style="font-size: 11px; margin-top: 12px;">Fixes grouped by WCAG POUR from success criteria on this run.</p>

    <div class="footer-foot">
      Generated by Us · Co-creating digital impact · Developer remediation guide
    </div>
  </div>

  <div class="modal-backdrop" id="jira-modal" role="dialog" aria-modal="true" aria-labelledby="jira-modal-title">
    <div class="modal">
      <div class="modal-head">
        <div>
          <div class="eyebrow"><span class="dot"></span>Jira</div>
          <h2 id="jira-modal-title" style="font-size: 22px; margin-top: 6px;">Add sprint to Jira</h2>
        </div>
        <button class="btn btn-secondary btn-sm" type="button" data-close>✕</button>
      </div>
      <div class="modal-body">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:10px;">
          <div style="font-size: 13px; font-weight: 500;">Pick a project</div>
          <button class="btn btn-secondary btn-sm" id="jira-connect" type="button">Connect Jira</button>
        </div>
        <div class="muted" id="jira-connection" style="font-size:12px; margin-bottom:10px;">Checking Jira connection…</div>
        <div class="project-grid" id="project-grid">
          <div class="muted" style="font-size:12px;">Connect Jira to load projects.</div>
        </div>
        <div style="font-size: 13px; font-weight: 500; margin: 16px 0 10px;">Tickets to create (${tickets.length})</div>
        <div>
          ${tickets.map((t) => `<div style="display:grid; grid-template-columns:auto 1fr auto; gap:12px; padding:8px 0; font-size:13px; align-items:center;"><span class="mono muted" style="font-size:11px;">${escapeHtml(t.id)}</span><span>${escapeHtml(t.rule)}</span><span class="tag tag-lilac" style="font-size:11px;">${t.points} pts</span></div>`).join('')}
        </div>
      </div>
      <div class="modal-foot">
        <span class="muted" style="font-size: 13px;" id="jira-summary">Pick a project to continue.</span>
        <div style="display: flex; gap: 8px;">
          <button class="btn btn-secondary btn-sm" type="button" data-close>Cancel</button>
          <button class="btn btn-sm" type="button" id="jira-confirm" disabled>Create ${tickets.length} tickets</button>
        </div>
      </div>
    </div>
  </div>

  <script>
    (function () {
      var modal = document.getElementById('jira-modal');
      var openBtn = document.getElementById('add-to-jira-btn');
      var confirmBtn = document.getElementById('jira-confirm');
      var summary = document.getElementById('jira-summary');
      var projectGrid = document.getElementById('project-grid');
      var connectBtn = document.getElementById('jira-connect');
      var connectionLabel = document.getElementById('jira-connection');
      var tickets = ${JSON.stringify(tickets).replace(/</g, '\\u003c')};
      var domain = ${JSON.stringify(domain || '').replace(/</g, '\\u003c')};
      var runId = ${JSON.stringify(runId || '').replace(/</g, '\\u003c')};
      var selected = null;

      function openModal() { modal.classList.add('open'); }
      function closeModal() { modal.classList.remove('open'); }
      function renderProjects(projects) {
        if (!Array.isArray(projects) || projects.length === 0) {
          projectGrid.innerHTML = '<div class="muted" style="font-size:12px;">No projects found for this Jira connection.</div>';
          return;
        }
        projectGrid.innerHTML = projects.map(function (p) {
          var key = String(p.key || '');
          var name = String(p.name || key);
          return (
            '<button class="project-btn" data-project="' + key + '" type="button">' +
              '<span class="project-key">' + key + '</span>' +
              '<span><span style="display:block; font-weight:500;">' + name + '</span>' +
              '<span style="display:block; font-size:11px; color: var(--fg-3);">Jira project</span></span>' +
            '</button>'
          );
        }).join('');
      }
      async function refreshJiraState() {
        if (!domain) {
          connectionLabel.textContent = 'Unknown run domain — cannot connect Jira.';
          return;
        }
        connectionLabel.textContent = 'Checking Jira connection…';
        selected = null;
        confirmBtn.disabled = true;
        summary.textContent = 'Pick a project to continue.';
        try {
          var statusRes = await fetch('/api/jira/oauth/status?domain=' + encodeURIComponent(domain), { credentials: 'same-origin' });
          var statusData = await statusRes.json().catch(function () { return {}; });
          if (!statusRes.ok || !statusData.connected) {
            connectionLabel.textContent = (statusData && statusData.error) || 'Not connected. Click "Connect Jira".';
            projectGrid.innerHTML = '<div class="muted" style="font-size:12px;">Connect Jira to load projects.</div>';
            return;
          }
          connectionLabel.textContent = 'Connected to ' + (statusData.siteName || statusData.siteUrl || 'your Jira site') + '.';
          var projectsRes = await fetch('/api/jira/projects?domain=' + encodeURIComponent(domain), { credentials: 'same-origin' });
          var projectsData = await projectsRes.json().catch(function () { return {}; });
          if (!projectsRes.ok) {
            projectGrid.innerHTML = '<div class="muted" style="font-size:12px;">' + (projectsData.error || 'Failed to load projects.') + '</div>';
            return;
          }
          renderProjects(projectsData.projects || []);
        } catch (err) {
          connectionLabel.textContent = 'Failed to check Jira connection.';
          projectGrid.innerHTML = '<div class="muted" style="font-size:12px;">Network error while loading Jira projects.</div>';
        }
      }

      openBtn?.addEventListener('click', openModal);
      openBtn?.addEventListener('click', refreshJiraState);
      modal.addEventListener('click', function (e) {
        if (e.target === modal) closeModal();
      });
      modal.querySelectorAll('[data-close]').forEach(function (b) {
        b.addEventListener('click', closeModal);
      });
      connectBtn?.addEventListener('click', function () {
        if (!domain) return;
        var href = '/auth/jira/connect?domain=' + encodeURIComponent(domain);
        window.open(href, 'jira_oauth', 'width=720,height=780');
        setTimeout(refreshJiraState, 1200);
      });
      projectGrid?.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-project]');
        if (!btn) return;
        projectGrid.querySelectorAll('.project-btn').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        selected = btn.getAttribute('data-project');
        confirmBtn.disabled = false;
        summary.textContent = 'Will create ${tickets.length} issues in ' + (btn.querySelector('span span')?.textContent || selected) + '.';
      });
      confirmBtn?.addEventListener('click', async function () {
        if (!selected) return;
        confirmBtn.disabled = true;
        var prev = confirmBtn.textContent;
        confirmBtn.textContent = 'Creating…';
        summary.textContent = 'Creating Jira tickets…';
        try {
          var res = await fetch('/api/jira/sprint', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ projectKey: selected, tickets: tickets, domain: domain, runId: runId }),
          });
          var data = await res.json().catch(function () { return {}; });
          if (!res.ok) {
            summary.textContent = data.error || ('Failed to create tickets (' + res.status + ').');
            confirmBtn.disabled = false;
            confirmBtn.textContent = prev;
            return;
          }
          var count = Number(data.createdCount || 0);
          summary.textContent = 'Created ' + count + ' Jira issue' + (count === 1 ? '' : 's') + '.';
          confirmBtn.textContent = 'Created';
        } catch (err) {
          summary.textContent = 'Network error while creating Jira tickets.';
          confirmBtn.disabled = false;
          confirmBtn.textContent = prev;
        }
      });
    })();
  </script>
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
    { key: 'contrast', label: 'Color contrast', color: '#df2020', match: (i) => /contrast/i.test(i.id || '') || /contrast/i.test(i.rule || '') },
    { key: 'images', label: 'Missing alt text', color: '#eb8916', match: (i) => /img-alt|image-alt|alt/i.test(i.id || '') || /alt text|image/i.test(i.rule || '') },
    { key: 'forms', label: 'Form labels', color: '#3c81e7', match: (i) => /label|form/i.test(i.id || '') || /label|form/i.test(i.rule || '') },
    { key: 'keyboard', label: 'Keyboard nav', color: '#048255', match: (i) => /keyboard|tabindex|focus-order|focus-visible|focus/i.test(i.id || '') || /keyboard|focus|tab/i.test(i.rule || '') },
    { key: 'reader', label: 'Screen reader', color: '#6257e8', match: (i) => /aria|name-role|iframe|landmark|region|dynamic/i.test(i.id || '') || /screen reader|aria/i.test(i.rule || '') },
    { key: 'links', label: 'Link clarity', color: '#707070', match: (i) => /link/i.test(i.id || '') || /link/i.test(i.rule || '') },
    { key: 'headings', label: 'Headings', color: '#41bd73', match: (i) => /heading/i.test(i.id || '') || /heading/i.test(i.rule || '') },
  ];
  const counts = Object.fromEntries(defs.map((d) => [d.key, 0]));
  (fixOrderItems || []).forEach((item) => {
    const def = defs.find((d) => d.match(item));
    if (def) counts[def.key] += 1;
  });
  return defs.map((d) => ({ ...d, count: counts[d.key] }));
}

function buildPostDashboardSectionHtml({ fixOrderItems, scoreClamp }) {
  const cats = computeCategoryStats(fixOrderItems);
  const max = Math.max(1, ...cats.map((c) => c.count));
  const topThree = [...cats].sort((a, b) => b.count - a.count).slice(0, 3);

  return `
    <section class="extra-stats">
      <h2>Issues by category</h2>
      <div class="category-bars">
        ${cats.map((c) => `<div class="cat-item"><div class="cat-bar" style="height:${Math.max(10, Math.round((c.count / max) * 180))}px;background:${c.color};"></div><div class="cat-label">${escapeHtml(c.label)}</div></div>`).join('')}
      </div>
    </section>
    <section class="extra-stats">
      <h2>Most frequent finding types</h2>
      <div class="quick-grid">
        ${topThree.map((c) => `<div class="quick-card"><div class="quick-num" style="color:${c.color};">${c.count}</div><div class="quick-title">${escapeHtml(c.label)}</div><div class="quick-line"><span style="background:${c.color};"></span></div></div>`).join('')}
      </div>
    </section>
    <section class="extra-stats">
      <h2>How to read these numbers</h2>
      <div class="bench-note info">Automated score ${scoreClamp}/100 is not WCAG 2.2 AA or EAA conformance. Category counts come from this run only. We do not invent industry averages or lost-revenue estimates.</div>
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
  const complianceHeadline = 'Automated findings — not a conformance claim';
  const complianceNote = `Automated score ${scoreClamp}/100 is the share of applicable machine checks that passed. It is not WCAG 2.2 AA or EAA compliance.`;
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
    .kpi .value.warn { color: #b35610; }
    .kpi .value.fail { color: var(--fail); }
    .compliance-card { display: grid; grid-template-columns: 108px 1fr; gap: 16px; background: var(--bg); border: 1px solid var(--border); border-radius: 12px; padding: 16px; margin: 0 0 18px; align-items: center; }
    .score-ring { width: 88px; height: 88px; border-radius: 50%; background: conic-gradient(var(--accent) ${scoreClamp}%, var(--border) 0); display: grid; place-items: center; margin: 0 auto; }
    .score-ring::before { content: "${scoreClamp}"; width: 66px; height: 66px; border-radius: 50%; background: #fff; display: grid; place-items: center; font-weight: 700; color: #b35610; }
    .compliance-title { margin: 0 0 6px; font-size: 1.7rem; line-height: 1.15; }
    .compliance-copy { margin: 0; color: var(--text); }
    .status-row { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 10px; }
    .status-pill { padding: 6px 10px; border-radius: 8px; font-size: .92rem; font-weight: 600; }
    .status-pill.a { background: var(--pass-soft); color: var(--pass); }
    .status-pill.aa { background: var(--warn-soft); color: #b35610; }
    .status-pill.aaa { background: var(--fail-soft); color: var(--fail); }
    .stats-panels { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin: 0 0 22px; }
    .panel { background: var(--bg); border: 1px solid var(--border); border-radius: 12px; padding: 16px; }
    .panel h3 { margin: 0 0 12px; letter-spacing: .06em; text-transform: uppercase; font-size: .95rem; }
    .severity-row { display: grid; grid-template-columns: 110px 1fr 42px; align-items: center; gap: 10px; margin-bottom: 10px; }
    .severity-row .bar { height: 12px; background: #ecebea; border-radius: 999px; overflow: hidden; }
    .severity-row .fill { height: 100%; border-radius: 999px; }
    .sev-critical { background: #df2020; } .sev-serious { background: #eb8916; } .sev-moderate { background: #3c81e7; } .sev-minor { background: #707070; }
    .most-pages table { width: 100%; border-collapse: collapse; }
    .most-pages th, .most-pages td { padding: 8px 0; border-bottom: 1px solid var(--border); font-size: .95rem; }
    .most-pages th { color: var(--text-muted); font-weight: 600; }
    .sev-tag { padding: 3px 8px; border-radius: 999px; font-size: .82rem; font-weight: 600; }
    .sev-tag.critical { background: var(--fail-soft); color: var(--fail); }
    .sev-tag.serious { background: var(--warn-soft); color: #b35610; }
    .sev-tag.moderate { background: var(--info-soft); color: #294899; }
    .sev-tag.minor { background: var(--accent-soft); color: var(--text-muted); }
    .phase { padding: 16px; margin: 12px 0; border-left: 4px solid var(--accent); background: var(--accent-soft); border-radius: 0 8px 8px 0; }
    .phase h3 { margin-top: 0; }
    .roadmap { margin-top: 24px; background: var(--bg); border: 1px solid var(--border); border-radius: 12px; padding: 16px; }
    .roadmap .item { display: grid; grid-template-columns: 38px 1fr; gap: 12px; padding: 16px 0; border-top: 1px solid var(--border); }
    .roadmap .item:first-child { border-top: none; padding-top: 4px; }
    .roadmap .idx { width: 32px; height: 32px; border-radius: 999px; background: #fff; border: 1px solid var(--border); display: grid; place-items: center; font-weight: 700; color: var(--text-muted); }
    .roadmap h4 { margin: 0 0 6px; font-size: 1.08rem; line-height: 1.3; font-weight: 700; }
    .roadmap p { margin: 0 0 9px; color: var(--text); font-size: 0.98rem; }
    .badge-line { display: flex; gap: 8px; flex-wrap: wrap; }
    .badge-line .pill { padding: 5px 12px; border-radius: 999px; font-size: .88rem; line-height: 1; font-weight: 600; background: #fff; border: 1px solid var(--border); min-height: 28px; display: inline-flex; align-items: center; }
    .pill.impact-high { color: var(--fail); background: var(--fail-soft); border-color: #f5b4b4; }
    .pill.impact-medium { color: #b35610; background: var(--warn-soft); border-color: #f5d4a8; }
    .pill.impact-low { color: var(--pass); background: var(--pass-soft); border-color: #b8e8cc; }
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
    .bench-note.bad { background: var(--fail-soft); color: #872012; }
    .bench-note.info { background: var(--info-soft); color: #294899; }
    .bench-note.good { background: var(--pass-soft); color: #048255; margin-top: 0; }
    .dist-card { position: relative; background: #fff; border: 1px solid var(--border); border-radius: 10px; padding: 14px; min-height: 190px; }
    .dist-area { position: absolute; left: 14px; right: 14px; bottom: 38px; top: 36px; background: linear-gradient(180deg, rgba(144,182,221,.7) 0%, rgba(144,182,221,.5) 60%, rgba(144,182,221,.35) 100%); clip-path: polygon(0% 100%, 8% 98%, 16% 95%, 28% 88%, 40% 76%, 50% 58%, 58% 42%, 66% 30%, 75% 24%, 84% 31%, 92% 48%, 100% 70%, 100% 100%); border-top: 2px solid #2f6fb1; }
    .dist-marker { position: absolute; bottom: 62px; transform: translateX(-50%); font-size: .9rem; font-weight: 600; }
    .dist-marker::after { content: ''; position: absolute; left: 50%; transform: translateX(-50%); top: 20px; width: 2px; height: 72px; background: currentColor; opacity: .65; }
    .dist-marker.you { color: var(--fail); } .dist-marker.avg { color: #707070; }
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
    .impact-icon.warn { background: var(--fail-soft); color: var(--fail); }
    .impact-icon.cash { background: var(--warn-soft); color: #b35610; }
    .impact-icon.up { background: var(--pass-soft); color: var(--pass); }
    .impact-card h4 { margin: 0 0 6px; font-size: 1.12rem; }
    .impact-card p { margin: 0; color: var(--text); }
    .impact-highlight { margin-top: 12px; background: var(--warn-soft); color: #872012; border: 1px solid rgba(235, 137, 22, 0.35); border-radius: 10px; padding: 12px; font-size: 1.03rem; }
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
    <p class="audit-meta">Audited ${totalPages} page${totalPages === 1 ? '' : 's'} · ${auditedDate} · WCAG 2.1</p>

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
          <span class="status-pill a">Level A — not claimed</span>
          <span class="status-pill aa">Level AA — not claimed</span>
          <span class="status-pill aaa">Level AAA — not claimed</span>
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
    return '<p>This automated run recorded no failed checks or axe violations. That is not a WCAG 2.2 AA pass. Complete manual and assistive-technology testing before using official conformance wording.</p>';
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
    .placeholder { background: var(--warn-soft); padding: 2px 6px; border-radius: 4px; }
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
    <p class="meta">Draft generated ${isoDate}.${prefilledNote} This is not a published accessibility statement and not a WCAG/EAA conformance claim. Replace placeholders and complete a human review before publishing.</p>

    <div class="statement-section">
      <h2>About this statement</h2>
      <p>At ${statementStrong(sm, 'orgName', '[ORGANIZATION NAME]')}, we believe digital experiences should work for everyone. Accessibility isn’t an afterthought for us, it’s a core part of how we build and maintain <strong>${escapeHtml(siteDisplay)}</strong>. We actively work to align our website with relevant accessibility standards, and we’re committed to identifying and resolving any remaining issues to ensure an inclusive experience for all visitors.</p>
    </div>

    <div class="statement-section">
      <h2>Conformance status</h2>
      <p>The <a href="https://www.w3.org/WAI/standards-guidelines/wcag/" target="_blank" rel="noopener">Web Content Accessibility Guidelines (WCAG)</a> define three levels of conformance: Level A, Level AA, and Level AAA. The target for this draft is <strong>WCAG 2.2 Level AA</strong> (and EN 301 549 where the EAA applies).</p>
      <p>This file is an <strong>automated draft</strong>. It does not state that <strong>${escapeHtml(siteDisplay)}</strong> is fully, partially, or not conformant. Use those official terms only after a human evaluation.</p>
      <p>The following pages were included in the automated assessment:</p>
      <ul>${testedUrls.map((u) => `<li>${escapeHtml(u)}</li>`).join('')}</ul>
    </div>

    <div class="statement-section">
      <h2>Measures to support accessibility</h2>
      <p>List only measures ${statementStrong(sm, 'orgShortName', '[ORGANIZATION SHORT NAME]')} actually takes. The items below are examples from the W3C statement generator — delete any that are not true before publishing.</p>
      <ul class="measures">
        <li><span class="placeholder">[e.g. Include accessibility throughout our internal policies.]</span></li>
        <li><span class="placeholder">[e.g. Integrate accessibility into procurement.]</span></li>
        <li><span class="placeholder">[e.g. Appoint an accessibility officer.]</span></li>
        <li><span class="placeholder">[e.g. Provide accessibility training for staff.]</span></li>
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
      <p>These technologies need to work with the visitor’s browser and assistive technology. Confirm the list before publishing.</p>
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
        <li>Automated testing (custom checks and axe-core) on ${escapeHtml(created.toLocaleString())}, covering the URLs listed under Conformance status.</li>
        <li><span class="placeholder">[Add keyboard, screen-reader, and other human evaluation if completed.]</span></li>
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
