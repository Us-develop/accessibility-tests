<script>
  import ScoreDonut from './ScoreDonut.svelte';
  import TrendChart from './TrendChart.svelte';
  import SeverityBadge from './SeverityBadge.svelte';
  import CodeBlock from './CodeBlock.svelte';
  import ManualChecklist from './ManualChecklist.svelte';

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
   *   manualPercent: number,
   *   coveredScCount?: number,
   *   scoreAvailable?: boolean,
   *   totalAxeIncomplete?: number,
   *   locked?: boolean,
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
    manualPercent: manualPercentInitial = 0,
    coveredScCount = 0,
    scoreAvailable = true,
    totalAxeIncomplete = 0,
    locked = false,
  } = $props();

  let tab = $state('overview');
  let variant = $state('default');
  let filter = $state({ error: true, warning: true, passed: false });
  /** @type {FixItem | null} */
  let selected = $state(null);
  let showFixCode = $state(false);
  let copyState = $state('idle');
  let manualPercent = $state(manualPercentInitial);
  let manualChecked = $state(manualInitialChecked.length);

  const passing = $derived(severityCounts.errors === 0);
  const automatedLabel = $derived(
    !scoreAvailable
      ? 'No scored checks'
      : severityCounts.errors === 0
        ? 'No automated errors'
        : 'Automated findings'
  );
  const tabs = $derived([
    { key: 'overview', label: 'Overview' },
    { key: 'issues', label: 'Issues', count: severityCounts.errors + severityCounts.warnings },
    { key: 'principles', label: 'WCAG principles' },
    { key: 'disability', label: 'By disability' },
    { key: 'pages', label: 'By page', count: pagesTable.length },
    { key: 'rules', label: 'Rules' },
    { key: 'manual', label: 'Manual checks', count: `${manualChecked}/${manualTotal}` },
  ]);
  const variants = [
    { key: 'detailed', label: 'Detailed' },
    { key: 'default', label: 'Default' },
    { key: 'compact', label: 'Compact' },
  ];
  const showDensitySwitcher = $derived(tab === 'overview' || tab === 'issues');
  const contentLocked = $derived(locked && tab !== 'overview');

  const totalChecks = $derived(severityCounts.errors + severityCounts.warnings + severityCounts.passed + severityCounts.notice);
  const pctPassed = $derived(totalChecks > 0 ? Math.round((severityCounts.passed / totalChecks) * 100) : 0);
  const scoreDelta = $derived(previousScore != null ? scoreClamp - previousScore : null);

  /** Pie segments for the issue distribution donut on the Overview tab. */
  const distSegs = $derived([
    { key: 'errors', value: severityCounts.errors, color: '#872012', label: 'Errors' },
    { key: 'warnings', value: severityCounts.warnings, color: '#FFB985', label: 'Warnings' },
    { key: 'passed', value: severityCounts.passed, color: '#8DFFB7', label: 'Passed' },
    { key: 'notice', value: severityCounts.notice, color: '#A7F0FB', label: 'Notice' },
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
    selected = item;
    showFixCode = false;
    copyState = 'idle';
  }

  function closeIssue() {
    selected = null;
    showFixCode = false;
    copyState = 'idle';
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
    manualPercent = info.percent;
    manualChecked = info.checked.length;
  }

  function gotoSales() {
    window.location.href = `/report/${encodeURIComponent(domain)}/${encodeURIComponent(runId)}/sales`;
  }
  function gotoStatement() {
    window.location.href = `/report/${encodeURIComponent(domain)}/${encodeURIComponent(runId)}/statement`;
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
    <div aria-hidden="true" class="hero-blob"></div>
    <div class="container hero-grid">
      <div class="hero-scores">
        <div class="hero-score-block">
          <div class="hero-score-donut-wrap">
            <ScoreDonut score={scoreClamp} size={130} stroke={12} {threshold} label="" />
            <details class="score-info" aria-label="How is the score calculated?">
              <summary aria-label="Score formula">i</summary>
              <div class="score-info-pop">
                <strong style="display:block; margin-bottom: 6px;">Automated score formula</strong>
                <div style="font-family: var(--font-mono); font-size: 12px; line-height: 1.5;">
                  score = applicable passed checks<br />
                  &nbsp; ÷ (passed + failed + warnings + axe violations)<br />
                  &nbsp; × 100
                </div>
                <p style="margin: 8px 0 0; font-size: 12px;">
                  This is <strong>not</strong> a WCAG or EAA conformance score. Vacuous passes (for example “no meta refresh”) are excluded. Axe “needs review” items are listed separately. The <strong>Manual checks</strong> donut is checklist progress, not a human audit unless those items were actually completed.
                </p>
              </div>
            </details>
          </div>
          <div class="hero-score-label">Automated score</div>
        </div>
        <div class="hero-score-block">
          <ScoreDonut score={manualPercent} size={130} stroke={12} threshold={100} label="" />
          <div class="hero-score-label">Checklist progress · {manualChecked}/{manualTotal}</div>
        </div>
      </div>
      <div>
        <span class="eyebrow" style="color: rgba(255,255,255,0.6);">
          <span class="dot" style="background: {passing ? '#8DFFB7' : '#FFB985'};"></span>
          {automatedLabel} &middot; scanned {auditedDate}
        </span>
        <h1 class="hero-title">{primaryHost} &middot; {scoreAvailable ? `${scoreClamp}/100` : 'n/a'}</h1>
        <div class="hero-meta">
          <span><strong style="color: #FFB985;">{severityCounts.errors}</strong> errors</span>
          <span><strong style="color: #F3AAFF;">{severityCounts.warnings}</strong> warnings</span>
          <span><strong style="color: #8DFFB7;">{severityCounts.passed}</strong> passed</span>
          {#if totalAxeIncomplete > 0}
            <span><strong style="color: #A7F0FB;">{totalAxeIncomplete}</strong> needs review</span>
          {/if}
          <span>·</span>
          <span>{pagesScanned ?? urls.length} pages · automated WCAG 2.2 AA checks</span>
        </div>
        <p class="hero-disclaimer">
          Automated scan only — not a WCAG 2.2 AA or EAA conformance claim.
          <a class="link" href="/limitations" style="color: inherit; text-decoration: underline;">What we can and cannot test</a>
        </p>
      </div>
      {#if !locked}
        <div style="display: flex; gap: 8px;">
          <button class="btn btn-ghost btn-sm hero-btn" onclick={() => window.print()}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Export PDF
          </button>
          <button class="btn btn-cream btn-sm" onclick={gotoSales}>Open sales report →</button>
        </div>
      {/if}
    </div>
  </div>

  <div class="container" style="padding: 32px 32px 80px;">
    {#if locked}
      <p class="locked-banner">
        Free 1-page snapshot — Overview is open. Other tabs are a blurred preview.
        <a class="link" href="#lead-form">Request WCAG services</a> to get the full readable report.
      </p>
    {/if}
    <!-- Tabs + density switcher (only on Overview/Issues) -->
    <div class="tabs-row">
      <div class="tabs" style="margin-bottom: 0; border: 0;">
        {#each tabs as t (t.key)}
          <button class="tab" class:active={tab === t.key} onclick={() => (tab = t.key)}>
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
      {#if showDensitySwitcher}
        <div class="variant-switcher" aria-label="Density">
          <span class="variant-label">Density</span>
          {#each variants as v (v.key)}
            <button
              onclick={() => (variant = v.key)}
              class="variant-btn"
              class:active={variant === v.key}
            >{v.label}</button>
          {/each}
        </div>
      {/if}
    </div>
    <div class="hr"></div>

    <!-- Tab content -->
    <div class="tab-panel" class:tab-panel--locked={contentLocked}>
    <div class="tab-panel-inner" aria-hidden={contentLocked ? true : undefined} inert={contentLocked ? true : undefined}>
    <div class="fade-up" key={tab + variant}>
      {#if tab === 'overview'}
        <!-- BIG STATS -->
        <div class="stat-strip" class:compact={variant === 'compact'} class:detailed={variant === 'detailed'}>
          <div class="stat" style="background: var(--us-lilac); color: var(--us-lilac-text);">
            <div class="stat-label">Automated score</div>
            <div class="stat-value">{scoreClamp}<span class="stat-suffix">/100</span></div>
            {#if scoreDelta != null}
              <div class="stat-sub">{scoreDelta >= 0 ? `+${scoreDelta}` : scoreDelta} since last audit</div>
            {/if}
          </div>
          <div class="stat" style="background: #FCE8E5; color: var(--us-peach-text);">
            <div class="stat-label">Errors</div>
            <div class="stat-value">{severityCounts.errors}</div>
          </div>
          <div class="stat" style="background: var(--us-peach); color: var(--us-peach-text);">
            <div class="stat-label">Warnings</div>
            <div class="stat-value">{severityCounts.warnings}</div>
          </div>
          <div class="stat" style="background: var(--us-mint); color: var(--us-mint-text);">
            <div class="stat-label">Passed checks</div>
            <div class="stat-value">{severityCounts.passed.toLocaleString()}</div>
          </div>
          {#if variant === 'compact' || variant === 'detailed'}
            <div class="stat" style="background: var(--us-sky); color: var(--us-sky-text);">
              <div class="stat-label">Pages scanned</div>
              <div class="stat-value">{pagesScanned ?? urls.length}</div>
            </div>
            <div class="stat" style="background: var(--us-sky); color: var(--us-sky-text);">
              <div class="stat-label">Est. dev effort</div>
              <div class="stat-value">{sprintPoints} pts</div>
            </div>
          {/if}
        </div>

        <!-- TREND + PIE -->
        <div class="overview-grid" class:detailed={variant === 'detailed'}>
          <div class="card-flat">
            <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 16px;">
              <div>
                <h3 style="font-size: 18px; margin-bottom: 2px;">Score trend</h3>
                {#if scoreDelta != null}
                  <div class="muted" style="font-size: 13px;">
                    {scoreDelta >= 0 ? '↑' : '↓'} {Math.abs(scoreDelta)} pts since last audit
                  </div>
                {/if}
              </div>
              {#if scoreDelta != null}
                <span class="tag {scoreDelta >= 0 ? 'tag-success' : 'tag-error'}">
                  {scoreDelta >= 0 ? '↑ Improving' : '↓ Regression'}
                </span>
              {/if}
            </div>
            <TrendChart data={trend} width={760} height={180} />
          </div>

          <div style="display: flex; flex-direction: column; gap: 24px;">
            <div class="card-flat">
              <h3 style="font-size: 16px; margin-bottom: 14px;">Issue distribution</h3>
              <div style="display: flex; gap: 16px; align-items: center;">
                <svg width="140" height="140" viewBox="0 0 140 140">
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
                  <text x="70" y="84" text-anchor="middle" font-size="9" fill="var(--fg-3)" letter-spacing="0.08em">CHECKS</text>
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

        <!-- PRINCIPLES + AFFECTED PAGES -->
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-top: 24px;">
          <div class="card-flat">
            <h3 style="font-size: 16px; margin-bottom: 14px;">WCAG principles (POUR)</h3>
            <div style="display: flex; flex-direction: column; gap: 12px;">
              {#each principles as p (p.key)}
                {@const total = p.errors + p.warnings + p.passed}
                {@const pct = total > 0 ? Math.round((p.passed / total) * 100) : 0}
                <div>
                  <div style="display: flex; justify-content: space-between; margin-bottom: 4px; font-size: 13px;">
                    <span style="font-weight: 500;">{p.label}</span>
                    <span class="muted">{pct}% · {p.errors} errors</span>
                  </div>
                  <div class="grade-bar"><div class="fill" style="width: {pct}%; background: {p.color};"></div></div>
                </div>
              {/each}
            </div>
            <p class="muted" style="font-size: 11px; margin-top: 12px;">
              Counts are mapped from WCAG success criteria (and chapter when no SC is known).
            </p>
          </div>
          <div class="card-flat">
            <h3 style="font-size: 16px; margin-bottom: 14px;">Most-affected pages</h3>
            <div>
              {#each pagesTable.slice().sort((a, b) => b.errors - a.errors).slice(0, 5) as p, i (p.url)}
                <div style="display: grid; grid-template-columns: auto 1fr auto; gap: 12px; padding: 10px 0; align-items: center; border-bottom: {i < 4 ? '1px solid var(--border-subtle)' : 0};">
                  <span class="mono muted" style="font-size: 11px;">{String(i + 1).padStart(2, '0')}</span>
                  <div>
                    <div style="font-weight: 500; font-size: 14px;">{p.title}</div>
                    <div class="mono muted" style="font-size: 11px;">{p.url}</div>
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
          <span class="muted" style="font-size: 13px;">Show:</span>
          <button class="filter-chip" class:active={filter.error} onclick={() => (filter = { ...filter, error: !filter.error })}>
            <span class="dot dot-error"></span>{severityCounts.errors} errors
          </button>
          <button class="filter-chip warning" class:active={filter.warning} onclick={() => (filter = { ...filter, warning: !filter.warning })}>
            <span class="dot dot-warning"></span>{severityCounts.warnings} warnings
          </button>
          <button class="filter-chip success" class:active={filter.passed} onclick={() => (filter = { ...filter, passed: !filter.passed })}>
            <span class="dot dot-success"></span>{severityCounts.passed} passed
          </button>
          <span style="flex: 1;"></span>
          <span class="muted" style="font-size: 13px;">{filteredFixes.length} shown</span>
        </div>

        <div class="card-flat" style="padding: 0;">
          {#each filteredFixes as item, i (`${item.id}-${i}`)}
            {@const sev = severityFor(item)}
            <button class="list-row issue-row" class:compact={variant === 'compact'} onclick={() => selectIssue(item)}>
              <SeverityBadge severity={severityForBadge(sev)} />
              <div style="text-align: left;">
                <div style="font-weight: 500; font-size: 15px; margin-bottom: 2px;">{item.rule}</div>
                <div class="muted" style="font-size: 12px;">
                  {#if item.wcag}WCAG {wcagDisplay(item.wcag)} · {/if}<span class="mono">{item.id}</span>
                  {#if item.url} · {item.url}{/if}
                </div>
              </div>
              {#if variant !== 'compact'}
                <span class="tag tag-outline" style="font-size: 11px;">{urlsForFix(item).length || 1} page{urlsForFix(item).length === 1 ? '' : 's'}</span>
              {/if}
              <span class="tag tag-lilac" style="font-size: 11px;">{impactToEffort(item)} pts</span>
              <span style="color: var(--fg-3);">›</span>
            </button>
          {/each}
        </div>
      {:else if tab === 'principles'}
        <div class="dash-principles-grid">
          {#each principles as p (p.key)}
            {@const total = p.errors + p.warnings + p.passed}
            {@const pct = total > 0 ? Math.round((p.passed / total) * 100) : 0}
            <div class="card-flat" style="padding: 28px;">
              <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px;">
                <div>
                  <div class="principle-icon" style="background: {p.color}; color: {p.textColor};">{p.label[0]}</div>
                  <h3 style="font-size: 24px; margin-bottom: 4px;">{p.label}</h3>
                  <div class="muted" style="font-size: 13px;">{total} checks across all pages</div>
                </div>
                <div style="text-align: right;">
                  <div style="font-family: var(--font-display); font-size: 44px; font-weight: 700; line-height: 1;">{pct}<span style="font-size: 20px;">%</span></div>
                  <div class="muted" style="font-size: 11px; text-transform: uppercase; letter-spacing: .08em;">pass rate</div>
                </div>
              </div>
              <div class="grade-bar"><div class="fill" style="width: {pct}%; background: {p.color};"></div></div>
              <div style="display: flex; justify-content: space-between; margin-top: 12px; font-size: 13px;">
                <span><span class="dot dot-error"></span> {p.errors} errors</span>
                <span><span class="dot dot-warning"></span> {p.warnings} warnings</span>
                <span><span class="dot dot-success"></span> {p.passed} passed</span>
              </div>
            </div>
          {/each}
        </div>
        <p class="muted" style="font-size: 11px; margin-top: 12px; text-align: center;">
          Mapped from WCAG success criteria on this run — not a fixed split.
        </p>
      {:else if tab === 'disability'}
        <p class="muted" style="font-size: 14px; margin-bottom: 20px; max-width: 720px;">
          Percentage is the share of <strong>scanned pages</strong> with at least one automated fail or warning mapped to that group. This is not a measure of how blocked a real user would be.
        </p>
        <div class="card-flat" style="padding: 0;">
          {#each disabilities as d, i (d.key)}
            <div class="disability-row" style="border-bottom: {i < disabilities.length - 1 ? '1px solid var(--border-subtle)' : 0};">
              <div class="disability-icon">{d.icon === 'eye' ? '👁' : d.icon === 'low-vision' ? '🔍' : d.icon === 'audio' ? '🔊' : d.icon === 'hand' ? '🖐' : d.icon === 'brain' ? '🧠' : '⚠'}</div>
              <div>
                <div style="font-weight: 500; font-size: 16px;">{d.label}</div>
                <div class="muted" style="font-size: 13px; margin-top: 2px;">{d.issues} relevant issues</div>
                <div class="grade-bar" style="margin-top: 8px; max-width: 460px;">
                  <div class="fill" style="width: {d.percent}%; background: {d.percent > 70 ? 'var(--us-peach-text)' : d.percent > 40 ? 'var(--us-peach)' : 'var(--us-mint)'};"></div>
                </div>
              </div>
              <div style="font-family: var(--font-display); font-size: 28px; font-weight: 700; font-variant-numeric: tabular-nums;">{d.percent}<span style="font-size: 14px;">%</span></div>
              <span class="tag tag-outline">{d.impact}</span>
            </div>
          {/each}
        </div>
        <p class="muted" style="font-size: 11px; margin-top: 12px;">
          Only fail and warning findings are counted. Unchecked manual checklist items are not included.
        </p>
      {:else if tab === 'pages'}
        <div class="card-flat" style="padding: 0;">
          <div class="list-row pages-row" style="background: var(--us-n-20); font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: var(--fg-3); font-weight: 600;">
            <span>#</span><span>Page</span><span>Errors</span><span>Warns</span><span>Passed</span><span>Score</span>
          </div>
          {#each pagesTable as p, i (p.url)}
            {@const total = p.errors + p.warnings + p.passed}
            {@const pct = total > 0 ? Math.round((p.passed / total) * 100) : 0}
            <div class="list-row pages-row" style="align-items: center;">
              <span class="mono muted" style="font-size: 11px;">{String(i + 1).padStart(2, '0')}</span>
              <div>
                <div style="font-weight: 500; font-size: 14px;">{p.title}</div>
                <div class="mono muted" style="font-size: 11px;">{p.url}</div>
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
          <h3 style="font-size: 18px; margin-bottom: 6px;">{rulesTable.length} finding{rulesTable.length === 1 ? '' : 's'} on this run</h3>
          <p class="muted" style="font-size: 13px; margin-bottom: 20px;">
            This list is unique automated findings (errors, warnings, and axe “needs review”). The library maps to {coveredScCount} WCAG success criteria; WCAG 2.2 Level A and AA include 50 criteria and automation cannot test all of them.
          </p>
          {#if rulesTable.length === 0}
            <p class="muted" style="font-size: 14px;">Nothing fired this round — well done.</p>
          {:else}
            <div class="dash-rules-grid">
              {#each rulesTable as r (`${r.type}:${r.id}`)
                <div style="padding: 10px 14px; border: 1px solid var(--border-subtle); border-radius: 8px; display: flex; justify-content: space-between; align-items: center;">
                  <div>
                    <div class="mono" style="font-size: 12px; font-weight: 500;">{r.rule}</div>
                    <div class="muted" style="font-size: 11px;">{r.occurrences} occurrence{r.occurrences === 1 ? '' : 's'} · {r.pages.length} page{r.pages.length === 1 ? '' : 's'}</div>
                  </div>
                  <SeverityBadge severity={severityForBadge(r.severity)} />
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {:else if tab === 'manual'}
        <p class="muted" style="font-size: 14px; margin-bottom: 16px; max-width: 720px;">
          Checklist progress only — these items are <strong>not performed</strong> until someone ticks them. They do not change the automated score.
        </p>
        <ManualChecklist
          {domain}
          {runId}
          groups={manualGroups}
          initialChecked={manualInitialChecked}
          onProgress={handleManualProgress}
          readOnly={locked}
        />
      {/if}
    </div>
    </div>
    {#if contentLocked}
      <div class="tab-panel-veil" role="region" aria-label="Unlock the full report">
        <div class="tab-panel-veil-card">
          <p style="font-size: 18px; font-weight: 600; margin-bottom: 8px;">This tab is a preview</p>
          <p class="muted" style="font-size: 14px; margin-bottom: 18px;">
            Unlock the full issue list, fix guidance, and per-page breakdown.
          </p>
          <a class="btn btn-grad" href="#lead-form">Request WCAG services</a>
        </div>
      </div>
    {/if}
    </div>

    {#if !locked}
    <!-- Footer CTAs -->
    <div class="footer-cta">
      <div>
        <div style="font-family: var(--font-display); font-size: 22px; font-weight: 700;">Three deliverables, ready.</div>
        <div style="opacity: 0.65; font-size: 14px; margin-top: 4px;">One link to share with each audience.</div>
      </div>
      <button class="btn btn-cream" onclick={gotoSales}>Sales report</button>
      <button class="btn btn-cream" onclick={gotoStatement}>A11y statement</button>
      <button class="btn btn-grad" onclick={gotoDeveloper}>Developer next-steps</button>
    </div>
    {/if}
  </div>

  {#if selected && !locked}
    {@const fixUrls = urlsForFix(selected)}
    {@const occTotal = selected.occurrencesTotal ?? fixUrls.length}
    {@const occPage = selected.occurrencesOnPage ?? 0}
    <div class="drawer-backdrop" onclick={closeIssue} role="presentation">
      <div class="drawer" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div class="drawer-head">
          <SeverityBadge severity={severityForBadge(severityFor(selected))} />
          <button class="btn btn-ghost btn-sm" onclick={closeIssue}>Close ✕</button>
        </div>
        <div class="drawer-body">
          <div class="muted" style="font-size: 12px; margin-bottom: 8px;">
            {#if selected.wcag}WCAG {wcagDisplay(selected.wcag)} · {/if}<span class="mono">{selected.id}</span>
          </div>
          <h2 style="font-size: 28px; margin-bottom: 14px;">{selected.rule}</h2>

          <div class="dash-drawer-stats">
            <div class="mini-stat">
              <div class="mini-stat-label">Severity</div>
              <div class="mini-stat-value">{severityFor(selected)}</div>
            </div>
            <div class="mini-stat">
              <div class="mini-stat-label">Effort</div>
              <div class="mini-stat-value">{impactToEffort(selected)} pts</div>
            </div>
            <div class="mini-stat">
              <div class="mini-stat-label">Occurrences</div>
              <div class="mini-stat-value">{occTotal}</div>
            </div>
            <div class="mini-stat">
              <div class="mini-stat-label">On this page</div>
              <div class="mini-stat-value">{occPage || '—'}</div>
            </div>
          </div>

          {#if selected.fixCode}
            <div class="fix-actions">
              <button class="btn btn-ink btn-sm" onclick={() => (showFixCode = !showFixCode)}>
                {showFixCode ? 'Hide fix code' : 'Show fix code'}
              </button>
              <button class="btn btn-secondary btn-sm" onclick={copyFix} disabled={copyState === 'copied'}>
                {#if copyState === 'copied'}Copied ✓{:else if copyState === 'failed'}Could not copy{:else}Copy fix{/if}
              </button>
            </div>
            {#if showFixCode}
              <div style="margin-bottom: 24px;">
                <CodeBlock code={selected.fixCode} language={selected.fixCodeLanguage || 'text'} />
              </div>
            {/if}
          {/if}

          {#if fixUrls.length > 0}
            <h4 class="drawer-h4">Pages affected ({fixUrls.length})</h4>
            <div class="affected-pages">
              {#each fixUrls.slice(0, 12) as u (u)}
                <a class="mono affected-page" href={u} target="_blank" rel="noopener">{u}</a>
              {/each}
              {#if fixUrls.length > 12}
                <div class="muted" style="font-size: 12px;">…and {fixUrls.length - 12} more</div>
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
    overflow: hidden;
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
  .score-info {
    position: absolute;
    top: -4px;
    right: -4px;
  }
  .score-info > summary {
    list-style: none;
    cursor: pointer;
    width: 22px;
    height: 22px;
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
    right: 0;
    width: min(320px, calc(100vw - 24px));
    max-width: calc(100vw - 24px);
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
  .tabs-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 16px;
    margin-bottom: 8px;
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
    opacity: 0.7;
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
    .overview-grid {
      grid-template-columns: 1fr 1fr;
    }
  }
  @media (max-width: 600px) {
    .stat-strip,
    .stat-strip.compact,
    .stat-strip.detailed {
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
  .drawer-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(25, 25, 27, 0.4);
    backdrop-filter: blur(8px);
    z-index: 100;
    display: flex;
    justify-content: flex-end;
  }
  @media (max-width: 540px) {
    .drawer-backdrop {
      justify-content: stretch;
    }
  }
  .drawer {
    width: min(640px, 100%);
    max-width: 100%;
    height: 100dvh;
    height: 100vh;
    background: var(--us-cream);
    overflow-y: auto;
    box-shadow: var(--shadow-pop);
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
  .drawer-h4 {
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
    .tab-panel-veil,
    .tab-panel--locked {
      display: none !important;
    }
  }
</style>
