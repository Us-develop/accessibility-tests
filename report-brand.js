/**
 * Shared visual identity for HTML reports and deliverables — US Design System (Light).
 * @see DESIGN_SYSTEM_AGENT.md in us-design-system repo.
 */

/** Head links: favicon + fonts (Bricolage Grotesque + Public Sans). */
export const REPORT_BRAND_HEAD = `
  <link rel="icon" href="/assets/us-favicon.png" type="image/png" sizes="88x88">
  <link rel="apple-touch-icon" href="/assets/us-favicon.png">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..800&family=Public+Sans:ital,wght@0,300..900;1,400..700&display=swap" rel="stylesheet">
`;

/**
 * Prepended to generate-report.js embedded styles (after opening `<style>`).
 */
export const REPORT_MAIN_REPORT_CSS = `
    :root {
      --pass: #41bd73;
      --fail: #df2020;
      --warn: #eb8916;
      --info: #3c81e7;
      --pass-soft: #e6ffef;
      --fail-soft: #fdecec;
      --warn-soft: #fff4e8;
      --info-soft: #e8f0fc;
      --bg: #ffffff;
      --surface: #ffffff;
      --text: #191a1b;
      --text-muted: #707070;
      --accent: #191a1b;
      --accent-hover: #494949;
      --accent-soft: #f3f3f3;
      --border: #eaeaea;
      --link: #4f72cd;
      --link-hover: #294899;
      --lavender: #bdb4ff;
      --mint: #8dffb7;
      --watercourse: #048255;
      --brand-heading: "Bricolage Grotesque", ui-serif, Georgia, serif;
      --brand-body: "Public Sans", system-ui, sans-serif;
    }
    body { font-family: var(--brand-body); color: var(--text); }
    h1, h2, h3, h4, header .brand, .score-value, section h2, .summary-item span, .chart-card h3, #charts-heading { font-family: var(--brand-heading); }
    a { color: var(--link); }
    a:hover { color: var(--link-hover); }
    .report-brand-bar {
      height: 4px;
      background: linear-gradient(90deg, var(--lavender) 0%, var(--mint) 45%, var(--watercourse) 100%);
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
    --pass: #41bd73;
    --fail: #df2020;
    --warn: #eb8916;
    --info: #3c81e7;
    --pass-soft: #e6ffef;
    --fail-soft: #fdecec;
    --warn-soft: #fff4e8;
    --info-soft: #e8f0fc;
    --accent: #191a1b;
    --accent-hover: #494949;
    --accent-soft: #f3f3f3;
    --bg: #ffffff;
    --surface: #fff;
    --text: #191a1b;
    --text-muted: #707070;
    --border: #eaeaea;
    --link: #4f72cd;
    --link-hover: #294899;
    --lavender: #bdb4ff;
    --mint: #8dffb7;
    --watercourse: #048255;
    --brand-heading: "Bricolage Grotesque", ui-serif, Georgia, serif;
    --brand-body: "Public Sans", system-ui, sans-serif;
  }
  * { box-sizing: border-box; }
  body { font-family: var(--brand-body); margin: 0; padding: 0; background: var(--bg); color: var(--text); line-height: 1.6; }
  h1, h2, h3, h4 { font-family: var(--brand-heading); }
  a { color: var(--link); }
  a:hover { color: var(--link-hover); }
  .deliverable-brand-bar {
    height: 4px;
    background: linear-gradient(90deg, var(--lavender) 0%, var(--mint) 45%, var(--watercourse) 100%);
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
    font-family: var(--brand-heading);
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
