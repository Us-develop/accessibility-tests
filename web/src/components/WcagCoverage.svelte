<script>
  import { onMount } from 'svelte';
  import { t, tn } from '../../../i18n/index.mjs';

  /**
   * @typedef {{
   *   id: string,
   *   title: string,
   *   level: string,
   *   principle: string,
   *   auto: string,
   *   autoNote: string,
   *   url?: string,
   *   thisRun: string,
   *   findings: Array<{ status: string, label: string }>,
   *   manualCanCover: boolean,
   *   manualChecked: boolean,
   *   manualPartial: boolean,
   *   manualItems: Array<{ id: string, text: string, checked: boolean }>,
   *   needsProfessional: boolean,
   * }} Criterion
   */

  /** @type {{ domain: string, runId: string, primaryHost: string, lang?: string }} */
  let { domain, runId, primaryHost, lang = 'en' } = $props();

  const tr = (key, vars) => t(lang, key, vars);
  const known = (key, fallback) => {
    const text = tr(key);
    return text === key ? fallback : text;
  };
  /**
   * Criterion titles, notes and the written analysis are in the language the
   * scan ran in (older scans: English); finding labels carry their own.
   * Marked when they differ from the page.
   */
  const contentLang = $derived(data && (data.lang || 'en') !== lang ? data.lang || 'en' : undefined);
  const findingAttr = (f) => {
    const of = f?.lang || data?.lang || 'en';
    return of === lang ? undefined : of;
  };

  let loading = $state(true);
  let generating = $state(false);
  let error = $state('');
  /** @type {any} */
  let data = $state(null);
  let filter = $state('all');

  const apiPath = $derived(
    `/api/report/${encodeURIComponent(domain)}/${encodeURIComponent(runId)}/wcag-analysis`
  );

  /** @type {Array<{ key: string, label: string }>} */
  const filters = $derived([
    { key: 'all', label: tr('cov.filter.all') },
    { key: 'auto', label: tr('cov.filter.auto') },
    { key: 'not-auto', label: tr('cov.filter.notAuto') },
    { key: 'manual', label: tr('cov.filter.manual') },
    { key: 'pro', label: tr('cov.filter.pro') },
  ]);

  const visible = $derived.by(() => {
    const list = /** @type {Criterion[]} */ (data?.criteria || []);
    if (filter === 'auto') return list.filter((c) => c.auto !== 'none');
    if (filter === 'not-auto') return list.filter((c) => c.auto === 'none');
    if (filter === 'manual') return list.filter((c) => c.auto === 'none' && c.manualCanCover);
    if (filter === 'pro') return list.filter((c) => c.needsProfessional);
    return list;
  });

  function runLabel(status) {
    return known(`cov.run.${status}`, String(status));
  }

  function autoLabel(auto) {
    return known(`cov.auto.${auto}`, String(auto));
  }

  function manualText(item) {
    return known(`manual.item.${item.id}`, item.text);
  }

  async function load(kind) {
    error = '';
    if (kind === 'post') generating = true;
    else loading = true;
    try {
      const res = await fetch(apiPath, {
        method: kind === 'post' ? 'POST' : 'GET',
        credentials: 'same-origin',
        headers: kind === 'post'
          ? (typeof globalThis.wcagHeaders === 'function'
            ? globalThis.wcagHeaders({ 'Content-Type': 'application/json' })
            : { 'Content-Type': 'application/json' })
          : undefined,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || tr('cov.error'));
      data = body;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
      generating = false;
    }
  }

  onMount(() => {
    let cancelled = false;
    (async () => {
      await load('get');
      if (cancelled) return;
      if (data?.llmAvailable && data?.source !== 'anthropic') {
        await load('post');
      }
    })();
    return () => {
      cancelled = true;
    };
  });
</script>

{#if loading && !data}
  <p class="muted" role="status">{tr('cov.loading')}</p>
{:else if error && !data}
  <p class="muted" role="alert">{error}</p>
{:else if data}
  <div class="coverage-kpis">
    <div class="coverage-kpi">
      <div class="muted coverage-kpi-label">{tr('cov.kpi.auto')}</div>
      <div class="coverage-kpi-value">{data.counts.autoAttempted}/{data.total}</div>
      <div class="muted" style="font-size: 12px;">{tr('cov.kpi.autoSub')}</div>
    </div>
    <div class="coverage-kpi">
      <div class="muted coverage-kpi-label">{tr('cov.kpi.notAuto')}</div>
      <div class="coverage-kpi-value">{data.counts.autoNotChecked}</div>
      <div class="muted" style="font-size: 12px;">{tr('cov.kpi.notAutoSub')}</div>
    </div>
    <div class="coverage-kpi">
      <div class="muted coverage-kpi-label">{tr('cov.kpi.manual')}</div>
      <div class="coverage-kpi-value">{data.counts.manualCanCover}</div>
      <div class="muted" style="font-size: 12px;">{tr('cov.kpi.manualSub')}</div>
    </div>
    <div class="coverage-kpi">
      <div class="muted coverage-kpi-label">{tr('cov.kpi.outside')}</div>
      <div class="coverage-kpi-value">{data.counts.outsideProduct}</div>
      <div class="muted" style="font-size: 12px;">{tr('cov.kpi.outsideSub')}</div>
    </div>
  </div>

  <section class="card-flat coverage-narrative">
    <p class="eyebrow"><span class="dot"></span>
      {data.source === 'anthropic' ? tr('cov.source.anthropic') : tr('cov.source.static')}
    </p>
    {#if generating}
      <p class="muted" style="font-size: 13px;" role="status">{tr('cov.generating')}</p>
    {/if}
    {#if error}
      <p class="muted" role="alert" style="font-size: 13px;">{error} {tr('cov.fallback')}</p>
    {/if}
    <h2>{tr('cov.h.checked')}</h2>
    <p lang={contentLang}>{data.narrative.checked}</p>
    <h2>{tr('cov.h.notChecked')}</h2>
    <p lang={contentLang}>{data.narrative.notChecked}</p>
    <h2>{tr('cov.h.manual')}</h2>
    <p lang={contentLang}>{data.narrative.manualCanCover}</p>
    <h2>{tr('cov.h.path')}</h2>
    <p lang={contentLang}>{data.narrative.pathToConformance}</p>
    <div class="coverage-disclaimer">
      <strong>{tr('cov.notOfficial')}</strong>
      <span lang={contentLang}>{data.narrative.disclaimer}</span>
    </div>
    {#if data.llmAvailable}
      <button class="btn btn-secondary btn-sm" type="button" disabled={generating} onclick={() => load('post')}>
        {generating ? tr('cov.writing') : tr('cov.rewrite')}
      </button>
    {:else}
      <p class="muted" style="font-size: 12px; margin-top: 12px;">{tr('cov.noLlm')}</p>
    {/if}
  </section>

  <div class="coverage-filters" role="group" aria-label={tr('cov.filterLabel')}>
    {#each filters as f}
      <button
        type="button"
        class="btn btn-sm coverage-filter {filter === f.key ? 'btn-primary' : 'btn-ghost'}"
        aria-pressed={filter === f.key}
        onclick={() => (filter = f.key)}
      >
        {f.label}
      </button>
    {/each}
  </div>

  <ol class="coverage-list">
    {#each visible as c (c.id)}
      <li class="coverage-row">
        <div class="coverage-row-head">
          <a class="coverage-sc" href={c.url} target="_blank" rel="noopener">
            {c.id}
          </a>
          <strong lang={contentLang}>{c.title}</strong>
          <span class="tag tag-outline">{tr('cov.level', { level: c.level })}</span>
          <span class="tag {c.auto === 'none' ? 'tag-warning' : 'tag-outline'}">{autoLabel(c.auto)}</span>
          <span class="tag {c.thisRun === 'fail' ? 'tag-error' : c.thisRun === 'warn' ? 'tag-warning' : 'tag-outline'}">{runLabel(c.thisRun)}</span>
        </div>
        <p class="muted" style="font-size: 13px; margin: 6px 0 0;" lang={contentLang}>{c.autoNote}</p>
        {#if c.findings.length}
          <p style="font-size: 13px; margin: 6px 0 0;">
            {tr('cov.thisRun')}
            {#each c.findings.slice(0, 4) as f, i (i)}{#if i > 0}; {/if}<span lang={findingAttr(f)}>{f.label}</span>{/each}
          </p>
        {/if}
        {#if c.manualCanCover}
          <p style="font-size: 13px; margin: 8px 0 0;">
            {tn(lang, 'cov.manual', c.manualItems.length)}
            {c.manualChecked ? tr('cov.manual.done') : c.manualPartial ? tr('cov.manual.partial') : tr('cov.manual.open')}:
            {c.manualItems.map((i) => (i.checked ? '✓ ' : '○ ') + manualText(i)).join(' · ')}
          </p>
        {:else if c.needsProfessional}
          <p class="muted" style="font-size: 13px; margin: 8px 0 0;">{tr('cov.pro')}</p>
        {/if}
      </li>
    {/each}
  </ol>

  <p class="muted" style="font-size: 12px; margin-top: 24px;">
    {tr('cov.footer', { site: primaryHost, shown: visible.length, total: data.total })}
    <a class="link" href="/limitations">{tr('cov.limitations')}</a>
  </p>
{/if}

<style>
  .coverage-kpis {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 12px;
    margin-bottom: 24px;
  }
  @media (max-width: 800px) {
    .coverage-kpis { grid-template-columns: 1fr 1fr; }
  }
  .coverage-kpi {
    background: var(--us-cream);
    border: 1px solid var(--border-subtle);
    border-radius: 12px;
    padding: 16px;
  }
  .coverage-kpi-label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .coverage-kpi-value {
    font-family: var(--font-display);
    font-weight: 700;
    font-size: 28px;
    margin: 4px 0;
  }
  .coverage-narrative {
    padding: 24px;
    margin-bottom: 24px;
  }
  .coverage-narrative h2 {
    font-size: 18px;
    margin: 18px 0 8px;
  }
  .coverage-narrative h2:first-of-type { margin-top: 8px; }
  .coverage-disclaimer {
    margin: 16px 0;
    padding: 14px 16px;
    border-radius: 10px;
    background: var(--us-peach, #ffd8c2);
    color: var(--fg-1);
    font-size: 14px;
    line-height: 1.55;
  }
  .coverage-filters {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 16px;
  }
  .coverage-filter {
    min-width: 24px;
    min-height: 24px;
  }
  .coverage-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .coverage-row {
    border: 1px solid var(--border-subtle);
    border-radius: 10px;
    padding: 14px 16px;
    background: var(--surface, #fff);
  }
  .coverage-row-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
  .coverage-sc {
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 600;
  }
</style>
