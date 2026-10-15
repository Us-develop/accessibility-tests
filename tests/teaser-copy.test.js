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
const contact = readFileSync(join(repoRoot, 'web/src/pages/contact.astro'), 'utf8');

describe('teaser, loading, and catalog CTAs', () => {
  it('hides empty Audit ID / on guest token loads', () => {
    // Guests get the "keep this tab open" footer; only a signed-in run shows its audit id.
    assert.match(loading, /\{#if domain && runId && !guestToken\}/);
    assert.match(loading, /tr\('loading\.footer\.guest'\)/);
    assert.match(loadingPage, /tr\('loading\.missing\.link'\)/);
    assert.match(loadingPage, /lang=\{tr\.lang\}/);
  });

  it('uses the scan-page copy from the copy review in both languages', async () => {
    const en = (await import('../i18n/en.mjs')).default;
    const nl = (await import('../i18n/nl.mjs')).default;
    assert.equal(en['loading.h1.one'], 'Checking your page for accessibility issues');
    assert.equal(en['loading.snapshot'], 'This automated scan is a snapshot, not a full accessibility audit.');
    assert.equal(en['loading.current'], 'Currently scanning:');
    assert.match(nl['loading.h1.one'], /toegankelijkheidsproblemen/);
    assert.match(loading, /tr\('loading\.current'\)/);
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

  it('points locked tabs at account and tokens, and the expert link at the contact form with the snapshot', () => {
    assert.match(dashboard, /href=\{signupHref\}>Create an account/);
    assert.match(dashboard, /href="\/pricing">Buy tokens/);
    assert.match(dashboard, /href=\{expertHref\}>Talk to a WCAG expert/);
    assert.match(dashboard, /`\/contact\?source=teaser&guest=\$\{encodeURIComponent\(guestToken\)\}`/);
    assert.doesNotMatch(dashboard, /#lead-form/);
    // One block after the snapshot: "Go beyond the free scan". The second expert form is gone.
    assert.match(teaser, /Go beyond the free scan/);
    assert.match(teaser, /href="\/pricing">Get a full report/);
    assert.doesNotMatch(teaser, /GuestLeadForm/);
    assert.doesNotMatch(teaser, /btn-secondary" href="https:\/\/about-us\.be\/contact\/"/);
    // The contact page ties the request to the snapshot when the token is valid.
    assert.match(contact, /isValidGuestToken\(requestedGuest\)/);
    assert.match(contact, /token=\{guestToken\}/);
  });

  it('explains the test and both scores of 100 behind the info button', () => {
    assert.match(dashboard, /<strong style="display:block; margin-bottom: 6px;">About this test<\/strong>/);
    assert.match(dashboard, /do not\s+confirm compliance with the European Accessibility Act \(EAA\)/);
    assert.match(dashboard, /<strong>Errors score of 100<\/strong>/);
    assert.match(dashboard, /<strong>Overall score of 100<\/strong>/);
    assert.match(dashboard, /checks only a person can do/);
  });

  it('uses public catalog copy on home, pricing, account, and the footer', () => {
    assert.match(home, /crumb=\{ssrStaff \? tr\('header\.crumb\.newScan'\) : ssrCustomer \? tr\('home\.crumb\.customer'\) : tr\('home\.crumb\.guest'\)\}/);
    assert.match(home, /href="\/account#projects" class="link">\{tr\('home\.customer\.projects'\)\}/);
    assert.match(home, /\{ssrStaff \? \(/);
    assert.doesNotMatch(home, /complimentary token/);
    assert.match(home, /tx\('home\.seePricing'\)/);
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
