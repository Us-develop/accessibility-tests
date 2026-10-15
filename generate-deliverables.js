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
  groupFixesByPrinciple,
  attemptedUrlsFromReport,
  primaryHostFromReport,
  pageLoadFailures,
  reportLoadedPages,
} from './report-buckets.js';
import {
  buildExecutiveSummaryHtml,
  buildChartSectionStyles,
} from './report-summary.js';
import { getWcagScLabel, compareScIds } from './wcag-sc-labels.js';
import { REPORT_BRAND_HEAD, REPORT_DELIVERABLE_CSS, buildDeliverableHeaderHtml } from './report-brand.js';
import { dateLocale, normalizeLang, translator } from './i18n/index.mjs';
import { findingsLangs } from './findings-lang.js';
import { STATEMENT_LANGS, statementFileName } from './statement-files.js';

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
 * A finding's title or message, escaped, and marked with its language when that
 * is not the document's: our own checks write in the language of the scan, axe
 * in its own (findings-lang.js).
 */
function findingHtml(text, textLang, docLang = 'en') {
  const html = escapeHtml(text);
  return textLang && textLang !== docLang && html ? `<span lang="${escapeHtml(textLang)}">${html}</span>` : html;
}

/**
 * The documents are written in the language of the scan, like the findings in them.
 * @returns {string}
 */
function documentLang(reportData) {
  return findingsLangs(reportData).custom;
}

/**
 * A dictionary text as HTML: the text is escaped, then `htmlVars` are inserted
 * as they are (links, <strong>, placeholders).
 */
function htmlText(tr, key, htmlVars = {}) {
  return escapeHtml(tr(key)).replace(/\{(\w+)\}/g, (whole, name) => (htmlVars[name] == null ? whole : String(htmlVars[name])));
}

/** Footer line with the Us tagline, which stays English. */
function footerHtml(tr, nameKey) {
  return `<span class="footer-brand">Us</span> · <span lang="en">Co-creating digital impact</span> · ${escapeHtml(tr(nameKey))}`;
}

/**
 * Developer guide deliverable, restyled to match the prototype's view-developer.jsx.
 * Static HTML; the "Add sprint to Jira" CTA opens an inline modal with vanilla JS.
 */
export function generateDeveloperAdvice(data, outputDir) {
  const { reportData, fixOrderItems, domain, runId } = data;
  const lang = documentLang(reportData);
  const tr = translator(lang);
  const date = new Date(reportData.generatedAt).toLocaleDateString(dateLocale(lang), { day: 'numeric', month: 'long', year: 'numeric' });
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
      rule: item.rule || item.id || tr('doc.dev.fixFallback'),
      textLang: item.rule ? item.textLang : lang,
      severity: sev,
      points: effort,
      occurrences: 1,
    };
  });
  const totalPoints = tickets.reduce((s, t) => s + t.points, 0);
  // Texts for the Jira dialog's script, in the document's language.
  const jiraTexts = Object.fromEntries(
    [
      'noProjects', 'project', 'unknownDomain', 'checking', 'pickToContinue', 'notConnected', 'connectToLoad',
      'connectedTo', 'yourSite', 'loadFailed', 'checkFailed', 'networkProjects', 'willCreate', 'creating',
      'creatingTickets', 'createFailed', 'createdButton', 'networkCreate',
    ].map((name) => [name, tr(`doc.dev.modal.${name}`)])
  );
  jiraTexts.createdOne = tr('doc.dev.modal.created.one');
  jiraTexts.createdOther = tr('doc.dev.modal.created.other');
  const blockers = tickets.filter((t) => t.severity === 'error').length;

  const principleGroups = groupFixesByPrinciple(fixOrderItems).map((g) => ({
    ...g,
    color: g.hex || g.color,
    textColor: g.hexText || g.textColor,
  }));

  const ticketRows = tickets.map((t) => `
        <div class="ticket-row">
          <span class="mono ticket-key">${escapeHtml(t.id)}</span>
          <span class="ticket-title">${findingHtml(t.rule, t.textLang, lang)}</span>
          <span class="ticket-assignee">${escapeHtml(t.id)}</span>
          <span class="tag tag-lilac">${t.points}</span>
          <span class="tag tag-${t.severity === 'error' ? 'error' : 'warning'}">${escapeHtml(tr(t.severity === 'error' ? 'severity.error' : 'severity.warning'))}</span>
        </div>`).join('');

  /** Principle names in the document's language (the groups carry the English label). */
  const principleLabel = (g) => {
    const key = `dash.principle.${g.key}`;
    const text = tr(key);
    return text === key ? g.label : text;
  };
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
              <span class="tag tag-${sev === 'error' ? 'error' : 'warning'}">${escapeHtml(tr(sev === 'error' ? 'severity.error' : 'severity.warning'))}</span>
              <strong>${i.rule ? findingHtml(i.rule, i.textLang, lang) : escapeHtml(i.id || tr('doc.dev.issueFallback'))}</strong>
              <span class="muted mono summary-meta">${i.id ? escapeHtml(i.id) : ''}${wcagLinks ? ` · WCAG ${wcagLinks}` : ''}</span>
            </span>
            <span class="muted summary-effort">${escapeHtml(tr.n('doc.dev.pts', effort))}</span>
          </summary>
          ${i.duplicateIdLabel ? `<p class="issue-desc"><strong>${escapeHtml(tr('dash.drawer.duplicatedIds'))}</strong> <span class="mono">${escapeHtml(i.duplicateIdLabel)}</span></p>` : ''}
          ${!i.duplicateIdLabel && i.message && i.message !== i.rule ? `<p class="issue-desc">${findingHtml(i.message, i.textLang, lang)}</p>` : ''}
          ${i.snippet ? `<p class="issue-desc">${escapeHtml(i.snippet)}</p>` : ''}
          ${(i.occurrenceDetails || []).length
            ? `<p class="issue-desc"><strong>${escapeHtml(tr('doc.dev.where'))}</strong></p><ul class="occ-list">${i.occurrenceDetails.map((d) => `<li class="mono">${escapeHtml(d)}</li>`).join('')}</ul>`
            : ''}
          ${i.url ? `<p class="muted issue-url">${escapeHtml(tr('doc.dev.foundOn'))} <span class="mono">${escapeHtml(i.url)}</span></p>` : ''}
        </details>`;
    }).join('');
    return `
      <section class="card-flat principle-card">
        <header class="principle-head">
          <span class="principle-icon" style="background:${g.color}; color:${g.textColor};" aria-hidden="true">${escapeHtml(principleLabel(g)[0])}</span>
          <h3>${escapeHtml(principleLabel(g))}</h3>
          <span class="muted">${escapeHtml(tr.n('doc.dev.issues', g.issues.length))}</span>
        </header>
        <div class="principle-body">${items}</div>
      </section>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(tr('doc.dev.title', { site: reportData.urls?.[0] || 'Accessibility' }))}</title>
  <link rel="stylesheet" href="/styles/tokens.css">
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
      --font-display: "owners-wide", "Archivo", system-ui, sans-serif;
      --font-body: "Public Sans", system-ui, sans-serif;
      --font-mono: "JetBrains Mono", ui-monospace, "SF Mono", monospace;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0; padding: 0; background: var(--us-cream); color: var(--fg-1);
      font-family: var(--font-body); font-weight: 300; line-height: 1.65;
      -webkit-font-smoothing: antialiased;
    }
    h1, h2, h3, h4 { font-family: var(--font-display); font-weight: 700; letter-spacing: normal; line-height: 1.1; margin: 0; }
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

    .header-actions { display: flex; flex-direction: column; align-items: flex-end; gap: 10px; }
    .header-actions [hidden] { display: none; }
    .jira-hint { font-size: 13px; color: var(--fg-3); max-width: 260px; text-align: right; margin: 0; }
    @media (max-width: 720px) { .header-actions { align-items: flex-start; } .jira-hint { text-align: left; } }
    .footer-foot { margin-top: 32px; padding-top: 16px; border-top: 1px solid var(--border-subtle); font-size: 13px; color: var(--fg-3); }
  </style>
