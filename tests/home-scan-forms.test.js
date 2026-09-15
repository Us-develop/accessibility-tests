import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const indexAstro = readFileSync(join(repoRoot, 'web/src/pages/index.astro'), 'utf8');
const layoutAstro = readFileSync(join(repoRoot, 'web/src/layouts/Layout.astro'), 'utf8');
const dashboard = readFileSync(join(repoRoot, 'web/src/components/ResultsDashboard.svelte'), 'utf8');
const guestLead = readFileSync(join(repoRoot, 'web/src/components/GuestLeadForm.svelte'), 'utf8');
const signupAstro = readFileSync(join(repoRoot, 'web/src/pages/signup.astro'), 'utf8');
const accountAstro = readFileSync(join(repoRoot, 'web/src/pages/account.astro'), 'utf8');
const a11yPage = readFileSync(join(repoRoot, 'web/src/pages/accessibility.astro'), 'utf8');
const pricingAstro = readFileSync(join(repoRoot, 'web/src/pages/pricing.astro'), 'utf8');
const termsAstro = readFileSync(join(repoRoot, 'web/src/pages/terms.astro'), 'utf8');
const appCss = readFileSync(join(repoRoot, 'web/public/styles/app.css'), 'utf8');
const tokensCss = readFileSync(join(repoRoot, 'web/public/styles/tokens.css'), 'utf8');
const runTestsJs = readFileSync(join(repoRoot, 'run-tests.js'), 'utf8');
const selfScan = readFileSync(join(repoRoot, 'scripts/self-scan.mjs'), 'utf8');
const chapter7 = readFileSync(join(repoRoot, 'tests/chapter7-forms.js'), 'utf8');
const loginModal = readFileSync(join(repoRoot, 'web/src/components/LoginModal.astro'), 'utf8');
const runServer = readFileSync(join(repoRoot, 'web/run-server.mjs'), 'utf8');

function formBlock(id) {
  const re = new RegExp(`<form[\\s\\S]*?id="${id}"[\\s\\S]*?>`);
  const match = indexAstro.match(re);
  assert.ok(match, `expected <form id="${id}">`);
  return match[0];
}

describe('home scan forms', () => {
  it('posts signed-in and guest scans instead of GET /?url=', () => {
    for (const id of ['guest-run-form', 'customer-run-form', 'run-form']) {
      const open = formBlock(id);
      assert.match(open, /method="post"/);
      assert.match(open, /action="\/api\/run"/);
      assert.match(open, /data-astro-reload/);
    }
  });

  it('intercepts scan submits in capture phase so ClientRouter cannot navigate to ?url=', () => {
    assert.match(indexAstro, /__wcagHomeScanBound/);
    assert.match(indexAstro, /addEventListener\(\s*'submit'/);
    assert.match(indexAstro, /form\.id === 'customer-run-form'/);
    assert.match(indexAstro, /event\.preventDefault\(\)/);
    assert.match(indexAstro, /event\.stopPropagation\(\)/);
    assert.match(indexAstro, /true\s*\)/);
    assert.match(indexAstro, /astro:page-load/);
  });

  it('announces scan form failures with role="alert" and aria-invalid on the field', () => {
    assert.match(indexAstro, /id="form-err"[^>]*role="alert"/);
    assert.match(indexAstro, /setAttribute\('aria-invalid', 'true'\)/);
    assert.match(indexAstro, /setAttribute\('aria-describedby', 'form-err'\)/);
    assert.match(indexAstro, /submit-btn[\s\S]*btn\.disabled = true/);
  });
});

