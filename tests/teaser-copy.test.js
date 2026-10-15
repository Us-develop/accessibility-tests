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

  it('shows the overall score and its three parts to guests too, never the errors score alone', () => {
    // A guest has not reviewed or ticked anything, so a clean scan must not read 100.
    assert.match(dashboard, /\{combinedScore != null \? `\$\{combinedScore\}\/100` : 'n\/a'\}/);
    assert.match(dashboard, /<ScoreDonut score=\{combinedScore\}/);
    assert.match(dashboard, /\{#if scoreParts\.length > 0\}/);
    assert.doesNotMatch(dashboard, /locked \? 'Errors score'/);
    assert.doesNotMatch(dashboard, /The errors score is 100 when/);
    assert.match(dashboard, /pagesScannedCount === 1 \? 'page' : 'pages'/);
    // The teaser passes the number of findings to review, not their rule and page names.
    assert.match(teaser, /reviewKeys: \(payload\.scoreModel\?\.reviewKeys \|\| \[\]\)\.map\(\(_, i\) => `locked-\$\{i\}`\)/);
    assert.doesNotMatch(teaser, /reviewKeys: \[\]/);
    assert.match(teaser, /manualInitialChecked: \[\]/);
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
    // The pricing cards list their features from the plan catalog, including
    // what the token tier does not get (sales report, Jira).
    assert.match(pricing, /planFeatureList\(NONE_PLAN_ID\)/);
    assert.match(pricing, /planFeatureList\(PRO_PLAN_ID\)/);
    assert.doesNotMatch(pricing, /Full Pro deliverables for each spent token/);
    assert.match(account, /id="subscribe-actions"/);
    assert.match(account, /subscribeActions\.hidden = isPro/);
    assert.match(layout, /tr\('cta\.expert'\)/);
    assert.doesNotMatch(layout, />Us-diensten</);
  });
});
