import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const loading = readFileSync(join(repoRoot, 'web/src/components/LoadingMonitor.svelte'), 'utf8');
const loadingPage = readFileSync(join(repoRoot, 'web/src/pages/loading.astro'), 'utf8');
const dashboard = readFileSync(join(repoRoot, 'web/src/components/ResultsDashboard.svelte'), 'utf8');
const teaser = readFileSync(join(repoRoot, 'web/src/pages/teaser/[token].astro'), 'utf8');
const home = readFileSync(join(repoRoot, 'web/src/pages/index.astro'), 'utf8');
const pricing = readFileSync(join(repoRoot, 'web/src/pages/pricing.astro'), 'utf8');
const account = readFileSync(join(repoRoot, 'web/src/pages/account.astro'), 'utf8');
const layout = readFileSync(join(repoRoot, 'web/src/layouts/Layout.astro'), 'utf8');

describe('teaser, loading, and catalog CTAs', () => {
  it('hides empty Audit ID / on guest token loads', () => {
    assert.match(loading, /Free check in progress/);
    assert.match(loading, /Keep this tab until the snapshot link appears/);
    assert.match(loading, /\{#if guestToken\}/);
    assert.match(loadingPage, /free check/);
  });

  it('shows the automated /100 score in the teaser title, not two scores as a fraction', () => {
    assert.match(dashboard, /\$\{scoreClamp\}\/100/);
    assert.doesNotMatch(dashboard, /\$\{scoreClamp\} \/ \$\{combinedScore\}/);
    assert.match(dashboard, /\{#if !locked\}/);
    assert.match(teaser, /guestToken: token/);
  });

  it('points locked tabs at account and tokens, with one expert form', () => {
    assert.match(dashboard, /href=\{signupHref\}>Create an account/);
    assert.match(dashboard, /href="\/pricing">Buy tokens/);
    assert.match(dashboard, /href="#lead-form">Talk to a WCAG expert/);
    assert.match(teaser, /GuestLeadForm/);
    assert.doesNotMatch(teaser, /btn-secondary" href="https:\/\/about-us\.be\/contact\/"/);
  });

  it('uses public catalog copy on home, pricing, account, and the footer', () => {
    assert.match(home, /crumb=\{ssrStaff \? 'New scan' : ssrCustomer \? 'Your scan' : 'Free check'\}/);
    assert.match(home, /href="\/account" class="link">Your projects/);
    assert.match(home, /one freebie scan first/);
    assert.match(home, /\{ssrStaff \? \(/);
    assert.doesNotMatch(home, /complimentary token/);
    assert.match(home, /See pricing/);
    assert.match(home, /ctas\.signin/);
    assert.match(pricing, /developer guide, and the manual checklist/);
    assert.doesNotMatch(pricing, /sales deck, developer guide, manual checklist, Jira/);
    assert.match(account, /id="subscribe-actions"/);
    assert.match(account, /subscribeActions\.hidden = isPro/);
    assert.match(layout, /Talk to a WCAG expert/);
    assert.doesNotMatch(layout, />Us-diensten</);
  });
});
