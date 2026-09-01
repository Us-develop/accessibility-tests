<script>
  import { onMount } from 'svelte';

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

  /** @type {{ domain: string, runId: string, primaryHost: string }} */
  let { domain, runId, primaryHost } = $props();

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
  const filters = [
    { key: 'all', label: 'All' },
    { key: 'auto', label: 'Automated' },
    { key: 'not-auto', label: 'Not automated' },
    { key: 'manual', label: 'Manual can cover' },
    { key: 'pro', label: 'Needs a professional' },
  ];

  const visible = $derived.by(() => {
    const list = /** @type {Criterion[]} */ (data?.criteria || []);
    if (filter === 'auto') return list.filter((c) => c.auto !== 'none');
    if (filter === 'not-auto') return list.filter((c) => c.auto === 'none');
    if (filter === 'manual') return list.filter((c) => c.auto === 'none' && c.manualCanCover);
    if (filter === 'pro') return list.filter((c) => c.needsProfessional);
    return list;
  });

  function runLabel(status) {
    switch (status) {
      case 'fail':
        return 'Failed on this run';
      case 'warn':
        return 'Warning on this run';
      case 'incomplete':
        return 'Needs review';
      case 'pass':
        return 'Automated check passed';
      case 'not-checked':
        return 'Not automated';
      case 'not-run':
        return 'No finding this run';
      default: {
        const _exhaustive = status;
        return String(_exhaustive);
      }
    }
  }

  function autoLabel(auto) {
    switch (auto) {
      case 'partial':
        return 'Partial auto';
      case 'presence':
        return 'Presence auto';
      case 'none':
        return 'Not automated';
      default: {
        const _exhaustive = auto;
        return String(_exhaustive);
      }
    }
  }

  async function load(kind) {
    error = '';
    if (kind === 'post') generating = true;
    else loading = true;
    try {
      const res = await fetch(apiPath, {
        method: kind === 'post' ? 'POST' : 'GET',
        credentials: 'same-origin',
        headers: kind === 'post' ? { 'Content-Type': 'application/json' } : undefined,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
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
  <p class="muted">Building the WCAG 2.2 A/AA coverage matrix…</p>
{:else if error && !data}
  <p class="muted" role="alert">{error}</p>
{:else if data}
  <div class="coverage-kpis">
    <div class="coverage-kpi">
      <div class="muted coverage-kpi-label">Automated</div>
      <div class="coverage-kpi-value">{data.counts.autoAttempted}/{data.total}</div>
      <div class="muted" style="font-size: 12px;">criteria this scan can attempt</div>
    </div>
    <div class="coverage-kpi">
      <div class="muted coverage-kpi-label">Not automated</div>
      <div class="coverage-kpi-value">{data.counts.autoNotChecked}</div>
      <div class="muted" style="font-size: 12px;">need a human or a professional</div>
    </div>
    <div class="coverage-kpi">
      <div class="muted coverage-kpi-label">Manual can cover</div>
      <div class="coverage-kpi-value">{data.counts.manualCanCover}</div>
      <div class="muted" style="font-size: 12px;">of those via in-app checks</div>
    </div>
    <div class="coverage-kpi">
      <div class="muted coverage-kpi-label">Outside this product</div>
      <div class="coverage-kpi-value">{data.counts.outsideProduct}</div>
      <div class="muted" style="font-size: 12px;">still need a professional</div>
    </div>
  </div>

  <section class="card-flat coverage-narrative">
    <p class="eyebrow"><span class="dot"></span>
      {data.source === 'anthropic' ? 'Written with Anthropic from this run’s matrix' : 'Structured summary from this run’s matrix'}
    </p>
    {#if generating}
      <p class="muted" style="font-size: 13px;">Asking Anthropic to explain the matrix…</p>
    {/if}
    {#if error}
      <p class="muted" role="alert" style="font-size: 13px;">{error} Showing the structured summary instead.</p>
    {/if}
    <h2>What this scan checked</h2>
    <p>{data.narrative.checked}</p>
    <h2>What was not checked automatically</h2>
    <p>{data.narrative.notChecked}</p>
    <h2>What the manual checks can cover</h2>
    <p>{data.narrative.manualCanCover}</p>
    <h2>If the manual checks are done well</h2>
    <p>{data.narrative.pathToConformance}</p>
    <div class="coverage-disclaimer">
      <strong>Not an official audit.</strong>
      {data.narrative.disclaimer}
    </div>
    {#if data.llmAvailable}
      <button class="btn btn-secondary btn-sm" type="button" disabled={generating} onclick={() => load('post')}>
        {generating ? 'Writing…' : 'Rewrite analysis'}
      </button>
    {:else}
      <p class="muted" style="font-size: 12px; margin-top: 12px;">
        Set <code>ANTHROPIC_API_KEY</code> on the server to generate a written analysis. The matrix below is always computed locally.
      </p>
    {/if}
  </section>

  <div class="coverage-filters" role="group" aria-label="Filter success criteria">
    {#each filters as f}
      <button
        type="button"
        class="btn btn-sm {filter === f.key ? 'btn-primary' : 'btn-ghost'}"
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
          <strong>{c.title}</strong>
          <span class="tag tag-outline">Level {c.level}</span>
          <span class="tag {c.auto === 'none' ? 'tag-warning' : 'tag-outline'}">{autoLabel(c.auto)}</span>
          <span class="tag {c.thisRun === 'fail' ? 'tag-error' : c.thisRun === 'warn' ? 'tag-warning' : 'tag-outline'}">{runLabel(c.thisRun)}</span>
        </div>
        <p class="muted" style="font-size: 13px; margin: 6px 0 0;">{c.autoNote}</p>
        {#if c.findings.length}
          <p style="font-size: 13px; margin: 6px 0 0;">
            This run: {c.findings.map((f) => f.label).slice(0, 4).join('; ')}
          </p>
        {/if}
        {#if c.manualCanCover}
          <p style="font-size: 13px; margin: 8px 0 0;">
            Manual check{c.manualItems.length === 1 ? '' : 's'}
            {c.manualChecked ? 'completed' : c.manualPartial ? 'partly ticked' : 'not ticked'}:
            {c.manualItems.map((i) => (i.checked ? '✓ ' : '○ ') + i.text).join(' · ')}
          </p>
        {:else if c.needsProfessional}
          <p class="muted" style="font-size: 13px; margin: 8px 0 0;">
            Not in this product’s automation or checklist — include in a professional evaluation.
          </p>
        {/if}
      </li>
    {/each}
  </ol>

  <p class="muted" style="font-size: 12px; margin-top: 24px;">
    {primaryHost} · {visible.length} of {data.total} WCAG 2.2 A/AA success criteria shown.
    <a class="link" href="/limitations">Limitations</a>
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
