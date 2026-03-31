/**
 * Shared visual identity for HTML reports and deliverables (about-us.be / Us).
 * @see https://about-us.be/
 */

/** Head links: favicon + fonts (Bricolage Grotesque headings, Public Sans + Plus Jakarta body — matches site form). */
export const REPORT_BRAND_HEAD = `
  <link rel="icon" href="https://about-us.be/wp-content/smush-avif/2025/09/logo-us-32x32.png.avif" sizes="32x32">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,200..800&family=Plus+Jakarta+Sans:wght@400;500;600;700&family=Public+Sans:wght@400;500;600&display=swap" rel="stylesheet">
`;

/**
 * Replaces the first :root line in generate-report.js embedded styles.
 * Typography aligned with the public audit form (index.html).
 */
export const REPORT_MAIN_REPORT_CSS = `
    :root {
      --pass: #2e7d32;
      --fail: #c62828;
      --warn: #ed6c02;
      --info: #1565c0;
      --bg: #fafaf8;
      --surface: #fff;
      --text: #1a1a1a;
      --text-muted: #5c5c5c;
      --accent: #2d9d78;
      --accent-hover: #248f6a;
      --accent-soft: #e8f5f0;
      --border: #e8e6e1;
      --brand-heading: "Bricolage Grotesque", ui-serif, Georgia, serif;
      --brand-body: "Public Sans", "Plus Jakarta Sans", system-ui, sans-serif;
    }
    body { font-family: var(--brand-body); }
    h1, h2, h3, h4, header .brand, .score-value, section h2, .summary-item span, .chart-card h3, #charts-heading { font-family: var(--brand-heading); }
    a { color: var(--accent); }
    a:hover { color: var(--accent-hover); }
    .report-brand-bar {
      height: 4px;
      background: linear-gradient(90deg, var(--accent) 0%, #6bc9a8 45%, #2d9d78 100%);
      border-radius: 16px 16px 0 0;
    }
    header {
      background: linear-gradient(180deg, var(--accent-soft) 0%, var(--surface) 72%);
      padding: 24px 32px 22px;
      border-bottom: 1px solid var(--border);
    }
    .report-meta { display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 16px; }
    .report-actions { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
    .brand-row { display: flex; align-items: flex-start; gap: 16px; flex: 1; min-width: 200px; }
    .brand-logo { width: 44px; height: 44px; object-fit: contain; flex-shrink: 0; border-radius: 10px; }
    header .brand { font-family: var(--brand-heading); font-size: 1.4rem; font-weight: 700; letter-spacing: -0.03em; color: var(--text); line-height: 1.2; }
    .report-tagline {
      font-family: var(--brand-body);
      font-size: 0.72rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      color: var(--accent);
      margin: 6px 0 10px;
    }
    header h1 { font-family: var(--brand-heading); }
    .score-hero { background: linear-gradient(180deg, var(--accent-soft) 0%, var(--bg) 100%); }
    .suggested-fixes { background: var(--accent-soft) !important; }
    footer { font-family: var(--brand-body); }
    footer .footer-brand { font-weight: 600; color: var(--accent); }
`;

/** Deliverables + statement: replaces opening :root in generate-deliverables STYLES */
export const REPORT_DELIVERABLE_CSS = `
  :root {
    --pass: #2e7d32;
    --fail: #c62828;
    --warn: #ed6c02;
    --accent: #2d9d78;
    --accent-hover: #248f6a;
    --accent-soft: #e8f5f0;
    --bg: #fafaf8;
    --surface: #fff;
    --text: #1a1a1a;
    --text-muted: #5c5c5c;
    --border: #e8e6e1;
    --brand-heading: "Bricolage Grotesque", ui-serif, Georgia, serif;
    --brand-body: "Public Sans", "Plus Jakarta Sans", system-ui, sans-serif;
  }
  * { box-sizing: border-box; }
  body { font-family: var(--brand-body); margin: 0; padding: 0; background: var(--bg); color: var(--text); line-height: 1.6; }
  h1, h2, h3, h4 { font-family: var(--brand-heading); }
  a { color: var(--accent); }
  a:hover { color: var(--accent-hover); }
  .deliverable-brand-bar {
    height: 4px;
    background: linear-gradient(90deg, var(--accent) 0%, #6bc9a8 45%, #2d9d78 100%);
    border-radius: 12px 12px 0 0;
  }
  .deliverable-header {
    display: flex;
    align-items: flex-start;
    gap: 16px;
    padding: 20px 32px 16px;
    background: linear-gradient(180deg, var(--accent-soft) 0%, var(--surface) 100%);
    border-bottom: 1px solid var(--border);
    margin: 0 -32px 24px;
    width: calc(100% + 64px);
    max-width: calc(100% + 64px);
    box-sizing: border-box;
  }
  .deliverable-header .brand-logo { width: 44px; height: 44px; object-fit: contain; border-radius: 10px; flex-shrink: 0; }
  .deliverable-header .brand-mark { font-family: var(--brand-heading); font-size: 1.35rem; font-weight: 700; letter-spacing: -0.03em; color: var(--text); }
  .deliverable-header .report-tagline {
    font-size: 0.72rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--accent);
    margin: 6px 0 0;
  }
  .deliverable-header .back-to-results {
    display: inline-block;
    margin-top: 10px;
    padding: 6px 10px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: #fff;
    color: var(--text);
    font-size: 0.88rem;
    text-decoration: none;
  }
  .deliverable-header .back-to-results:hover {
    background: var(--bg);
  }
  .deliverable-footer { margin-top: 28px; padding-top: 16px; border-top: 1px solid var(--border); font-size: 0.85rem; color: var(--text-muted); }
  .deliverable-footer .footer-brand { font-weight: 600; color: var(--accent); }
`;

export const REPORT_LOGO_URL =
  'https://about-us.be/wp-content/smush-avif/2025/09/logo-us-200x200.png.avif';

/** Logo + tagline block for client/developer/statement deliverables */
export function buildDeliverableHeaderHtml() {
  return `
    <div class="deliverable-brand-bar" aria-hidden="true"></div>
    <div class="deliverable-header">
      <img class="brand-logo" src="${REPORT_LOGO_URL}" width="44" height="44" alt="Us" decoding="async" />
      <div>
        <div class="brand-mark">Us</div>
        <p class="report-tagline">Co-creating digital impact</p>
        <a class="back-to-results" href="./">Go back to results page</a>
      </div>
    </div>`;
}