describe('own product accessibility markup', () => {
  it('has a skip link targeting main', () => {
    assert.match(layoutAstro, /class="skip-link"/);
    assert.match(layoutAstro, /href="#main"/);
    assert.match(indexAstro, /<main id="main"/);
  });

  it('labels the issue drawer with aria-labelledby', () => {
    assert.match(dashboard, /aria-labelledby="issue-drawer-title"/);
    assert.match(dashboard, /id="issue-drawer-title"/);
    assert.match(dashboard, /role="dialog"/);
  });

  it('uses role="alert" on guest lead, signup, and account failures', () => {
    assert.match(guestLead, /role="alert"/);
    assert.match(signupAstro, /role=\{signupError \? 'alert' : 'status'\}/);
    assert.match(accountAstro, /setAttribute\('role', isError \? 'alert' : 'status'\)/);
  });

  it('shows signup errors next to the field that must change', () => {
    assert.match(signupAstro, /id="email-error"/);
    assert.match(signupAstro, /id="password-error"/);
    assert.match(signupAstro, /id="company-error"/);
    assert.match(signupAstro, /id="vatNumber-error"/);
    assert.match(signupAstro, /id="acceptTerms-error"/);
    assert.match(signupAstro, /function showSignupFieldError/);
    assert.match(signupAstro, /data\.field/);
    assert.match(appCss, /\.field-error \{/);
    assert.doesNotMatch(signupAstro, /for \(const field of \[email, password\]\)/);
  });

  it('does not hide custom checkboxes with display:none', () => {
    assert.match(appCss, /\.check input \{[\s\S]*clip: rect\(0, 0, 0, 0\)/);
    assert.doesNotMatch(appCss, /\.check input \{ display: none; \}/);
  });

  it('raises muted text and form borders for contrast', () => {
    assert.match(tokensCss, /--fg-3:\s+#5F5F66/);
    assert.match(tokensCss, /--border-default:\s+#8A8A8A/);
    assert.match(tokensCss, /--border-decor:\s+#D9D9D9/);
    assert.match(tokensCss, /font-weight: 400/);
  });

  it('publishes an indexable accessibility statement', () => {
    assert.match(a11yPage, /noindex=\{false\}/);
    assert.match(a11yPage, /WCAG 2\.2 Level AA/);
    const indexable = readFileSync(join(repoRoot, 'server/indexable-paths.mjs'), 'utf8');
    const robots = readFileSync(join(repoRoot, 'server/seo-routes.mjs'), 'utf8');
    assert.match(indexable, /\/accessibility/);
    assert.match(robots, /Disallow: \$\{path\}/);
  });

  it('lets run-tests.js load the page origin on loopback only when SELF_SCAN_ALLOW_LOOPBACK=1', () => {
    assert.match(runTestsJs, /originOf\(raw\) === pageOrigin/);
    assert.match(runTestsJs, /SELF_SCAN_ALLOW_LOOPBACK/);
    assert.match(runTestsJs, /requestChainLeavesAllowlist\(request, originOf\(url\)\)/);
    assert.match(runTestsJs, /serviceWorkers:\s*'block'/);
  });

  it('fails self-scan when a page does not load', () => {
    assert.match(selfScan, /no axe results \(page did not load\)/);
    assert.match(selfScan, /id === 'page-load'/);
    assert.match(selfScan, /INDEXABLE_PATHS/);
    assert.match(selfScan, /SELF_SCAN_ALLOW_LOOPBACK:\s*'1'/);
    assert.match(selfScan, /WCAG_DOTENV_OVERRIDE:\s*'0'/);
    assert.match(selfScan, /keyboard\.press\('Tab'\)/);
  });

  it('prompts for the current password on the account deletion form', () => {
    assert.match(accountAstro, /id="delete-form"/);
    assert.match(accountAstro, /id="delete-password"[^>]*name="password"[^>]*type="password"/);
    assert.match(accountAstro, /name="csrfToken"/);
    assert.match(accountAstro, /__wcagAccountDelegated/);
    assert.match(accountAstro, /api\('\/api\/account\/delete'\)/);
    assert.doesNotMatch(accountAstro, /\bprompt\s*\(/);
    assert.match(accountAstro, /id="email-form"/);
    assert.match(accountAstro, /api\('\/api\/account\/email'\)/);
    assert.match(layoutAstro, /wcagFillCsrfFields/);
  });

  it('uses the reverse-charge VAT copy on pricing and terms', () => {
    const copy =
      'Businesses outside Belgium with a valid EU VAT number are charged without VAT under the reverse-charge rule. Belgian businesses pay 21 % VAT. Prices shown include Belgian VAT; consumers in other EU countries see their local rate at checkout.';
    assert.match(pricingAstro, new RegExp(copy.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(termsAstro, new RegExp(copy.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });

  it('wraps the report tab strip before it shrinks on a phone', () => {
    assert.match(dashboard, /flex:\s*1 1 100%/);
    assert.match(dashboard, /min-width:\s*60%/);
    assert.match(tokensCss, /--stat-label:/);
    assert.match(appCss, /label:not\(\.legal-check\)/);
  });

  it('inerts every sibling of an open dialog, not only main', () => {
    assert.match(loginModal, /setOverlaySiblingsInert/);
    assert.match(dashboard, /document\.body\.children/);
    assert.match(runServer, /app\.disable\('x-powered-by'\)/);
    assert.match(runServer, /app\.set\('trust proxy'/);
  });

  it('treats wrapping labels as programmatically associated', () => {
    assert.match(chapter7, /byFor \|\| input\.closest\('label'\)/);
  });
});
