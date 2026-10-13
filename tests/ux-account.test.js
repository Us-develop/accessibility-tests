import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(repoRoot, path), 'utf8');
const account = read('web/src/pages/account.astro');
const audits = read('web/src/pages/audits.astro');
const header = read('web/src/components/AppHeader.astro');

/** Position of each marker in the file, asserting they all exist. */
function positions(source, markers) {
  return markers.map((marker) => {
    const at = source.indexOf(marker);
    assert.ok(at > 0, `missing: ${marker}`);
    return at;
  });
}

describe('account page layout', () => {
  it('orders the sections as agreed', () => {
    const at = positions(account, [
      'id="projects"',
      'id="scan-history"',
      'id="subscription"',
      'id="tokens"',
      'id="payments"',
      'id="personal"',
      'id="delete-open"',
    ]);
    assert.deepEqual(at, [...at].sort((a, b) => a - b));
  });

  it('has a sidebar with the balance and a link to every section', () => {
    const nav = account.slice(account.indexOf('<nav class="account-nav'), account.indexOf('</nav>'));
    assert.match(nav, /aria-label="Account sections"/);
    assert.match(nav, /id="account-nav-balance"/);
    for (const id of ['projects', 'scan-history', 'subscription', 'tokens', 'payments', 'personal']) {
      assert.match(nav, new RegExp(`href="#${id}"`), `sidebar links to #${id}`);
      assert.match(account, new RegExp(`<h2 id="${id}" tabindex="-1">`), `#${id} is a focusable heading`);
    }
    assert.match(account, /balanceLong\(balance\)/);
  });

  it('puts the actions at the top of the page', () => {
    const [actions, firstSection] = positions(account, ['class="account-actions"', 'id="projects-card"']);
    assert.ok(actions < firstSection);
    const block = account.slice(actions, account.indexOf('</div>', actions));
    assert.match(block, /href="\/">Scan a page</);
    assert.match(block, /href="\/audits">All scans</);
    assert.match(block, /Export JSON/);
    assert.match(block, /Export CSV/);
    assert.equal(account.split('class="account-actions"').length - 1, 1, 'only one actions row');
  });

  it('makes deleting a small link with a confirm step', () => {
    assert.match(account, /<button type="button" class="linklike" id="delete-open" aria-expanded="false" aria-controls="delete-card">Delete my account<\/button>/);
    assert.match(account, /<section id="delete-card" class="card stack-form account-section" hidden>/);
    assert.match(account, /Yes, delete my account/);
    assert.match(account, /id="delete-cancel">Keep my account/);
    assert.match(account, /function openDeleteConfirm/);
    assert.match(account, /document\.getElementById\('delete-title'\)\?\.focus\(\)/);
    assert.doesNotMatch(account, /if \(deleteCard\) deleteCard\.hidden = false;/);
  });

  it('really hides sections marked hidden', () => {
    // .stack-form sets display: grid, which beats the hidden attribute on its own.
    assert.match(account, /\.account-section\[hidden\] \{\s*display: none;/);
  });

  it('shows each message next to the form that caused it', () => {
    for (const [form, msg] of [
      ['contact-form', 'contact-msg'],
      ['password-form', 'password-msg'],
      ['email-form', 'email-msg'],
      ['delete-form', 'delete-msg'],
    ]) {
      const start = account.indexOf(`<form id="${form}"`);
      const end = account.indexOf('</form>', start);
      assert.match(account.slice(start, end), new RegExp(`<p id="${msg}" class="muted" role="status">`), `${msg} is inside ${form}`);
      assert.match(account, new RegExp(`'${msg}'\\)`), `${msg} is used by the script`);
    }
    assert.match(account, /'billing-portal-msg'\)/);
    // The old behaviour: every message went to the Tokens card.
    assert.doesNotMatch(account, /const billing = document\.getElementById\('account-billing-msg'\);/);
  });
});

describe('all scans page', () => {
  it('speaks to customers, not only staff', () => {
    assert.match(audits, /<h1 class="audits-title">All scans<\/h1>/);
    assert.match(audits, /Start new scan/);
    assert.doesNotMatch(audits, /Staff list/);
    assert.doesNotMatch(audits, /staff sign in/);
    assert.doesNotMatch(audits, /\/report\/&lt;domain&gt;/);
  });

  it('loads on a view transition as well as on a full page load', () => {
    assert.match(audits, /globalThis\.__wcagAuditsBound/);
    assert.match(audits, /document\.addEventListener\('astro:page-load', \(\) => loadAudits\(\)\)/);
    assert.doesNotMatch(audits, /addEventListener\('DOMContentLoaded'/);
    assert.doesNotMatch(audits, /refreshBtn\?\.addEventListener/);
  });

  it('is linked from the header for every signed-in user', () => {
    assert.match(header, /class="btn btn-sm btn-secondary btn-all-scans wcag-header-account"\s+href="\/audits"/);
    // Hidden for guests by the existing rule for .wcag-header-account.
    assert.match(header, /body:not\(\.is-staff\):not\(\.is-customer\)\) \.wcag-header-account/);
  });
});