</head>
<body>
  <div class="container">
    <header class="header-row">
      <div>
        ${backHref ? `<a class="btn btn-ghost btn-sm back-link" href="${backHref}">${escapeHtml(tr('cov.back'))}</a>` : ''}
        <span class="eyebrow"><span class="dot"></span>${escapeHtml(tr('doc.dev.eyebrow'))}</span>
        <h1>${escapeHtml(tr('doc.dev.h1'))}</h1>
        <p class="lead">${escapeHtml(tr.n('doc.dev.lead', tickets.length, { points: totalPoints }))}</p>
      </div>
      <div class="header-actions">
        <!-- Hidden until the server confirms this viewer may use the Jira export
             (staff, or the owner with Pro). The guide is one static file for
             every viewer, so it asks; the server checks again on every call. -->
        <button class="btn btn-grad btn-lg" id="add-to-jira-btn" type="button" hidden>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M11.5 2L2 11.5l3 3L11.5 8 18 14.5l-3 3 3 3 9.5-9.5L11.5 2z" opacity="0.95"/>
          </svg>
          ${escapeHtml(tr('doc.dev.jira'))}
        </button>
        <a class="btn btn-secondary btn-lg" href="/contact?source=developer-guide">${escapeHtml(tr('doc.dev.letUs'))}</a>
        <p class="jira-hint" id="jira-pro-hint" hidden>${escapeHtml(tr('doc.dev.jiraPro'))} <a href="/pricing#pro">${escapeHtml(tr('doc.dev.seePro'))}</a></p>
      </div>
    </header>

    <section class="stat-grid">
      <div class="stat ink">
        <div class="stat-label">${escapeHtml(tr('doc.dev.stat.sprint'))}</div>
        <div class="stat-value">${escapeHtml(tr('doc.dev.stat.sprintValue'))}</div>
        <div class="stat-sub">${escapeHtml(tr('doc.dev.stat.sprintSub'))}</div>
      </div>
      <div class="stat lilac">
        <div class="stat-label">${escapeHtml(tr('doc.dev.stat.tickets'))}</div>
        <div class="stat-value">${tickets.length}</div>
        <div class="stat-sub">${escapeHtml(tr.n('doc.dev.stat.blockers', blockers))}</div>
      </div>
      <div class="stat mint">
        <div class="stat-label">${escapeHtml(tr('doc.dev.stat.points'))}</div>
        <div class="stat-value">${totalPoints}</div>
        <div class="stat-sub">${escapeHtml(tr('doc.dev.stat.pointsSub'))}</div>
      </div>
      <div class="stat peach">
        <div class="stat-label">${escapeHtml(tr('doc.dev.stat.generated'))}</div>
        <div class="stat-value">${escapeHtml(date)}</div>
        <div class="stat-sub">${escapeHtml(tr('doc.dev.stat.generatedSub'))}</div>
      </div>
    </section>

    <section class="card-flat ticket-card">
      <div class="ticket-head">
        <h2>${escapeHtml(tr('doc.dev.tickets.h'))}</h2>
        <span class="muted" style="font-size: 13px;">${escapeHtml(tr('doc.dev.tickets.sorted'))}</span>
      </div>
      <div class="ticket-row head">
        <span>${escapeHtml(tr('doc.dev.col.id'))}</span><span>${escapeHtml(tr('doc.dev.col.title'))}</span><span>${escapeHtml(tr('doc.dev.col.rule'))}</span><span>${escapeHtml(tr('doc.dev.col.points'))}</span><span>${escapeHtml(tr('doc.dev.col.severity'))}</span>
      </div>
      ${ticketRows}
    </section>

    <h2 style="font-size: 28px; margin-bottom: 18px;">${escapeHtml(tr('doc.dev.byPrinciple'))}</h2>
    <div class="principles">
      ${principleSections || `<p class="muted">${escapeHtml(tr('doc.dev.none'))}</p>`}
    </div>
    <p class="muted" style="font-size: 11px; margin-top: 12px;">${escapeHtml(tr('doc.dev.groupedNote'))}</p>

    <div class="footer-foot">
      ${footerHtml(tr, 'doc.dev.name')}
    </div>
  </div>

  <div class="modal-backdrop" id="jira-modal" role="dialog" aria-modal="true" aria-labelledby="jira-modal-title">
    <div class="modal">
      <div class="modal-head">
        <div>
          <div class="eyebrow"><span class="dot"></span>Jira</div>
          <h2 id="jira-modal-title" style="font-size: 22px; margin-top: 6px;">${escapeHtml(tr('doc.dev.jira'))}</h2>
        </div>
        <button class="btn btn-secondary btn-sm" type="button" data-close aria-label="${escapeHtml(tr('doc.dev.modal.close'))}">✕</button>
      </div>
      <div class="modal-body">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:10px;">
          <div style="font-size: 13px; font-weight: 500;">${escapeHtml(tr('doc.dev.modal.pick'))}</div>
          <button class="btn btn-secondary btn-sm" id="jira-connect" type="button">${escapeHtml(tr('doc.dev.modal.connect'))}</button>
        </div>
        <div class="muted" id="jira-connection" style="font-size:12px; margin-bottom:10px;" role="status">${escapeHtml(tr('doc.dev.modal.checking'))}</div>
        <div class="project-grid" id="project-grid">
          <div class="muted" style="font-size:12px;">${escapeHtml(tr('doc.dev.modal.connectToLoad'))}</div>
        </div>
        <div style="font-size: 13px; font-weight: 500; margin: 16px 0 10px;">${escapeHtml(tr('doc.dev.modal.toCreate', { n: tickets.length }))}</div>
        <div>
          ${tickets.map((t) => `<div style="display:grid; grid-template-columns:auto 1fr auto; gap:12px; padding:8px 0; font-size:13px; align-items:center;"><span class="mono muted" style="font-size:11px;">${escapeHtml(t.id)}</span><span>${findingHtml(t.rule, t.textLang, lang)}</span><span class="tag tag-lilac" style="font-size:11px;">${escapeHtml(tr.n('doc.dev.pts', t.points))}</span></div>`).join('')}
        </div>
      </div>
      <div class="modal-foot">
        <span class="muted" style="font-size: 13px;" id="jira-summary" role="status">${escapeHtml(tr('doc.dev.modal.pickToContinue'))}</span>
        <div style="display: flex; gap: 8px;">
          <button class="btn btn-secondary btn-sm" type="button" data-close>${escapeHtml(tr('doc.dev.modal.cancel'))}</button>
          <button class="btn btn-sm" type="button" id="jira-confirm" disabled>${escapeHtml(tr('doc.dev.modal.create', { n: tickets.length }))}</button>
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
      // Texts in the language of this document, with {placeholders}.
      var T = ${JSON.stringify(jiraTexts).replace(/</g, '\\u003c')};
      function say(key, vars) {
        return String(T[key] || key).replace(/\\{(\\w+)\\}/g, function (whole, name) {
          return vars && vars[name] != null ? String(vars[name]) : whole;
        });
      }
      function escapeText(value) {
        return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      }
      var selected = null;

      function openModal() { modal.classList.add('open'); }
      function closeModal() { modal.classList.remove('open'); }
      function renderProjects(projects) {
        if (!Array.isArray(projects) || projects.length === 0) {
          projectGrid.innerHTML = '<div class="muted" style="font-size:12px;">' + escapeText(say('noProjects')) + '</div>';
          return;
        }
        projectGrid.innerHTML = projects.map(function (p) {
          var key = String(p.key || '');
          var name = String(p.name || key);
          return (
            '<button class="project-btn" data-project="' + key + '" type="button">' +
              '<span class="project-key">' + key + '</span>' +
              '<span><span style="display:block; font-weight:500;">' + name + '</span>' +
              '<span style="display:block; font-size:11px; color: var(--fg-3);">' + escapeText(say('project')) + '</span></span>' +
            '</button>'
          );
        }).join('');
      }
      async function refreshJiraState() {
        if (!domain) {
          connectionLabel.textContent = say('unknownDomain');
          return;
        }
        connectionLabel.textContent = say('checking');
        selected = null;
        confirmBtn.disabled = true;
        summary.textContent = say('pickToContinue');
        try {
          var statusRes = await fetch('/api/jira/oauth/status?domain=' + encodeURIComponent(domain), { credentials: 'same-origin' });
          var statusData = await statusRes.json().catch(function () { return {}; });
          if (!statusRes.ok || !statusData.connected) {
            connectionLabel.textContent = (statusData && statusData.error) || say('notConnected');
            projectGrid.innerHTML = '<div class="muted" style="font-size:12px;">' + escapeText(say('connectToLoad')) + '</div>';
            return;
          }
          connectionLabel.textContent = say('connectedTo', { site: statusData.siteName || statusData.siteUrl || say('yourSite') });
          var projectsRes = await fetch('/api/jira/projects?domain=' + encodeURIComponent(domain), { credentials: 'same-origin' });
          var projectsData = await projectsRes.json().catch(function () { return {}; });
          if (!projectsRes.ok) {
            projectGrid.innerHTML = '<div class="muted" style="font-size:12px;">' + escapeText(projectsData.error || say('loadFailed')) + '</div>';
            return;
          }
          renderProjects(projectsData.projects || []);
        } catch (err) {
          connectionLabel.textContent = say('checkFailed');
          projectGrid.innerHTML = '<div class="muted" style="font-size:12px;">' + escapeText(say('networkProjects')) + '</div>';
        }
      }

      openBtn?.addEventListener('click', openModal);
      // The app's CSRF cookie is readable by design (double-submit); state-changing
      // calls must echo it in a header.
      function csrfToken() {
        var m = document.cookie.match(/(?:^|; )wcag_csrf=([^;]*)/);
        return m ? decodeURIComponent(m[1]) : '';
      }

      // Show the Jira button only to viewers the server allows. Anyone else sees
      // the contact button, and a signed-in customer without Pro also sees why.
      (async function revealJira() {
        if (!domain || !openBtn) return;
        try {
          var res = await fetch('/api/jira/oauth/status?domain=' + encodeURIComponent(domain), { credentials: 'same-origin' });
          if (res.ok) {
            openBtn.hidden = false;
            return;
          }
          var data = await res.json().catch(function () { return {}; });
          var hint = document.getElementById('jira-pro-hint');
          if (res.status === 403 && data.code === 'pro_required' && hint) hint.hidden = false;
        } catch (e) {
          /* offline or opened as a file: the button stays hidden */
        }
      })();

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
        summary.textContent = say('willCreate', { n: ${tickets.length}, project: btn.querySelector('span span')?.textContent || selected });
      });
      confirmBtn?.addEventListener('click', async function () {
        if (!selected) return;
        confirmBtn.disabled = true;
        var prev = confirmBtn.textContent;
        confirmBtn.textContent = say('creating');
        summary.textContent = say('creatingTickets');
        try {
          var res = await fetch('/api/jira/sprint', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken() },
            credentials: 'same-origin',
            body: JSON.stringify({ projectKey: selected, tickets: tickets, domain: domain, runId: runId }),
          });
          var data = await res.json().catch(function () { return {}; });
          if (!res.ok) {
            summary.textContent = data.error || say('createFailed', { status: res.status });
            confirmBtn.disabled = false;
            confirmBtn.textContent = prev;
            return;
          }
          var count = Number(data.createdCount || 0);
          summary.textContent = say(count === 1 ? 'createdOne' : 'createdOther', { n: count });
          confirmBtn.textContent = say('createdButton');
        } catch (err) {
          summary.textContent = say('networkCreate');
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

/** Disability group names arrive in English (report-buckets.js); the dashboard's names per language. */
const DISABILITY_KEYS = {
  'Blind / screen reader': 'blind',
  'Low vision / colour vision': 'lowvision',
  'Deaf / hard of hearing': 'deaf',
  'Motor / dexterity': 'motor',
  'Cognitive / reading': 'cognitive',
  'Seizure / vestibular': 'seizure',
};
function disabilityLabel(label, tr) {
  const key = DISABILITY_KEYS[label];
  return key ? tr(`dash.disab.${key}`) : label;
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

function computeCategoryStats(fixOrderItems, tr = translator('en')) {
  const defs = [
    { key: 'contrast', label: tr('doc.client.cat.contrast'), color: '#df2020', match: (i) => /contrast/i.test(i.id || '') || /contrast/i.test(i.rule || '') },
    { key: 'images', label: tr('doc.client.cat.images'), color: '#eb8916', match: (i) => /img-alt|image-alt|alt/i.test(i.id || '') || /alt text|image/i.test(i.rule || '') },
    { key: 'forms', label: tr('doc.client.cat.forms'), color: '#3c81e7', match: (i) => /label|form/i.test(i.id || '') || /label|form/i.test(i.rule || '') },
    { key: 'keyboard', label: tr('doc.client.cat.keyboard'), color: '#048255', match: (i) => /keyboard|tabindex|focus-order|focus-visible|focus/i.test(i.id || '') || /keyboard|focus|tab/i.test(i.rule || '') },
    { key: 'reader', label: tr('doc.client.cat.reader'), color: '#6257e8', match: (i) => /aria|name-role|iframe|landmark|region|dynamic/i.test(i.id || '') || /screen reader|aria/i.test(i.rule || '') },
    { key: 'links', label: tr('doc.client.cat.links'), color: '#707070', match: (i) => /link/i.test(i.id || '') || /link/i.test(i.rule || '') },
    { key: 'headings', label: tr('doc.client.cat.headings'), color: '#41bd73', match: (i) => /heading/i.test(i.id || '') || /heading/i.test(i.rule || '') },
  ];
  const counts = Object.fromEntries(defs.map((d) => [d.key, 0]));
  (fixOrderItems || []).forEach((item) => {
    const def = defs.find((d) => d.match(item));
    if (def) counts[def.key] += 1;
  });
  return defs.map((d) => ({ ...d, count: counts[d.key] }));
}

function buildPostDashboardSectionHtml({ fixOrderItems, scoreClamp, tr = translator('en') }) {
  const cats = computeCategoryStats(fixOrderItems, tr);
  const max = Math.max(1, ...cats.map((c) => c.count));
  const topThree = [...cats].sort((a, b) => b.count - a.count).slice(0, 3);

  return `
    <section class="extra-stats">
      <h2>${escapeHtml(tr('doc.client.categories'))}</h2>
      <div class="category-bars">
        ${cats.map((c) => `<div class="cat-item"><div class="cat-bar" style="height:${Math.max(10, Math.round((c.count / max) * 180))}px;background:${c.color};"></div><div class="cat-label">${escapeHtml(c.label)}</div></div>`).join('')}
      </div>
    </section>
    <section class="extra-stats">
      <h2>${escapeHtml(tr('doc.client.frequent'))}</h2>
      <div class="quick-grid">
        ${topThree.map((c) => `<div class="quick-card"><div class="quick-num" style="color:${c.color};">${c.count}</div><div class="quick-title">${escapeHtml(c.label)}</div><div class="quick-line"><span style="background:${c.color};"></span></div></div>`).join('')}
      </div>
    </section>
    <section class="extra-stats">
      <h2>${escapeHtml(tr('doc.client.howToRead'))}</h2>
      <div class="bench-note info">${escapeHtml(tr('doc.client.howToReadBody', { score: scoreClamp }))}</div>
    </section>
  `;
}


export function generateClientPresentation(data, outputDir) {
  const { reportData, fixOrderItems, disabilityStats, score, scoreClamp, pass, fail, warn, totalAxeViolations, total } = data;
  const lang = documentLang(reportData);
  const tr = translator(lang);
  const issuesCount = fail + warn + totalAxeViolations;
  const uniqueByRule = (items) => [...new Map(items.map((i) => [i.rule, i])).values()];
  const { host: siteHost } = deriveSiteUrls(reportData);
  const auditedDate = new Date(reportData.generatedAt).toLocaleDateString(dateLocale(lang), { day: 'numeric', month: 'long', year: 'numeric' });
  const metrics = computeClientIssueMetrics(reportData, fixOrderItems);
  const criticalIssues = metrics.severity.critical;
  const totalPages = (reportData.urls || []).length;
  const pagesAffected = metrics.pagesAffected;
  const mostAffected = metrics.mostAffectedPages.slice(0, 7);
  const complianceHeadline = tr('doc.client.compliance.headline');
  const complianceNote = tr('doc.client.compliance.note', { score: scoreClamp });
  const topRoadmap = uniqueByRule(fixOrderItems).slice(0, 5);

  let html = `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(tr('doc.client.title'))}</title>
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
    ${buildDeliverableHeaderHtml(tr)}
    <p class="audit-kicker">${escapeHtml(tr('doc.client.kicker'))}</p>
    <h1 class="audit-domain">${escapeHtml(siteHost)}</h1>
    <p class="audit-meta">${escapeHtml(tr.n('doc.client.meta', totalPages, { date: auditedDate }))}</p>

    <section class="kpi-grid" aria-label="${escapeHtml(tr('doc.client.kpi.label'))}">
      <div class="kpi"><div class="label">${escapeHtml(tr('doc.client.kpi.errorsScore'))}</div><div class="value warn">${scoreClamp} / 100</div></div>
      <div class="kpi"><div class="label">${escapeHtml(tr('doc.client.kpi.total'))}</div><div class="value">${issuesCount}</div></div>
      <div class="kpi"><div class="label">${escapeHtml(tr('doc.client.kpi.critical'))}</div><div class="value fail">${criticalIssues}</div></div>
      <div class="kpi"><div class="label">${escapeHtml(tr('doc.client.kpi.pages'))}</div><div class="value">${pagesAffected} / ${Math.max(1, totalPages)}</div></div>
    </section>

    <section class="compliance-card" aria-label="${escapeHtml(tr('doc.client.compliance.label'))}">
      <div class="score-ring" aria-hidden="true"></div>
      <div>
        <h2 class="compliance-title">${escapeHtml(complianceHeadline)}</h2>
        <p class="compliance-copy">${escapeHtml(complianceNote)}</p>
        <div class="status-row">
          <span class="status-pill a">${escapeHtml(tr('doc.client.level.a'))}</span>
          <span class="status-pill aa">${escapeHtml(tr('doc.client.level.aa'))}</span>
          <span class="status-pill aaa">${escapeHtml(tr('doc.client.level.aaa'))}</span>
        </div>
      </div>
    </section>

    <section class="stats-panels">
      <div class="panel">
        <h3>${escapeHtml(tr('doc.client.bySeverity'))}</h3>
        ${[
          [tr('doc.client.sev.critical'), metrics.severity.critical, 'sev-critical'],
          [tr('doc.client.sev.serious'), metrics.severity.serious, 'sev-serious'],
          [tr('doc.client.sev.moderate'), metrics.severity.moderate, 'sev-moderate'],
          [tr('doc.client.sev.minor'), metrics.severity.minor, 'sev-minor'],
        ].map(([label, value, cls]) => {
          const max = Math.max(1, metrics.severity.critical, metrics.severity.serious, metrics.severity.moderate, metrics.severity.minor);
          const pct = Math.round((Number(value) / max) * 100);
          return `<div class="severity-row"><div>${escapeHtml(label)}</div><div class="bar"><div class="fill ${cls}" style="width:${pct}%"></div></div><div>${value}</div></div>`;
        }).join('')}
      </div>
      <div class="panel most-pages">
        <h3>${escapeHtml(tr('doc.client.mostAffected'))}</h3>
        <table>
          <thead><tr><th>${escapeHtml(tr('doc.client.col.page'))}</th><th>${escapeHtml(tr('doc.client.col.issues'))}</th><th>${escapeHtml(tr('doc.client.col.worst'))}</th></tr></thead>
          <tbody>
            ${(mostAffected.length ? mostAffected : [{ url: '—', issues: 0, worst: 'minor' }]).map((row) => {
              let label = row.url;
              try {
                const u = new URL(row.url);
                label = u.pathname || '/';
              } catch {}
              return `<tr><td>${escapeHtml(label)}</td><td>${row.issues}</td><td><span class="sev-tag ${row.worst}">${escapeHtml(tr(`doc.client.sev.${row.worst}`))}</span></td></tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </section>

    ${buildPostDashboardSectionHtml({
      fixOrderItems,
      scoreClamp,
      tr,
      criticalIssues,
      pagesAffected,
      mostAffectedPages: metrics.mostAffectedPages,
    })}

    <section class="roadmap">
      <h2>${escapeHtml(tr('doc.client.roadmap'))}</h2>
      <p>${escapeHtml(tr('doc.client.roadmapLead'))}</p>
      ${topRoadmap.map((item, idx) => {
        const impact = (item.impact || 'medium').toLowerCase();
        const effort = (item.effort || 'moderate').toLowerCase();
        const eta = tr(effort === 'simple' ? (impact === 'high' ? 'doc.client.eta.hours' : 'doc.client.eta.short') : effort === 'moderate' ? 'doc.client.eta.day' : 'doc.client.eta.days');
        const impactLabel = tr(impact === 'high' ? 'doc.client.impact.high' : impact === 'low' ? 'doc.client.impact.low' : 'doc.client.impact.medium');
        const effortLabel = tr(effort === 'simple' ? 'doc.client.effort.simple' : effort === 'moderate' ? 'doc.client.effort.moderate' : 'doc.client.effort.complex');
        const desc = item.url ? tr('doc.client.desc.url', { url: item.url }) : tr('doc.client.desc.global');
        return `<div class="item">
          <div class="idx">${idx + 1}</div>
          <div>
            <h4>${findingHtml(item.rule, item.textLang, lang)}</h4>
            <p>${escapeHtml(desc)}</p>
            <div class="badge-line">
              <span class="pill impact-${impact === 'high' ? 'high' : impact === 'low' ? 'low' : 'medium'}">${escapeHtml(impactLabel)}</span>
              <span class="pill">${escapeHtml(effortLabel)}</span>
              <span class="pill">${escapeHtml(eta)}</span>
            </div>
          </div>
        </div>`;
      }).join('')}
    </section>

    <h2>${escapeHtml(tr('doc.client.disability'))}</h2>
    <p>${escapeHtml(tr('doc.client.disabilityLead'))}</p>
    <div class="stats-grid">
      ${Object.entries(disabilityStats)
        .filter(([k, v]) => v > 0 && k !== 'Various')
        .map(([k, v]) => `<div class="stat-card"><span>${v}</span><small>${escapeHtml(disabilityLabel(k, tr))}</small></div>`)
        .join('')}
    </div>

    <p style="margin-top: 32px; font-size: 0.9rem; color: var(--text-muted);">
      ${escapeHtml(tr('doc.client.footerNote'))}
    </p>
    <div class="deliverable-footer">${footerHtml(tr, 'doc.client.name')}</div>
  </div>
</body>
</html>`;

  const path = join(outputDir, 'accessibility-client.html');
  writeFileSync(path, html, 'utf8');
  return path;
}

function deriveSiteUrls(reportData) {
  const urls = attemptedUrlsFromReport(reportData);
  const first = urls[0];
  const host = primaryHostFromReport(reportData) || 'this scan';
  if (!first) {
    return { display: host, host };
  }
  try {
    const u = new URL(first);
    return { display: `${u.origin}/`, host: u.hostname.replace(/^www\./i, '') || host };
  } catch {
    return { display: first, host };
  }
}

function writeFailedLoadDeliverables(data, outputDir) {
  const reportData = data?.reportData || {};
  const lang = documentLang(reportData);
  const tr = translator(lang);
  const host = primaryHostFromReport(reportData) || data?.domain || tr('dash.thisScan');
  const failures = pageLoadFailures(reportData);
  const items = failures
    .map(
      (row) =>
        `<li><code>${escapeHtml(row.url || '')}</code>: ${row.message ? `<span lang="en">${escapeHtml(row.message)}</span>` : escapeHtml(tr('doc.failed.pageFailed'))}</li>`
    )
    .join('');
  const list = items ? `<ul>${items}</ul>` : `<p>${escapeHtml(tr('doc.failed.noPages'))}</p>`;

  const html = (title) => `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${escapeHtml(title)} · ${escapeHtml(host)}</title>
  ${REPORT_BRAND_HEAD}
  <style>
${REPORT_DELIVERABLE_CSS}
    .container { max-width: 720px; margin: 0 auto; padding: 32px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>${escapeHtml(tr('doc.failed.h1', { title }))}</h1>
    <p>${htmlText(tr, 'doc.failed.body', { host: `<strong>${escapeHtml(host)}</strong>` })}</p>
    ${list}
    <p>${escapeHtml(tr('doc.failed.retry'))}</p>
  </div>
</body>
</html>`;

  const paths = {
    developers: join(outputDir, 'accessibility-developers.html'),
    client: join(outputDir, 'accessibility-client.html'),
    statement: join(outputDir, 'accessibility-statement.html'),
  };
  writeFileSync(paths.developers, html(tr('doc.failed.dev')), 'utf8');
  writeFileSync(paths.client, html(tr('doc.failed.sales')), 'utf8');
  writeFileSync(paths.statement, html(tr('doc.failed.statement')), 'utf8');
  return paths;
}

function dedupeFindingsByRule(items) {
  const byRule = new Map();
  for (const it of items) {
    const rule = it.rule || '';
    if (!byRule.has(rule)) byRule.set(rule, { urls: new Set(), textLang: it.textLang });
    if (it.url) byRule.get(rule).urls.add(it.url);
  }
  return [...byRule.entries()].map(([rule, entry]) => ({
    rule,
    textLang: entry.textLang,
    urls: [...entry.urls].sort(),
  }));
}

function buildLimitationBlocks(fixOrderItems, tr = translator('en')) {
  const lang = tr.lang;
  if (!fixOrderItems.length) {
    return `<p>${escapeHtml(tr('doc.stmt.limits.none'))}</p>`;
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
    const { title, level } = getWcagScLabel(key, lang);
    const heading =
      key === '_other'
        ? tr('doc.stmt.limits.otherFindings')
        : tr('doc.stmt.limits.heading', { id: key, title, level });
    const scLink = key !== '_other' ? wcagScUrl(key) : null;
    const rows = dedupeFindingsByRule(items);
    html += '<div class="limitation-block">';
    html += `<h4 class="limitation-sc">${escapeHtml(heading)}</h4>`;
    if (scLink) {
      const link = `<a href="${scLink}" target="_blank" rel="noopener" hreflang="en">${escapeHtml(tr('doc.stmt.limits.understandingLink', { id: key, title }))}</a>`;
      html += `<p class="wcag-understanding">${htmlText(tr, 'doc.stmt.limits.understanding', { link })}</p>`;
      html += `<p class="wcag-note">${escapeHtml(tr('doc.stmt.limits.wcagNote'))}</p>`;
    } else {
      html += `<p class="wcag-note">${escapeHtml(tr('doc.stmt.limits.otherNote'))}</p>`;
    }
    for (const row of rows) {
      const pages =
        row.urls.length > 0
          ? `<span class="finding-url">${htmlText(tr, 'doc.affectedPages', { pages: row.urls.map((u) => escapeHtml(u)).join('; ') })}</span>`
          : '';
      html += `<p class="finding"><strong>${findingHtml(row.rule, row.textLang, lang)}</strong>${pages ? `<br>${pages}` : ''}</p>`;
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

function statementResponseDaysLine(meta, placeholder = '[NUMBER]') {
  const d = meta?.responseDays;
  if (d != null && Number.isFinite(Number(d)) && Number(d) > 0) {
    return escapeHtml(String(Number(d)));
  }
  return `<span class="placeholder">${escapeHtml(placeholder)}</span>`;
}

function renderAccessibilityStatement(data, lang) {
  const { reportData, fixOrderItems, statementMeta: smRaw } = data;
  const tr = translator(lang);
  const sm = smRaw && typeof smRaw === 'object' ? smRaw : {};
  const isoDate = new Date().toISOString().slice(0, 10);
  const testedUrls = reportData.urls || [];
  const { display: siteDisplay, host: siteHost } = deriveSiteUrls(reportData);
  const created = new Date(reportData.generatedAt || Date.now());
  const monthYear = created.toLocaleString(dateLocale(lang), { month: 'long', year: 'numeric' });
  const limitationsHtml = buildLimitationBlocks(fixOrderItems, tr);
  const prefilledNote = hasStatementMeta(sm) ? tr('doc.stmt.prefilled') : '';
  const org = statementStrong(sm, 'orgName', tr('doc.stmt.ph.org'));
  const orgShort = statementStrong(sm, 'orgShortName', tr('doc.stmt.ph.orgShort'));
  const siteStrong = `<strong>${escapeHtml(siteDisplay)}</strong>`;
  const host = escapeHtml(siteHost);

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

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(tr('doc.stmt.title', { host: siteHost }))}</title>
  ${REPORT_BRAND_HEAD}
  <style>${STYLES}
    ${STATEMENT_EXTRA_STYLES}
  </style>
</head>
<body>
  <div class="container">
    ${buildDeliverableHeaderHtml(tr)}
    <h1>${escapeHtml(tr('doc.stmt.h1', { host: siteHost }))}</h1>
    <p class="meta">${escapeHtml(tr('doc.stmt.meta', { date: isoDate, prefilled: prefilledNote }))}</p>

    <div class="statement-section">
      <h2>${escapeHtml(tr('doc.stmt.about.h'))}</h2>
      <p>${htmlText(tr, 'doc.stmt.about.body', { org, site: siteStrong })}</p>
    </div>

    <div class="statement-section">
      <h2>${escapeHtml(tr('doc.stmt.status.h'))}</h2>
      <p>${htmlText(tr, 'doc.stmt.status.levels', {
        wcag: `<a href="https://www.w3.org/WAI/standards-guidelines/wcag/" target="_blank" rel="noopener">${escapeHtml(tr('doc.stmt.status.wcag'))}</a>`,
        target: `<strong>${escapeHtml(tr('doc.stmt.status.target'))}</strong>`,
      })}</p>
      <p>${htmlText(tr, 'doc.stmt.status.draft', { draft: `<strong>${escapeHtml(tr('doc.stmt.status.draftWord'))}</strong>`, site: siteStrong })}</p>
      <p>${escapeHtml(tr('doc.stmt.status.pages'))}</p>
      <ul>${testedUrls.map((u) => `<li>${escapeHtml(u)}</li>`).join('')}</ul>
    </div>

    <div class="statement-section">
      <h2>${escapeHtml(tr('doc.stmt.measures.h'))}</h2>
      <p>${htmlText(tr, 'doc.stmt.measures.p', { org: orgShort })}</p>
      <ul class="measures">
        ${[1, 2, 3, 4].map((n) => `<li><span class="placeholder">${escapeHtml(tr(`doc.stmt.measures.${n}`))}</span></li>`).join('\n        ')}
      </ul>
    </div>

    <div class="statement-section">
      <h2>${escapeHtml(tr('doc.stmt.tech.h'))}</h2>
      <p>${htmlText(tr, 'doc.stmt.tech.p', { site: siteStrong })}</p>
      <ul class="tech-list">
        <li>HTML</li>
        <li>WAI-ARIA</li>
        <li>CSS</li>
        <li>JavaScript</li>
      </ul>
      <p>${escapeHtml(tr('doc.stmt.tech.confirm'))}</p>
    </div>

    <div class="statement-section">
      <h2>${escapeHtml(tr('doc.stmt.feedback.h'))}</h2>
      <p>${htmlText(tr, 'doc.stmt.feedback.p', { host })}</p>
      <div class="contact-block">
        <p><strong>${escapeHtml(tr('doc.stmt.feedback.phone'))}</strong> ${statementSpan(sm, 'phone', tr('doc.stmt.ph.phone'))}</p>
        <p><strong>${escapeHtml(tr('doc.stmt.feedback.email'))}</strong> ${statementSpan(sm, 'email', tr('doc.stmt.ph.email'))}</p>
        <p><strong>${escapeHtml(tr('doc.stmt.feedback.visitor'))}</strong> ${statementSpan(sm, 'visitorAddress', tr('doc.stmt.ph.address'))}</p>
        <p><strong>${escapeHtml(tr('doc.stmt.feedback.postal'))}</strong> ${statementSpan(sm, 'postalAddress', tr('doc.stmt.ph.address'))}</p>
      </div>
      <p>${htmlText(tr, 'doc.stmt.feedback.respond', { days: statementResponseDaysLine(sm, tr('doc.stmt.ph.number')) })}</p>
    </div>

    <div class="statement-section">
      <h2>${escapeHtml(tr('doc.stmt.limits.h'))}</h2>
      <p>${htmlText(tr, 'doc.stmt.limits.p', { host })}</p>
      <h3>${escapeHtml(tr('doc.stmt.limits.known', { site: siteDisplay }))}</h3>
      ${limitationsHtml}
      <p class="placeholder" style="margin-top: 20px; padding: 12px; border-radius: 8px; font-size: 0.9rem;">${escapeHtml(tr('doc.stmt.limits.manual'))}</p>
    </div>

    <div class="statement-section">
      <h2>${escapeHtml(tr('doc.stmt.approach.h'))}</h2>
      <p>${htmlText(tr, 'doc.stmt.approach.p', { org: orgShort, site: siteStrong })}</p>
      <ul class="eval-list">
        <li>${escapeHtml(tr('doc.stmt.approach.auto', { date: created.toLocaleString(dateLocale(lang)) }))}</li>
        <li><span class="placeholder">${escapeHtml(tr('doc.stmt.approach.manual'))}</span></li>
      </ul>
    </div>

    <div class="statement-section">
      <h2>${escapeHtml(tr('doc.stmt.date.h'))}</h2>
      <p>${htmlText(tr, 'doc.stmt.date.p', { month: `<strong>${escapeHtml(monthYear)}</strong>` })}</p>
    </div>

    <p style="margin-top: 32px; font-size: 0.85rem; color: var(--text-muted);">
      ${htmlText(tr, 'doc.stmt.generated', {
        guide: `<a href="https://www.w3.org/WAI/planning/statements/" target="_blank" rel="noopener" hreflang="en">${escapeHtml(tr('doc.stmt.guide'))}</a>`,
      })}
    </p>
    <div class="deliverable-footer">${footerHtml(tr, 'doc.stmt.name')}</div>
  </div>
</body>
</html>`;
}

/**
 * Writes the statement in every statement language, plus the scan's language
 * under the plain name that older links use.
 * @returns {string} path of the statement in the scan's language
 */
export function generateAccessibilityStatement(data, outputDir) {
  const scanLang = documentLang(data.reportData);
  for (const lang of STATEMENT_LANGS) {
    writeFileSync(join(outputDir, statementFileName(lang)), renderAccessibilityStatement(data, lang), 'utf8');
  }
  const path = join(outputDir, 'accessibility-statement.html');
  writeFileSync(path, renderAccessibilityStatement(data, scanLang), 'utf8');
  return path;
}

export function generateAllDeliverables(data, outputDir) {
  if (!reportLoadedPages(data?.reportData)) {
    return writeFailedLoadDeliverables(data, outputDir);
  }
  const paths = {
    developers: generateDeveloperAdvice(data, outputDir),
    client: generateClientPresentation(data, outputDir),
    statement: generateAccessibilityStatement(data, outputDir),
  };
  return paths;
}
