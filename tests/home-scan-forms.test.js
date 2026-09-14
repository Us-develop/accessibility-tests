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
const appCss = readFileSync(join(repoRoot, 'web/public/styles/app.css'), 'utf8');
const tokensCss = readFileSync(join(repoRoot, 'web/public/styles/tokens.css'), 'utf8');
const createApp = readFileSync(join(repoRoot, 'server/create-app.mjs'), 'utf8');

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
    assert.match(a11yPage, /indexable=\{true\}/);
    assert.match(a11yPage, /WCAG 2\.2 Level AA/);
    assert.match(createApp, /p === '\/accessibility'/);
    assert.match(createApp, /Allow: \/accessibility/);
  });
});
