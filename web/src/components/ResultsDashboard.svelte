<script>
  import { navigate } from 'astro:transitions/client';
  import ScoreDonut from './ScoreDonut.svelte';
  import TrendChart from './TrendChart.svelte';
  import SeverityBadge from './SeverityBadge.svelte';
  import CodeBlock from './CodeBlock.svelte';
  import ManualChecklist from './ManualChecklist.svelte';
  import { CRITICAL_CAP, overallScore } from '../../../score-model.js';
  import { balanceLong, fetchBalance } from '../lib/balance.js';
  import { t, tn } from '../../../i18n/index.mjs';

  /**
   * @typedef {{ url: string, title: string, errors: number, warnings: number, passed: number }} PageRow
   * @typedef {{ id: string, rule: string, type: string, severity: string, occurrences: number, pages: string[] }} RuleRow
   * @typedef {{ key: string, label: string, errors: number, warnings: number, passed: number, color: string, textColor: string }} Principle
   * @typedef {{ key: string, label: string, issues: number, percent: number, icon: string }} Disability
   * @typedef {{ id: string, text: string, disabilities?: string[] }} ManualItem
   * @typedef {{ label: string, items: ManualItem[] }} ManualGroup
   * @typedef {{
   *   id: string,
   *   rule: string,
   *   url?: string,
   *   pages?: string[],
   *   status?: string,
   *   impact?: string,
   *   effort?: number | string,
   *   type?: string,
   *   wcag?: string[] | string,
   *   snippet?: string,
   *   message?: string,
   *   duplicateIds?: string[],
   *   duplicateIdLabel?: string,
   *   occurrenceDetails?: string[],
   *   fixCode?: string,
   *   fixCodeLanguage?: string,
   *   occurrencesTotal?: number,
   *   occurrencesOnPage?: number
   * }} FixItem
   */

  /**
   * @type {{
   *   primaryHost: string,
   *   auditedDate: string,
   *   scoreClamp: number,
   *   threshold?: number,
   *   pass: number,
   *   fail: number,
   *   warn: number,
   *   info: number,
   *   totalAxeViolations: number,
   *   totalAxePasses: number,
   *   severityCounts: { errors: number, warnings: number, passed: number, notice: number },
   *   trend: Array<{ date: string, score: number }>,
   *   pagesTable: PageRow[],
   *   rulesTable: RuleRow[],
   *   fixOrderItems: FixItem[],
   *   principles: Principle[],
   *   disabilities: Disability[],
   *   urls: string[],
   *   reportData: any,
   *   domain: string,
   *   runId: string,
   *   sprintPoints?: number,
   *   pagesScanned?: number,
   *   rulesChecked?: number,
   *   previousScore?: number | null,
   *   manualGroups: ManualGroup[],
   *   manualInitialChecked: string[],
   *   manualTotal: number,
   *   scoreModel?: { errors: number | null, hasCritical: boolean, reviewKeys: string[] },
   *   reviewedInitial?: string[],
   *   entitlements?: { salesReport?: boolean, jira?: boolean },
   *   coveredScCount?: number,
   *   wcagAaCount?: number,
   *   scoreAvailable?: boolean,
   *   pagesLoaded?: boolean,
   *   loadFailures?: Array<{ url?: string, message?: string }>,
   *   totalAxeIncomplete?: number,
   *   locked?: boolean,
   *   topIssues?: { title: string, wcag: string[], impact: string }[],
   *   guestToken?: string,
   *   lang?: string,
   *   findingsLang?: string,
   * }}
   */
  let {
    primaryHost,
    auditedDate,
    scoreClamp,
    threshold = 80,
    pass,
    fail,
    warn,
    info,
    totalAxeViolations,
    totalAxePasses,
    severityCounts,
    trend,
    pagesTable,
    rulesTable,
    fixOrderItems,
    principles,
    disabilities,
    urls,
    reportData,
    domain,
    runId,
    sprintPoints = 0,
    pagesScanned,
    rulesChecked,
    previousScore = null,
    manualGroups,
    manualInitialChecked = [],
    manualTotal,
    scoreModel = { errors: null, hasCritical: false, reviewKeys: [] },
    reviewedInitial = [],
    entitlements = { salesReport: true, jira: true },
    coveredScCount = 0,
    wcagAaCount = 56,
    scoreAvailable = true,
    pagesLoaded,
    loadFailures = [],
    totalAxeIncomplete = 0,
    locked = false,
    topIssues = [],
    guestToken = '',
    lang = 'en',
    findingsLang = 'en',
  } = $props();

  const tr = (key, vars) => t(lang, key, vars);
  const trn = (key, n, vars) => tn(lang, key, n, vars);
  /** A translated label for a known key, or the text as it came. */
  const known = (key, fallback) => {
    const text = tr(key);
    return text === key ? fallback : text;
  };
  /**
   * Rule names, messages and fixes come from the scan, in the language it ran in
   * (English for now). Marked as such when that is not the page language.
   */
  /** lang attribute for one finding text: its own language when that is not the page's. */
  const textAttr = (textLang) => {
    const of = textLang || findingsLang;
    return of && of !== lang ? of : undefined;
  };
  const IMPACT_KEYS = { 'None found': 'none', 'Some pages': 'some', 'Many pages': 'many', 'Most pages': 'most' };

  let tab = $state('overview');
  let variant = $state('default');
  let filter = $state({ error: true, warning: true, passed: false });
  /** @type {FixItem | null} */
  let selected = $state(null);
  let showFixCode = $state(false);
  let copyState = $state('idle');
  let manualChecked = $state(manualInitialChecked.length);
  /** @type {HTMLElement | null} */
  let lastIssueTrigger = null;
  /** @type {HTMLElement | null} */
  let drawerLayerEl = $state(null);
  /** @type {HTMLElement | null} */
  let drawerEl = $state(null);

  const passing = $derived(severityCounts.errors === 0);
  const automatedLabel = $derived(
    !scoreAvailable
      ? tr('dash.automated.none')
      : severityCounts.errors === 0
        ? tr('dash.automated.clean')
        : tr('dash.automated.findings')
  );
  const pagesScannedCount = $derived(pagesScanned ?? urls.length);
  const hasLoadedPages = $derived(
    typeof pagesLoaded === 'boolean' ? pagesLoaded : pagesScannedCount > 0
  );
  const loadFailureRows = $derived(Array.isArray(loadFailures) ? loadFailures : []);
  const tabs = $derived([
    { key: 'overview', label: tr('dash.tab.overview') },
    { key: 'issues', label: tr('dash.tab.issues'), count: severityCounts.errors + severityCounts.warnings },
    { key: 'principles', label: tr('dash.tab.principles') },
    { key: 'disability', label: tr('dash.tab.disability') },
    { key: 'pages', label: tr('dash.tab.pages'), count: pagesTable.length },
    { key: 'rules', label: tr('dash.tab.rules') },
    { key: 'manual', label: tr('dash.tab.manual'), count: `${manualChecked}/${manualTotal}` },
  ]);
  const variants = $derived([
    { key: 'detailed', label: tr('dash.density.detailed') },
    { key: 'default', label: tr('dash.density.default') },
    { key: 'compact', label: tr('dash.density.compact') },
  ]);
  const showDensitySwitcher = $derived(tab === 'overview' || tab === 'issues');
  const contentLocked = $derived(locked && tab !== 'overview');
  const signupHref = $derived(guestToken ? `/signup?guest=${encodeURIComponent(guestToken)}` : '/signup');
  /** The contact form, tied to this snapshot so the team sees which scan the request is about. */
  const expertHref = $derived(
    guestToken ? `/contact?source=teaser&guest=${encodeURIComponent(guestToken)}` : '/contact?source=report'
  );

  const totalChecks = $derived(severityCounts.errors + severityCounts.warnings + severityCounts.passed + severityCounts.notice);
  const pctPassed = $derived(totalChecks > 0 ? Math.round((severityCounts.passed / totalChecks) * 100) : 0);
  const scoreDelta = $derived(previousScore != null && scoreAvailable ? scoreClamp - previousScore : null);
  /** The customer's remaining tokens and Pro pages; null for staff and guests. */
  let balance = $state(null);
  $effect(() => {
    if (locked) return;
    fetchBalance().then((value) => {
      balance = value;
    });
  });

  /** Guests see a locked teaser and have nowhere to save marks. */
  const readOnlyReview = $derived(locked || !domain || !runId);
  /** Keys of "to review" findings a person has marked as reviewed. */
  let reviewedKeys = $state(reviewedInitial);
  let reviewSaveError = $state('');
  let reviewSaveGeneration = 0;

  /** Review keys of every page where this warning's rule was flagged. */
  function reviewKeysForRule(item) {
    const prefix = `${item.id}|`;
    return scoreModel.reviewKeys.filter((key) => key.startsWith(prefix));
  }

  /**
   * Mark warnings as reviewed (or not). The score updates at once; the save
   * follows, and a failed save puts the previous marks back.
   */
  async function setReviewed(keys, reviewed) {
    if (readOnlyReview || keys.length === 0) return;
    const previous = reviewedKeys;
    const next = new Set(previous);
    for (const key of keys) {
      if (reviewed) next.add(key);
      else next.delete(key);
    }
    reviewedKeys = [...next];
    reviewSaveError = '';
    const generation = ++reviewSaveGeneration;
    try {
      const res = await fetch(`/api/report/${encodeURIComponent(domain)}/${encodeURIComponent(runId)}/reviewed`, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: typeof globalThis.wcagHeaders === 'function'
          ? globalThis.wcagHeaders({ 'Content-Type': 'application/json' })
          : { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewed: reviewedKeys }),
      });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      const data = await res.json().catch(() => null);
      if (generation === reviewSaveGeneration && data && Array.isArray(data.reviewed)) reviewedKeys = data.reviewed;
    } catch (err) {
      if (generation === reviewSaveGeneration) {
        reviewedKeys = previous;
        reviewSaveError = tr('dash.review.saveError');
      }
    }
  }
  const reviewTotal = $derived(scoreModel.reviewKeys.length);
  const reviewDone = $derived(scoreModel.reviewKeys.filter((key) => reviewedKeys.includes(key)).length);
  /** The three-part score (score-model.js), recomputed as boxes are ticked. */
  const scoreResult = $derived(
    scoreAvailable
      ? overallScore({
          errors: scoreModel.errors ?? scoreClamp,
          hasCritical: scoreModel.hasCritical,
          reviewDone,
          reviewTotal,
          manualDone: manualChecked,
          manualTotal,
        })
      : null
  );
  const combinedScore = $derived(scoreResult ? scoreResult.overall : null);
  const scoreParts = $derived(
    scoreResult
      ? [
          { key: 'errors', label: tr('dash.part.errors'), value: scoreResult.errors, detail: tr('dash.part.errors.detail') },
          { key: 'review', label: tr('dash.part.review'), value: scoreResult.review, detail: tr('dash.part.review.detail', { done: reviewDone, total: reviewTotal }) },
          { key: 'manual', label: tr('dash.part.manual'), value: scoreResult.manual, detail: tr('dash.part.manual.detail', { done: manualChecked, total: manualTotal }) },
        ]
      : []
  );

  /** Pie segments for the issue distribution donut on the Overview tab. */
  const distSegs = $derived([
    { key: 'errors', value: severityCounts.errors, color: '#872012', label: tr('dash.dist.errors') },
    { key: 'warnings', value: severityCounts.warnings, color: '#FFB985', label: tr('dash.dist.warnings') },
    { key: 'passed', value: severityCounts.passed, color: '#8DFFB7', label: tr('dash.dist.passed') },
    { key: 'notice', value: severityCounts.notice, color: '#A7F0FB', label: tr('dash.dist.notice') },
  ]);
  const distTotal = $derived(distSegs.reduce((s, x) => s + x.value, 0) || 1);

  const filteredFixes = $derived(
    fixOrderItems.filter((f) => {
      const sev = severityFor(f);
      if (sev === 'error' && !filter.error) return false;
      if (sev === 'warning' && !filter.warning) return false;
      if (sev === 'passed' && !filter.passed) return false;
      return true;
    })
  );

  function severityFor(item) {
    if (item.status === 'fail' || item.type === 'violation' || item.status === 'violation') return 'error';
    if (item.status === 'warn') return 'warning';
    if (item.status === 'pass') return 'passed';
    return 'notice';
  }

  function impactToEffort(item) {
    if (item.effort != null && typeof item.effort === 'number') return item.effort;
    if (typeof item.impact === 'string') {
      const i = item.impact.toLowerCase();
      if (i === 'high' || i === 'critical') return 5;
      if (i === 'medium' || i === 'serious' || i === 'moderate') return 3;
      return 1;
    }
    return 2;
  }

  function urlsForFix(item) {
    if (Array.isArray(item.pages) && item.pages.length > 0) return item.pages;
    return Array.isArray(item.url) ? item.url : item.url ? [item.url] : [];
  }

  function severityForBadge(sev) {
    if (sev === 'error' || sev === 'warning' || sev === 'passed') return sev;
    return 'notice';
  }

  function selectIssue(item) {
    if (locked) return;
    lastIssueTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    selected = item;
    showFixCode = false;
    copyState = 'idle';
  }

  function closeIssue() {
    const trigger = lastIssueTrigger;
    selected = null;
    showFixCode = false;
    copyState = 'idle';
    queueMicrotask(() => trigger?.focus?.());
  }

  $effect(() => {
    if (typeof document === 'undefined') return;
    if (!selected || !drawerLayerEl) {
      return;
    }
    if (drawerLayerEl.parentElement !== document.body) {
      document.body.appendChild(drawerLayerEl);
    }
    const inerted = [];
    for (const el of document.body.children) {
      if (!(el instanceof HTMLElement) || el === drawerLayerEl) continue;
      if (el.hasAttribute('inert')) continue;
      el.setAttribute('inert', '');
      inerted.push(el);
    }
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeIssue();
      }
    };
    window.addEventListener('keydown', onKey);
    requestAnimationFrame(() => drawerEl?.focus());
    return () => {
      window.removeEventListener('keydown', onKey);
      for (const el of inerted) el.removeAttribute('inert');
    };
  });

  function onTabListKeydown(event) {
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const i = tabs.findIndex((t) => t.key === tab);
    if (i < 0) return;
    let next = i;
    if (event.key === 'ArrowRight') next = (i + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (i - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    const dest = tabs[next];
    if (!dest) return;
    tab = dest.key;
    requestAnimationFrame(() => document.getElementById(`results-tab-${dest.key}`)?.focus());
  }

  async function copyFix() {
    if (!selected?.fixCode) return;
    try {
      await navigator.clipboard.writeText(selected.fixCode);
      copyState = 'copied';
      setTimeout(() => (copyState = 'idle'), 1800);
    } catch {
      copyState = 'failed';
      setTimeout(() => (copyState = 'idle'), 1800);
    }
  }

  function handleManualProgress(info) {
    manualChecked = info.checked.length;
  }

  function gotoCoverage() {
    navigate(`/report/${encodeURIComponent(domain)}/${encodeURIComponent(runId)}/coverage`);
  }
  function gotoSales() {
    navigate(`/report/${encodeURIComponent(domain)}/${encodeURIComponent(runId)}/sales`);
  }
  function exportSalesPdf() {
    navigate(`/report/${encodeURIComponent(domain)}/${encodeURIComponent(runId)}/sales?print=1`);
  }
  function gotoStatement() {
    navigate(`/report/${encodeURIComponent(domain)}/${encodeURIComponent(runId)}/statement`);
  }
  function gotoDeveloper() {
    window.location.href = `/report/${encodeURIComponent(domain)}/${encodeURIComponent(runId)}/accessibility-developers.html`;
  }

  /** Format a WCAG criterion (string or array) for display. */
  function wcagDisplay(w) {
    if (!w) return '';
    if (Array.isArray(w)) return w.join(', ');
    return String(w);
  }
</script>

<div data-screen-label="03 Results - Dashboard" style="background: var(--us-cream);">
  <!-- HERO -->
  <div class="hero">
    <div aria-hidden="true" class="hero-blob-clip"><div class="hero-blob"></div></div>
    <div class="container hero-grid">
      <div class="hero-scores">
        <div class="hero-score-block">
          <div class="hero-score-donut-wrap">
            <ScoreDonut score={combinedScore} size={130} stroke={12} {threshold} label="" />
            <details class="score-info">
              <summary aria-label={tr('dash.info.label')}>i</summary>
              <div class="score-info-pop">
                <strong style="display:block; margin-bottom: 6px;">{tr('dash.info.aboutH')}</strong>
                <p style="margin: 0 0 12px; font-size: 12px;">{tr('dash.info.about')}</p>
                <strong style="display:block; margin-bottom: 6px;">{tr('dash.info.howH')}</strong>
                <p style="margin: 0 0 8px; font-size: 12px;">
                  <strong>{tr('dash.info.errorsH')}</strong>: {tr('dash.info.errors')}
                </p>
                <p style="margin: 0 0 8px; font-size: 12px;">
                  <strong>{tr('dash.info.reviewH')}</strong>: {tr('dash.info.review')}
                </p>
                <p style="margin: 0 0 8px; font-size: 12px;">
                  <strong>{tr('dash.info.manualH')}</strong>: {tr('dash.info.manual', { n: manualTotal })}
                </p>
                <p style="margin: 0 0 8px; font-size: 12px;">
                  <strong>{tr('dash.info.errors100H')}</strong>: {tr('dash.info.errors100')}
                </p>
                <p style="margin: 0 0 8px; font-size: 12px;">
                  <strong>{tr('dash.info.overall100H')}</strong>: {tr('dash.info.overall100')}
                </p>
                <p style="margin: 0; font-size: 12px;">{tr('dash.info.cap', { cap: CRITICAL_CAP })}</p>
              </div>
            </details>
          </div>
          <div class="hero-score-label">{tr('dash.overall')}</div>
          {#if scoreResult?.capped}
            <div class="hero-score-cap">{tr('dash.capped', { cap: CRITICAL_CAP })}</div>
          {/if}
        </div>
        {#if scoreParts.length > 0}
        <dl class="hero-score-parts" aria-label={tr('dash.partsLabel')}>
          {#each scoreParts as part (part.key)}
            <div class="hero-score-part">
              <dt>{part.label}</dt>
              <dd>
                <span class="hero-score-part-value">{part.value}</span>
                <span class="hero-score-part-bar" aria-hidden="true"><span style="width: {part.value}%;"></span></span>
                <span class="hero-score-part-detail">{part.detail}</span>
              </dd>
            </div>
          {/each}
        </dl>
        {/if}
      </div>
      <div>
        <span class="eyebrow" style="color: rgba(255,255,255,0.6);">
          <span class="dot" style="background: {passing ? '#8DFFB7' : '#FFB985'};"></span>
          {tr('dash.scanned', { label: automatedLabel, date: auditedDate })}
        </span>
        <h1 class="hero-title">{primaryHost || tr('dash.thisScan')} &middot; {combinedScore != null ? `${combinedScore}/100` : tr('dash.na')}</h1>
        <div class="hero-meta">
          <span><strong style="color: #FFB985;">{severityCounts.errors}</strong> {trn('dash.meta.errors', severityCounts.errors)}</span>
          <span><strong style="color: #F3AAFF;">{severityCounts.warnings}</strong> {trn('dash.meta.warnings', severityCounts.warnings)}</span>
          <span><strong style="color: #8DFFB7;">{severityCounts.passed}</strong> {tr('dash.meta.passed')}</span>
          {#if totalAxeIncomplete > 0}
            <span><strong style="color: #A7F0FB;">{totalAxeIncomplete}</strong> {tr('dash.meta.needsReview')}</span>
          {/if}
          <span>·</span>
          <span>
            {#if hasLoadedPages}
              {trn('dash.meta.pages', pagesScannedCount)}
            {:else}
              {tr('dash.meta.nothingLoaded')}
            {/if}
          </span>
        </div>
        <p class="hero-disclaimer">
          {tr('dash.disclaimer')}
          <a class="link" href="/limitations" style="color: inherit; text-decoration: underline;">{tr('dash.limitations')}</a>
          {#if !locked && hasLoadedPages}
            ·
            <button type="button" class="link" style="background:none;border:0;padding:0;font:inherit;cursor:pointer;color:inherit;text-decoration:underline;" onclick={gotoCoverage}>{tr('dash.coverageLink')}</button>
          {/if}
        </p>
      </div>
      {#if !locked && hasLoadedPages && entitlements.salesReport}
        <div style="display: flex; gap: 8px;">
          <button class="btn btn-ghost btn-sm hero-btn" onclick={exportSalesPdf}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            {tr('dash.exportSales')}
          </button>
          <button class="btn btn-cream btn-sm" onclick={gotoSales}>{tr('dash.openSales')}</button>
        </div>
      {/if}
    </div>
  </div>

  <div class="container results-body">
    {#if locked}
      <p class="locked-banner">
        {tr('dash.locked.lead')}
        <a class="link" href={signupHref}>{tr('dash.locked.signup')}</a>
        {tr('dash.locked.or')}
        <a class="link" href="/pricing">{tr('dash.locked.tokens')}</a>
        {tr('dash.locked.forFull')}
        {tr('dash.locked.questions')}
        <a class="link" href={expertHref}>{tr('cta.expert')}</a>
      </p>
    {/if}
    {#if !hasLoadedPages}
      <div class="load-fail-banner" role="status">
        <strong>{tr('dash.loadFail.h')}</strong>
        {tr('dash.loadFail.body')}
        {#if loadFailureRows.length > 0}
          <ul>
            {#each loadFailureRows as row (row.url + row.message)}
              <li><span class="mono">{row.url}</span>{row.message ? ` — ${row.message}` : ''}</li>
            {/each}
          </ul>
        {/if}
        {tr('dash.loadFail.retry')}
      </div>
    {/if}
    <!-- Tabs + density switcher (only on Overview/Issues) -->
    <div class="tabs-row">
      <!-- The tablist holds only real tabs. "WCAG coverage" is another page, so it
           is a link beside the tabs: as a tab, arrow keys navigated away. -->
      <div class="tabs tabs-scroll" style="margin-bottom: 0; border: 0;">
      <div role="tablist" aria-label={tr('dash.tabsLabel')} style="display: flex; gap: 4px;" onkeydown={onTabListKeydown}>
        {#each tabs as t (t.key)}
          <button
            type="button"
            class="tab"
            class:active={tab === t.key}
            role="tab"
            id={`results-tab-${t.key}`}
            aria-selected={tab === t.key}
            aria-controls="results-tabpanel"
            tabindex={tab === t.key ? 0 : -1}
            onclick={() => (tab = t.key)}
          >
            {t.label}
            {#if t.count != null}<span class="count">{t.count}</span>{/if}
            {#if locked && t.key !== 'overview'}
              <svg class="tab-lock" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <rect x="5" y="11" width="14" height="10" rx="2" />
                <path d="M8 11V8a4 4 0 0 1 8 0v3" />
              </svg>
            {/if}
          </button>
        {/each}
      </div>
      {#if !locked && hasLoadedPages}
        <a class="tab" href={`/report/${encodeURIComponent(domain)}/${encodeURIComponent(runId)}/coverage`}>{tr('dash.coverageTab')}</a>
      {/if}
      </div>
      {#if showDensitySwitcher}
        <div class="variant-switcher" role="group" aria-label={tr('dash.density.label')}>
          <span class="variant-label">{tr('dash.density.label')}</span>
          {#each variants as v (v.key)}
            <button
              type="button"
              onclick={() => (variant = v.key)}
              class="variant-btn"
              class:active={variant === v.key}
              aria-pressed={variant === v.key}
            >{v.label}</button>
          {/each}
        </div>
      {/if}
    </div>
    <div class="hr"></div>

    <!-- Tab content -->
    <div
      class="tab-panel"
      class:tab-panel--locked={contentLocked}
      role="tabpanel"
      id="results-tabpanel"
      aria-labelledby={`results-tab-${tab}`}
    >
    <div class="tab-panel-inner" aria-hidden={contentLocked ? true : undefined} inert={contentLocked ? true : undefined}>
    <div class="fade-up" key={tab + variant}>
      {#if tab === 'overview'}
        <!-- BIG STATS -->
        <div class="stat-strip" class:compact={variant === 'compact'} class:detailed={variant === 'detailed'}>
          <div class="stat" style="background: var(--us-lilac); color: var(--us-lilac-text);">
            <div class="stat-label">{tr('dash.stat.errorsScore')}</div>
            <div class="stat-value">{scoreAvailable ? scoreClamp : tr('dash.na')}{#if scoreAvailable}<span class="stat-suffix">/100</span>{/if}</div>
            {#if scoreDelta != null}
              <div class="stat-sub">{tr('dash.stat.sinceLast', { delta: scoreDelta >= 0 ? `+${scoreDelta}` : scoreDelta })}</div>
            {/if}
          </div>
          <div class="stat" style="background: var(--us-mint); color: var(--us-mint-text);">
            <div class="stat-label">{tr('dash.overall')}</div>
            <div class="stat-value">{combinedScore != null ? combinedScore : tr('dash.na')}{#if combinedScore != null}<span class="stat-suffix">/100</span>{/if}</div>
            <div class="stat-sub">{tr('dash.stat.progress', { manual: manualChecked, manualTotal, reviewed: reviewDone, reviewTotal })}</div>
          </div>
          <div class="stat" style="background: #FCE8E5; color: var(--us-peach-text);">
            <div class="stat-label">{tr('dash.stat.errors')}</div>
            <div class="stat-value">{severityCounts.errors}</div>
          </div>
          <div class="stat" style="background: var(--us-peach); color: var(--us-peach-text);">
            <div class="stat-label">{tr('dash.stat.warnings')}</div>
            <div class="stat-value">{severityCounts.warnings}</div>
          </div>
          <div class="stat" style="background: var(--us-sky); color: var(--us-sky-text);">
            <div class="stat-label">{tr('dash.stat.passed')}</div>
            <div class="stat-value">{severityCounts.passed.toLocaleString(lang === 'en' ? 'en-GB' : 'nl-BE')}</div>
          </div>
          {#if variant === 'compact' || variant === 'detailed'}
            <div class="stat" style="background: var(--us-sky); color: var(--us-sky-text);">
              <div class="stat-label">{tr('dash.stat.pages')}</div>
              <div class="stat-value">{pagesScannedCount}</div>
            </div>
            <div class="stat" style="background: var(--us-sky); color: var(--us-sky-text);">
              <div class="stat-label">{tr('dash.stat.effort')}</div>
              <div class="stat-value">{tr('dash.pts', { n: sprintPoints })}</div>
            </div>
          {/if}
        </div>

        <!-- TREND + PIE -->
        <div class="overview-grid" class:detailed={variant === 'detailed'}>
          <div class="card-flat">
            <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 16px;">
              <div>
                <h2 style="font-size: 18px; margin-bottom: 2px;">{tr('dash.trend.h')}</h2>
                {#if scoreDelta != null}
                  <div class="muted" style="font-size: 13px;">
                    {tr('dash.trend.delta', { arrow: scoreDelta >= 0 ? '↑' : '↓', n: Math.abs(scoreDelta) })}
                  </div>
                {/if}
              </div>
              {#if scoreDelta != null}
                <span class="tag {scoreDelta >= 0 ? 'tag-success' : 'tag-error'}">
                  {scoreDelta >= 0 ? tr('dash.trend.up') : tr('dash.trend.down')}
                </span>
              {/if}
            </div>
            <TrendChart data={trend} width={760} height={180} {lang} />
          </div>

          <div style="display: flex; flex-direction: column; gap: 24px;">
            <div class="card-flat">
              <h3 style="font-size: 16px; margin-bottom: 14px;">{tr('dash.dist.h')}</h3>
              <div style="display: flex; gap: 16px; align-items: center;">
                <svg width="140" height="140" viewBox="0 0 140 140" aria-hidden="true">
                  <circle cx="70" cy="70" r="60" fill="var(--us-n-30)" />
                  {#each distSegs as s, i (s.key)}
                    {@const cum = distSegs.slice(0, i).reduce((a, b) => a + b.value / distTotal, 0)}
                    {@const slice = s.value / distTotal}
                    {@const start = cum * Math.PI * 2 - Math.PI / 2}
                    {@const end = (cum + slice) * Math.PI * 2 - Math.PI / 2}
                    {@const large = slice > 0.5 ? 1 : 0}
                    {@const x1 = 70 + Math.cos(start) * 60}
                    {@const y1 = 70 + Math.sin(start) * 60}
                    {@const x2 = 70 + Math.cos(end) * 60}
                    {@const y2 = 70 + Math.sin(end) * 60}
                    <path d={`M 70 70 L ${x1} ${y1} A 60 60 0 ${large} 1 ${x2} ${y2} Z`} fill={s.color} />
                  {/each}
                  <circle cx="70" cy="70" r="32" fill="white" />
                  <text x="70" y="68" text-anchor="middle" font-size="20" font-family="var(--font-display)" font-weight="700">{distTotal}</text>
                  <text x="70" y="84" text-anchor="middle" font-size="9" fill="var(--fg-3)" letter-spacing="0.08em">{tr('dash.dist.checks')}</text>
                </svg>
                <div style="display: flex; flex-direction: column; gap: 6px; font-size: 13px;">
                  {#each distSegs as s (s.key)}
                    <div style="display: flex; align-items: center; gap: 8px;">
                      <span style="width:10px; height:10px; border-radius:2px; background:{s.color};"></span>
                      <span style="min-width:70px;">{s.label}</span>
                      <strong>{s.value}</strong>
                    </div>
                  {/each}
                </div>
              </div>
            </div>
          </div>
        </div>

        {#if locked && topIssues.length > 0}
          <div class="card-flat" style="margin-bottom: 24px;">
            <h3 style="font-size: 16px; margin-bottom: 4px;">{trn('dash.top.h', topIssues.length)}</h3>
            <p class="muted" style="font-size: 13px; margin-bottom: 14px;">{tr('dash.top.body')}</p>
            <ol class="top-issues">
              {#each topIssues as issue, i (i)}
                <li lang={textAttr(issue.lang)}>
                  <span class="top-issues-title">{issue.title}</span>
                  {#if issue.wcag.length > 0}
                    <span class="muted" style="font-size: 12px;">WCAG {issue.wcag.join(', ')}</span>
                  {/if}
                </li>
              {/each}
            </ol>
          </div>
        {/if}

        <!-- PRINCIPLES + AFFECTED PAGES -->
        <div class="principles-pages-grid">
          <div class="card-flat">
            <h3 style="font-size: 16px; margin-bottom: 14px;">{tr('dash.principles.h')}</h3>
            <div style="display: flex; flex-direction: column; gap: 12px;">
              {#each principles as p (p.key)}
                {@const total = p.errors + p.warnings + p.passed}
                {@const pct = total > 0 ? Math.round((p.passed / total) * 100) : 0}
                <div>
                  <div style="display: flex; justify-content: space-between; margin-bottom: 4px; font-size: 13px;">
                    <span style="font-weight: 500;">{known(`dash.principle.${p.key}`, p.label)}</span>
                    <span class="muted">{tr('dash.principles.row', { pct, errors: p.errors })}</span>
                  </div>
                  <div class="grade-bar"><div class="fill" style="width: {pct}%; background: {p.color};"></div></div>
                </div>
              {/each}
            </div>
            <p class="muted" style="font-size: 11px; margin-top: 12px;">{tr('dash.principles.note')}</p>
          </div>
          <div class="card-flat">
            <h3 style="font-size: 16px; margin-bottom: 14px;">{tr('dash.pages.h')}</h3>
            <div>
              {#each pagesTable.slice().sort((a, b) => b.errors - a.errors).slice(0, 5) as p, i (p.url)}
                <div style="display: grid; grid-template-columns: auto 1fr auto; gap: 12px; padding: 10px 0; align-items: center; border-bottom: {i < 4 ? '1px solid var(--border-subtle)' : 0};">
                  <span class="mono muted" style="font-size: 11px;">{String(i + 1).padStart(2, '0')}</span>
                  <div>
                    <div style="font-weight: 500; font-size: 14px;">{p.title === 'Home' ? tr('dash.pages.home') : p.title}</div>
                    <div class="mono muted break-anywhere" style="font-size: 11px;">{p.url}</div>
                  </div>
                  <div style="display: flex; gap: 6px;">
                    <span class="tag tag-error">{p.errors}</span>
                    <span class="tag tag-warning">{p.warnings}</span>
                  </div>
                </div>
              {/each}
            </div>
          </div>
        </div>
      {:else if tab === 'issues'}
        <!-- FILTERS -->
        <div style="display: flex; gap: 8px; margin-bottom: 16px; align-items: center; flex-wrap: wrap;">
          <span class="muted" style="font-size: 13px;">{tr('dash.filter.show')}</span>
          <button type="button" class="filter-chip" class:active={filter.error} aria-pressed={filter.error} onclick={() => (filter = { ...filter, error: !filter.error })}>
            <span class="dot dot-error"></span>{trn('dash.count.errors', severityCounts.errors)}
          </button>
          <button type="button" class="filter-chip warning" class:active={filter.warning} aria-pressed={filter.warning} onclick={() => (filter = { ...filter, warning: !filter.warning })}>
            <span class="dot dot-warning"></span>{trn('dash.count.warnings', severityCounts.warnings)}
          </button>
          <button type="button" class="filter-chip success" class:active={filter.passed} aria-pressed={filter.passed} onclick={() => (filter = { ...filter, passed: !filter.passed })}>
            <span class="dot dot-success"></span>{trn('dash.count.passed', severityCounts.passed)}
          </button>
          <span style="flex: 1;"></span>
          <span class="muted" style="font-size: 13px;">{tr('dash.filter.shown', { n: filteredFixes.length })}</span>
        </div>

        <div class="card-flat" style="padding: 0;">
          {#each filteredFixes as item, i (`${item.id}-${i}`)}
            {@const sev = severityFor(item)}
            <button class="list-row issue-row" class:compact={variant === 'compact'} onclick={() => selectIssue(item)}>
              <SeverityBadge severity={severityForBadge(sev)} {lang} />
              <div style="text-align: left;">
                <div style="font-weight: 500; font-size: 15px; margin-bottom: 2px;" lang={textAttr(item.textLang)}>{item.rule}</div>
                <div class="muted break-anywhere" style="font-size: 12px;">
                  {#if item.duplicateIdLabel}
                    {tr('dash.issue.duplicated')} <span class="mono">{item.duplicateIdLabel}</span>
                    {#if item.wcag} · WCAG {wcagDisplay(item.wcag)}{/if}
                    {#if item.url} · {item.url}{/if}
                  {:else}
                    {#if item.message && item.message !== item.rule}<span lang={textAttr(item.textLang)}>{item.message}</span> · {/if}
                    {#if item.wcag}WCAG {wcagDisplay(item.wcag)} · {/if}<span class="mono">{item.id}</span>
                    {#if item.url} · {item.url}{/if}
                  {/if}
                </div>
                {#if item.occurrenceDetails && item.occurrenceDetails.length > 0}
                  <div class="mono muted break-anywhere" style="font-size: 11px; margin-top: 4px;">
                    <span lang={textAttr(item.textLang)}>{item.occurrenceDetails.slice(0, 2).join(' · ')}</span>
                    {#if item.occurrenceDetails.length > 2}
                      · {tr('dash.issue.more', { n: item.occurrenceDetails.length - 2 })}
                    {/if}
                  </div>
                {/if}
              </div>
              {#if variant !== 'compact'}
                <span class="tag tag-outline" style="font-size: 11px;">{trn('dash.issue.pages', urlsForFix(item).length || 1)}</span>
              {/if}
              {#if item.reviewKey && reviewedKeys.includes(item.reviewKey)}
                <span class="tag tag-success" style="font-size: 11px;">{tr('dash.issue.reviewed')}</span>
              {/if}
              {#if item.scoreGain > 0}
                <span class="tag tag-success" style="font-size: 11px;" title={tr('dash.issue.gainTitle')}>{tr('dash.issue.gain', { n: item.scoreGain })}</span>
              {/if}
              <span class="tag tag-lilac" style="font-size: 11px;">{tr('dash.pts', { n: impactToEffort(item) })}</span>
              <span style="color: var(--fg-3);">›</span>
            </button>
          {/each}
        </div>
      {:else if tab === 'principles'}
        <div class="dash-principles-grid">
          {#each principles as p (p.key)}
            {@const total = p.errors + p.warnings + p.passed}
            {@const pct = total > 0 ? Math.round((p.passed / total) * 100) : 0}
            {@const label = known(`dash.principle.${p.key}`, p.label)}
            <div class="card-flat" style="padding: 28px;">
              <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px;">
                <div>
                  <div class="principle-icon" style="background: {p.color}; color: {p.textColor};" aria-hidden="true">{label[0]}</div>
                  <h3 style="font-size: 24px; margin-bottom: 4px;">{label}</h3>
                  <div class="muted" style="font-size: 13px;">{tr('dash.principle.checks', { n: total })}</div>
                </div>
                <div style="text-align: right;">
                  <div style="font-family: var(--font-display); font-size: 44px; font-weight: 700; line-height: 1;">{pct}<span style="font-size: 20px;">%</span></div>
                  <div class="muted" style="font-size: 11px; text-transform: uppercase; letter-spacing: .08em;">{tr('dash.principle.passRate')}</div>
                </div>
              </div>
              <div class="grade-bar"><div class="fill" style="width: {pct}%; background: {p.color};"></div></div>
              <div style="display: flex; justify-content: space-between; margin-top: 12px; font-size: 13px;">
                <span><span class="dot dot-error"></span> {trn('dash.count.errors', p.errors)}</span>
                <span><span class="dot dot-warning"></span> {trn('dash.count.warnings', p.warnings)}</span>
                <span><span class="dot dot-success"></span> {trn('dash.count.passed', p.passed)}</span>
              </div>
            </div>
          {/each}
        </div>
        <p class="muted" style="font-size: 11px; margin-top: 12px; text-align: center;">
          {tr('dash.principles.tabNote')}
        </p>
      {:else if tab === 'disability'}
        <p class="muted" style="font-size: 14px; margin-bottom: 20px; max-width: 720px;">
          {tr('dash.disab.intro')}
        </p>
        <div class="card-flat" style="padding: 0;">
          {#each disabilities as d, i (d.key)}
            <div class="disability-row" style="border-bottom: {i < disabilities.length - 1 ? '1px solid var(--border-subtle)' : 0};">
              <div class="disability-icon">{d.icon === 'eye' ? '👁' : d.icon === 'low-vision' ? '🔍' : d.icon === 'audio' ? '🔊' : d.icon === 'hand' ? '🖐' : d.icon === 'brain' ? '🧠' : '⚠'}</div>
              <div>
                <div style="font-weight: 500; font-size: 16px;">{known(`dash.disab.${d.key}`, d.label)}</div>
                <div class="muted" style="font-size: 13px; margin-top: 2px;">{trn('dash.disab.issues', d.issues)}</div>
                <div class="grade-bar" style="margin-top: 8px; max-width: 460px;">
                  <div class="fill" style="width: {d.percent}%; background: {d.percent > 70 ? 'var(--us-peach-text)' : d.percent > 40 ? 'var(--us-peach)' : 'var(--us-mint)'};"></div>
                </div>
              </div>
              <div style="font-family: var(--font-display); font-size: 28px; font-weight: 700; font-variant-numeric: tabular-nums;">{d.percent}<span style="font-size: 14px;">%</span></div>
              <span class="tag tag-outline">{IMPACT_KEYS[d.impact] ? tr(`dash.impact.${IMPACT_KEYS[d.impact]}`) : d.impact}</span>
            </div>
          {/each}
        </div>
        <p class="muted" style="font-size: 11px; margin-top: 12px;">
          {tr('dash.disab.note')}
        </p>
      {:else if tab === 'pages'}
        <div class="card-flat" style="padding: 0;">
          <div class="list-row pages-row" style="background: var(--us-n-20); font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: var(--fg-3); font-weight: 600;">
            <span>#</span><span>{tr('dash.col.page')}</span><span>{tr('dash.col.errors')}</span><span>{tr('dash.col.warnings')}</span><span>{tr('dash.col.passed')}</span><span>{tr('dash.col.score')}</span>
          </div>
          {#each pagesTable as p, i (p.url)}
            {@const total = p.errors + p.warnings + p.passed}
            {@const pct = total > 0 ? Math.round((p.passed / total) * 100) : 0}
            <div class="list-row pages-row" style="align-items: center;">
              <span class="mono muted" style="font-size: 11px;">{String(i + 1).padStart(2, '0')}</span>
              <div>
                <div style="font-weight: 500; font-size: 14px;">{p.title === 'Home' ? tr('dash.pages.home') : p.title}</div>
                <div class="mono muted break-anywhere" style="font-size: 11px;">{p.url}</div>
              </div>
              <span class="tag tag-error">{p.errors}</span>
              <span class="tag tag-warning">{p.warnings}</span>
              <span class="muted mono" style="font-size: 12px;">{p.passed}</span>
              <span style="font-family: var(--font-display); font-weight: 700; font-size: 18px; font-variant-numeric: tabular-nums; min-width: 48px; text-align: right;">{pct}<span style="font-size: 12px; opacity: 0.5;">%</span></span>
            </div>
          {/each}
        </div>
      {:else if tab === 'rules'}
        <div class="card-flat" style="padding: 24px;">
          <h3 style="font-size: 18px; margin-bottom: 6px;">{trn('dash.rules.h', rulesTable.length)}</h3>
          <p class="muted" style="font-size: 13px; margin-bottom: 20px;">
            {tr('dash.rules.body', { covered: coveredScCount, total: wcagAaCount })}
          </p>
          {#if rulesTable.length === 0}
            <p class="muted" style="font-size: 14px;">{tr('dash.rules.none')}</p>
          {:else}
            <div class="dash-rules-grid">
              {#each rulesTable as r (`${r.type}:${r.id}`)}
                <div style="padding: 10px 14px; border: 1px solid var(--border-subtle); border-radius: 8px; display: flex; justify-content: space-between; align-items: center;">
                  <div>
                    <div class="mono" style="font-size: 12px; font-weight: 500;" lang={textAttr(r.textLang)}>{r.rule}</div>
                    <div class="muted" style="font-size: 11px;">
                      {#if r.duplicateIdLabel}
                        {tr('dash.issue.duplicated')} <span class="mono">{r.duplicateIdLabel}</span> ·
                      {/if}
                      {trn('dash.rules.occ', r.occurrences)} · {trn('dash.issue.pages', r.pages.length)}
                    </div>
                  </div>
                  <SeverityBadge severity={severityForBadge(r.severity)} {lang} />
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {:else if tab === 'manual'}
        <p class="muted" style="font-size: 14px; margin-bottom: 16px; max-width: 720px;">
          {tr('dash.manual.intro')}
          {tr('dash.manual.seeBefore')} <button type="button" class="link" style="background:none;border:0;padding:0;font:inherit;cursor:pointer;" onclick={gotoCoverage}>{tr('dash.coverageTab')}</button> {tr('dash.manual.seeAfter')}
        </p>
        <ManualChecklist
          {domain}
          {runId}
          groups={manualGroups}
          initialChecked={manualInitialChecked}
          onProgress={handleManualProgress}
          readOnly={locked}
          {lang}
        />
      {/if}
    </div>
    </div>
    {#if contentLocked}
      <div class="tab-panel-veil" role="region" aria-label={tr('dash.veil.label')}>
        <div class="tab-panel-veil-card">
          <p style="font-size: 18px; font-weight: 600; margin-bottom: 8px;">{tr('dash.veil.h')}</p>
          <p class="muted" style="font-size: 14px; margin-bottom: 18px;">{tr('dash.veil.body')}</p>
          <div class="guest-cta-row">
            <a class="btn btn-primary" href={signupHref}>{tr('dash.veil.signup')}</a>
            <a class="btn btn-ghost" href="/pricing">{tr('cta.buyTokens')}</a>
            <a class="btn btn-secondary" href={expertHref}>{tr('cta.expert')}</a>
          </div>
        </div>
      </div>
    {/if}
    </div>

    {#if !locked && hasLoadedPages}
    <!-- Footer CTAs -->
    <div class="footer-cta">
      <div>
        <div style="font-family: var(--font-display); font-size: 22px; font-weight: 700;">{tr(entitlements.salesReport ? 'dash.deliverables.three' : 'dash.deliverables.two')}</div>
        <div style="opacity: 0.65; font-size: 14px; margin-top: 4px;">{tr('dash.deliverables.sub')}</div>
      </div>
      {#if entitlements.salesReport}
        <button class="btn btn-cream" onclick={gotoSales}>{tr('dash.deliverables.sales')}</button>
      {/if}
      <button class="btn btn-cream" onclick={gotoStatement}>{tr('dash.deliverables.statement')}</button>
      <button class="btn btn-grad" onclick={gotoDeveloper}>{tr('dash.deliverables.developer')}</button>
    </div>
    {#if !entitlements.salesReport}
      <p class="muted" style="font-size: 14px; margin-top: 12px;">
        {tr('dash.deliverables.proNote')}
        <a class="link" href="/pricing#pro">{tr('dash.deliverables.proLink')}</a>
      </p>
    {/if}
    <!-- What next: scan again with what is left, or let Us do the work. -->
    <div class="card-flat next-steps">
      <div>
        <h2 style="font-size: 20px; margin-bottom: 4px;">{tr('dash.next.h')}</h2>
        <p class="muted" style="font-size: 14px; margin: 0;" role="status">
          {#if balance}
            {tr('dash.next.balance', { balance: balanceLong(balance, lang) })}
          {:else}
            {tr('dash.next.default')}
          {/if}
        </p>
      </div>
      <div class="guest-cta-row">
        <a class="btn btn-primary" href="/">{tr('dash.next.scan')}</a>
        <a class="btn btn-secondary" href="/contact?source=report">{tr('cta.expert')}</a>
      </div>
    </div>
    {/if}
  </div>

  {#if selected && !locked}
    {@const fixUrls = urlsForFix(selected)}
    {@const occTotal = selected.occurrencesTotal ?? fixUrls.length}
    {@const occPage = selected.occurrencesOnPage ?? 0}
    <div class="drawer-layer" bind:this={drawerLayerEl}>
      <button type="button" class="drawer-backdrop" aria-label={tr('dash.drawer.close')} onclick={closeIssue}></button>
      <div
        class="drawer"
        bind:this={drawerEl}
        role="dialog"
        aria-modal="true"
        aria-labelledby="issue-drawer-title"
        tabindex="-1"
      >
        <div class="drawer-head">
          <SeverityBadge severity={severityForBadge(severityFor(selected))} {lang} />
          <button type="button" class="btn btn-ghost btn-sm" onclick={closeIssue}>{tr('dash.drawer.closeBtn')}</button>
        </div>
        <div class="drawer-body">
          <div class="muted" style="font-size: 12px; margin-bottom: 8px;">
            {#if selected.wcag}WCAG {wcagDisplay(selected.wcag)} · {/if}<span class="mono">{selected.id}</span>
          </div>
          <h2 id="issue-drawer-title" style="font-size: 28px; margin-bottom: 14px;" lang={textAttr(selected.textLang)}>{selected.rule}</h2>
          {#if selected.duplicateIdLabel}
            <p style="font-size: 15px; margin: 0 0 16px;">
              {tr('dash.drawer.duplicatedIds')} <span class="mono" style="font-weight: 600;">{selected.duplicateIdLabel}</span>
            </p>
          {:else if selected.message && selected.message !== selected.rule}
            <p class="muted" style="font-size: 14px; margin: 0 0 16px;" lang={textAttr(selected.textLang)}>{selected.message}</p>
          {/if}

          <div class="dash-drawer-stats">
            <div class="mini-stat">
              <div class="mini-stat-label">{tr('dash.drawer.severity')}</div>
              <div class="mini-stat-value">{tr(`severity.${severityForBadge(severityFor(selected))}`)}</div>
            </div>
            <div class="mini-stat">
              <div class="mini-stat-label">{tr('dash.drawer.effort')}</div>
              <div class="mini-stat-value">{tr('dash.pts', { n: impactToEffort(selected) })}</div>
            </div>
            <div class="mini-stat">
              <div class="mini-stat-label">{tr('dash.drawer.occurrences')}</div>
              <div class="mini-stat-value">{occTotal}</div>
            </div>
            <div class="mini-stat">
              <div class="mini-stat-label">{tr('dash.drawer.onPage')}</div>
              <div class="mini-stat-value">{occPage || '—'}</div>
            </div>
          </div>

          {#if selected.reviewKey && !readOnlyReview}
            {@const isReviewed = reviewedKeys.includes(selected.reviewKey)}
            {@const ruleKeys = reviewKeysForRule(selected)}
            {@const ruleOpen = ruleKeys.filter((key) => !reviewedKeys.includes(key))}
            <div class="review-box">
              <p class="review-box-text">{tr('dash.drawer.review')}</p>
              <div class="fix-actions" style="margin-bottom: 0;">
                <button
                  type="button"
                  class="btn btn-ink btn-sm"
                  aria-pressed={isReviewed}
                  onclick={() => setReviewed([selected.reviewKey], !isReviewed)}
                >
                  {isReviewed ? tr('dash.drawer.undoReviewed') : tr('dash.drawer.markReviewed')}
                </button>
                {#if ruleKeys.length > 1 && ruleOpen.length > 0}
                  <button type="button" class="btn btn-secondary btn-sm" onclick={() => setReviewed(ruleKeys, true)}>
                    {tr('dash.drawer.markAll', { n: ruleKeys.length })}
                  </button>
                {/if}
              </div>
              {#if reviewSaveError}
                <p class="review-box-error" role="alert">{reviewSaveError}</p>
              {/if}
            </div>
          {/if}

          {#if selected.fixCode}
            <div class="fix-actions">
              <button class="btn btn-ink btn-sm" onclick={() => (showFixCode = !showFixCode)}>
                {showFixCode ? tr('dash.drawer.hideCode') : tr('dash.drawer.showCode')}
              </button>
              <button class="btn btn-secondary btn-sm" onclick={copyFix} disabled={copyState === 'copied'}>
                {#if copyState === 'copied'}{tr('dash.drawer.copied')}{:else if copyState === 'failed'}{tr('dash.drawer.copyFailed')}{:else}{tr('dash.drawer.copy')}{/if}
              </button>
            </div>
            {#if showFixCode}
              <div style="margin-bottom: 24px;">
                <CodeBlock code={selected.fixCode} language={selected.fixCodeLanguage || 'text'} />
              </div>
            {/if}
          {/if}

          {#if selected.occurrenceDetails && selected.occurrenceDetails.length > 0}
            <h2 class="drawer-h2">{tr('dash.drawer.where', { n: selected.occurrenceDetails.length })}</h2>
            <div class="affected-pages" style="margin-bottom: 24px;" lang={textAttr(selected.textLang)}>
              {#each selected.occurrenceDetails as desc, i (`${desc}-${i}`)}
                <span class="mono affected-page" class:affected-page--markup={desc.includes('<')}>{desc}</span>
              {/each}
            </div>
          {/if}

          {#if fixUrls.length > 0}
            <h2 class="drawer-h2">{tr('dash.drawer.pages', { n: fixUrls.length })}</h2>
            <div class="affected-pages">
              {#each fixUrls.slice(0, 12) as u (u)}
                <a class="mono affected-page" href={u} target="_blank" rel="noopener">{u}</a>
              {/each}
              {#if fixUrls.length > 12}
                <div class="muted" style="font-size: 12px;">{tr('dash.drawer.andMore', { n: fixUrls.length - 12 })}</div>
              {/if}
            </div>
          {/if}
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .hero {
    background: var(--us-ink);
    color: var(--us-cream);
    padding: 32px 0;
    position: relative;
  }
  /* Only the decoration is clipped, so the score info can open past the hero. */
  .hero-blob-clip {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
  }
  .hero-blob {
    position: absolute;
    top: -120px;
    right: -80px;
    width: 380px;
    height: 380px;
    border-radius: 50%;
    background: var(--us-grad-iridescent);
    opacity: 0.3;
    filter: blur(50px);
  }
  .hero-grid {
    position: relative;
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 32px;
    align-items: center;
  }
  @media (max-width: 900px) {
    .hero-grid {
      grid-template-columns: 1fr;
    }
    .hero-grid > div:last-child {
      grid-column: 1 / -1;
    }
  }
  .hero-scores {
    display: flex;
    gap: 28px;
    align-items: center;
  }
  .hero-score-block {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
  }
  .hero-score-label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    opacity: 0.65;
  }
  .hero-score-donut-wrap {
    position: relative;
  }
  .top-issues {
    margin: 0;
    padding-left: 20px;
    display: grid;
    gap: 10px;
  }
  .top-issues li {
    padding-left: 4px;
  }
  .top-issues-title {
    display: block;
    font-weight: 600;
  }
  .next-steps {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
    flex-wrap: wrap;
    margin-top: 24px;
  }
  .review-box {
    border: 1px solid var(--border-decor);
    border-radius: 12px;
    padding: 14px 16px;
    margin-bottom: 24px;
    background: var(--us-cream);
  }
  .review-box-text {
    margin: 0 0 12px;
    font-size: 13px;
  }
  .review-box-error {
    margin: 10px 0 0;
    font-size: 13px;
    color: var(--us-peach-text);
  }
  .hero-score-cap {
    font-size: 11px;
    max-width: 150px;
    text-align: center;
    color: #FFB985;
  }
  .hero-score-parts {
    display: grid;
    gap: 10px;
    margin: 0;
    min-width: 190px;
  }
  .hero-score-part dt {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    opacity: 0.75;
  }
  .hero-score-part dd {
    margin: 2px 0 0;
    display: grid;
    grid-template-columns: 34px 1fr;
    align-items: center;
    column-gap: 8px;
  }
  .hero-score-part-value {
    font-family: var(--font-display);
    font-size: 20px;
    font-weight: 700;
    line-height: 1;
  }
  .hero-score-part-bar {
    display: block;
    height: 6px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.22);
    overflow: hidden;
  }
  .hero-score-part-bar > span {
    display: block;
    height: 100%;
    border-radius: 999px;
    background: #8DFFB7;
  }
  .hero-score-part-detail {
    grid-column: 2;
    font-size: 11px;
    opacity: 0.75;
  }
  .score-info {
    position: absolute;
    top: -4px;
    right: -4px;
  }
  .score-info > summary {
    list-style: none;
    cursor: pointer;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.12);
    color: var(--us-cream);
    font-family: var(--font-display);
    font-style: italic;
    font-weight: 700;
    font-size: 13px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid rgba(255, 255, 255, 0.2);
  }
  .score-info > summary::-webkit-details-marker { display: none; }
  .score-info > summary:hover { background: rgba(255, 255, 255, 0.2); }
  .score-info[open] > summary { background: var(--us-cream); color: var(--us-ink); }
  .score-info-pop {
    position: absolute;
    top: 30px;
    /* Opens to the right from the donut's left edge (donut 130px wide, button on its right
       edge), so it stays on screen at the left of the page, phones included. */
    left: -102px;
    width: min(360px, calc(100vw - 32px));
    background: var(--us-cream);
    color: var(--fg-1);
    border-radius: 12px;
    padding: 14px 16px;
    box-shadow: var(--shadow-pop);
    z-index: 10;
    font-size: 13px;
    line-height: 1.5;
  }
  .hero-title {
    color: var(--us-cream);
    font-size: clamp(26px, 6vw, 38px);
    margin-top: 10px;
    margin-bottom: 6px;
  }
  .hero-disclaimer {
    margin: 12px 0 0;
    font-size: 13px;
    opacity: 0.75;
    max-width: 52ch;
  }
  .hero-meta {
    opacity: 0.7;
    font-size: 14px;
    display: flex;
    gap: 18px;
    flex-wrap: wrap;
  }
  .hero-btn {
    color: var(--us-cream);
    border: 1px solid rgba(255, 255, 255, 0.2);
  }
  .results-body {
    padding-block: 32px 80px;
  }
  .tabs-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 16px;
    margin-bottom: 8px;
  }
  .tabs-scroll {
    flex: 1 1 100%;
    min-width: 60%;
    overflow-x: auto;
    scroll-snap-type: x proximity;
    -webkit-overflow-scrolling: touch;
    mask-image: linear-gradient(to right, #000 0, #000 calc(100% - 28px), transparent);
    -webkit-mask-image: linear-gradient(to right, #000 0, #000 calc(100% - 28px), transparent);
  }
  .tabs-scroll .tab {
    scroll-snap-align: start;
  }
  .variant-switcher {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 4px 4px 12px;
    background: var(--us-white);
    border-radius: 999px;
    border: 1px solid var(--border-subtle);
  }
  .variant-label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--fg-3);
    margin-right: 4px;
  }
  .variant-btn {
    padding: 6px 14px;
    min-height: 28px;
    min-width: 24px;
    font-size: 12px;
    background: transparent;
    color: var(--fg-2);
    border: 0;
    border-radius: 999px;
    cursor: pointer;
    font-family: var(--font-body);
  }
  .variant-btn.active {
    background: var(--us-ink);
    color: var(--us-cream);
  }
  .stat-strip {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 12px;
    margin-bottom: 24px;
  }
  .stat-strip.compact,
  .stat-strip.detailed {
    grid-template-columns: repeat(6, 1fr);
  }
  .stat {
    padding: 18px 20px;
    border-radius: var(--r-md);
  }
  .stat-label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--stat-label);
    margin-bottom: 6px;
  }
  .stat-value {
    font-family: var(--font-display);
    font-weight: 700;
    font-size: 32px;
    line-height: 1;
    letter-spacing: -0.02em;
  }
  .stat-suffix {
    font-size: 18px;
    margin-left: 2px;
    opacity: 0.6;
  }
  .stat-sub {
    font-size: 12px;
    opacity: 0.7;
    margin-top: 6px;
  }
  .overview-grid {
    display: grid;
    grid-template-columns: 2fr 1fr;
    gap: 24px;
  }
  .overview-grid.detailed {
    grid-template-columns: 1fr;
  }
  .principles-pages-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 24px;
    margin-top: 24px;
  }
  .dash-principles-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 20px;
  }
  .dash-rules-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 8px;
  }
  .dash-drawer-stats {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 10px;
    margin-bottom: 20px;
  }
  @media (max-width: 1024px) {
    .stat-strip,
    .stat-strip.compact,
    .stat-strip.detailed,
    .overview-grid,
    .principles-pages-grid {
      grid-template-columns: 1fr 1fr;
    }
  }
  @media (max-width: 600px) {
    .stat-strip,
    .stat-strip.compact,
    .stat-strip.detailed,
    .overview-grid,
    .overview-grid.detailed,
    .principles-pages-grid {
      grid-template-columns: 1fr;
    }
    .dash-principles-grid,
    .dash-rules-grid {
      grid-template-columns: 1fr;
    }
    .dash-drawer-stats {
      grid-template-columns: repeat(2, 1fr);
    }
  }
  .filter-chip {
    padding: 6px 14px;
    min-height: 28px;
    min-width: 24px;
    border-radius: 999px;
    background: transparent;
    color: var(--fg-3);
    border: 1px solid var(--border-default);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    font-family: var(--font-body);
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .filter-chip.active {
    background: #fce8e5;
    color: var(--us-peach-text);
    border-color: transparent;
  }
  .filter-chip.warning.active {
    background: var(--us-peach);
  }
  .filter-chip.success.active {
    background: var(--us-mint);
    color: var(--us-mint-text);
  }
  .issue-row {
    grid-template-columns: auto 1fr auto auto auto;
    cursor: pointer;
    text-align: left;
    background: transparent;
    border: 0;
    border-bottom: 1px solid var(--border-subtle);
    padding: 16px 20px;
    width: 100%;
    font-family: var(--font-body);
  }
  .issue-row:hover {
    background: var(--us-n-20);
  }
  .issue-row.compact {
    grid-template-columns: auto 1fr auto auto;
  }
  .footer-cta {
    margin-top: 64px;
    padding: 32px 36px;
    background: var(--us-ink);
    color: var(--us-cream);
    border-radius: var(--r-lg);
    display: grid;
    grid-template-columns: 1fr auto auto auto;
    gap: 12px;
    align-items: center;
  }
  @media (max-width: 720px) {
    .footer-cta {
      grid-template-columns: 1fr;
    }
    .footer-cta .btn {
      width: 100%;
    }
    .issue-row,
    .issue-row.compact {
      grid-template-columns: 1fr;
      gap: 10px;
      align-items: start;
    }
    .disability-row {
      grid-template-columns: 1fr;
      gap: 12px;
      padding: 16px 18px;
    }
    .disability-icon {
      width: 48px;
      height: 48px;
      font-size: 20px;
    }
    .pages-row {
      grid-template-columns: 1fr;
      gap: 8px;
      align-items: start;
    }
    :global(.card-flat) > .pages-row:first-of-type {
      display: none;
    }
  }
  .principle-icon {
    width: 56px;
    height: 56px;
    border-radius: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: var(--font-display);
    font-weight: 700;
    font-size: 26px;
    margin-bottom: 14px;
  }
  .disability-row {
    display: grid;
    grid-template-columns: 60px 1fr auto auto;
    gap: 20px;
    align-items: center;
    padding: 20px 24px;
  }
  .disability-icon {
    width: 56px;
    height: 56px;
    border-radius: 50%;
    background: var(--us-grad-iridescent);
    opacity: 0.85;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 24px;
  }
  .pages-row {
    grid-template-columns: auto 1fr auto auto auto auto;
  }
  .drawer-layer {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: flex;
    justify-content: flex-end;
  }
  .drawer-backdrop {
    position: absolute;
    inset: 0;
    border: 0;
    padding: 0;
    margin: 0;
    width: 100%;
    height: 100%;
    background: rgba(25, 25, 27, 0.4);
    backdrop-filter: blur(8px);
    cursor: pointer;
  }
  @media (max-width: 540px) {
    .drawer-layer {
      justify-content: stretch;
    }
  }
  .drawer {
    position: relative;
    z-index: 1;
    width: min(640px, 100%);
    max-width: 100%;
    height: 100dvh;
    height: 100vh;
    background: var(--us-cream);
    overflow-y: auto;
    box-shadow: var(--shadow-pop);
  }
  .drawer:focus {
    outline: none;
  }
  .drawer:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }
  .drawer-head {
    padding: 20px calc(16px + env(safe-area-inset-right, 0px)) 20px calc(16px + env(safe-area-inset-left, 0px));
    border-bottom: 1px solid var(--border-subtle);
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .drawer-body {
    padding: 20px calc(16px + env(safe-area-inset-right, 0px)) 24px calc(16px + env(safe-area-inset-left, 0px));
  }
  @media (min-width: 541px) {
    .drawer-head {
      padding: 24px calc(32px + env(safe-area-inset-right, 0px)) 24px calc(32px + env(safe-area-inset-left, 0px));
    }
    .drawer-body {
      padding: 24px calc(32px + env(safe-area-inset-right, 0px)) 32px calc(32px + env(safe-area-inset-left, 0px));
    }
  }
  .drawer-h2 {
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--fg-3);
    margin-bottom: 8px;
  }
  .mini-stat {
    padding: 12px 14px;
    background: var(--us-white);
    border-radius: 10px;
    border: 1px solid var(--border-subtle);
  }
  .mini-stat-label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--fg-3);
    margin-bottom: 4px;
  }
  .mini-stat-value {
    font-family: var(--font-display);
    font-size: 22px;
    font-weight: 700;
  }
  .fix-actions {
    display: flex;
    gap: 8px;
    margin-bottom: 14px;
  }
  .btn-ink {
    background: var(--us-ink);
    color: var(--us-cream);
    border: 1px solid var(--us-ink);
  }
  .btn-ink:hover { background: #000; }
  .affected-pages {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 24px;
  }
  .affected-page {
    font-size: 12px;
    padding: 8px 12px;
    background: var(--us-white);
    border: 1px solid var(--border-subtle);
    border-radius: 6px;
    color: var(--fg-1);
    text-decoration: none;
    overflow-wrap: anywhere;
  }
  .affected-page--markup {
    white-space: pre-wrap;
    word-break: break-word;
  }
  .affected-page:hover {
    background: var(--us-n-20);
  }
  .hr {
    height: 1px;
    background: var(--border-subtle);
    margin: 8px 0 20px;
  }
  .locked-banner {
    font-size: 14px;
    line-height: 1.5;
    padding: 14px 18px;
    margin-bottom: 20px;
    background: var(--us-sky);
    color: var(--us-sky-text);
    border-radius: var(--r-md);
  }
  .load-fail-banner {
    font-size: 14px;
    line-height: 1.5;
    padding: 14px 18px;
    margin-bottom: 20px;
    background: #fce8e5;
    color: var(--us-peach-text);
    border-radius: var(--r-md);
  }
  .load-fail-banner ul {
    margin: 8px 0;
    padding-left: 18px;
  }
  .tab-lock {
    margin-left: 2px;
    opacity: 0.55;
    flex-shrink: 0;
  }
  .tab-panel {
    position: relative;
  }
  .tab-panel--locked {
    min-height: 420px;
    overflow: hidden;
    border-radius: var(--r-md);
  }
  .tab-panel--locked .tab-panel-inner {
    filter: blur(11px);
    user-select: none;
    pointer-events: none;
  }
  .tab-panel-veil {
    position: absolute;
    inset: 0;
    z-index: 2;
    display: grid;
    place-items: center;
    padding: 32px 16px;
    background: linear-gradient(180deg, rgba(245, 244, 229, 0.12) 0%, rgba(245, 244, 229, 0.58) 100%);
  }
  .tab-panel-veil-card {
    max-width: 440px;
    text-align: center;
    background: var(--us-cream);
    padding: 28px 32px;
    border-radius: var(--r-md);
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.12);
  }
  @media print {
    .locked-banner,
    .load-fail-banner,
    .tab-panel-veil,
    .tab-panel--locked {
      display: none !important;
    }
  }
</style>
