<script>
  import { onMount } from 'svelte';

  /**
   * @typedef {{ id: string, text: string, disabilities?: string[] }} ManualItem
   * @typedef {{ label: string, items: ManualItem[] }} ManualGroup
   */

  /**
   * @type {{
   *   domain: string,
   *   runId: string,
   *   groups: ManualGroup[],
   *   initialChecked?: string[],
   *   onProgress?: (info: { checked: string[], total: number, percent: number }) => void,
   *   readOnly?: boolean,
   * }}
   */
  let { domain, runId, groups, initialChecked = [], onProgress, readOnly = false } = $props();

  let checkedSet = $state(new Set(initialChecked));
  let saving = $state(false);
  let savedAt = $state(/** @type {Date | null} */ (null));
  let saveError = $state('');

  const total = $derived(groups.reduce((s, g) => s + g.items.length, 0));
  const percent = $derived(total === 0 ? 0 : Math.round((checkedSet.size / total) * 100));

  /** @type {ReturnType<typeof setTimeout> | null} */
  let pendingSave = null;
  let dirty = false;
  let saveGeneration = 0;

  function emitProgress() {
    onProgress?.({ checked: [...checkedSet], total, percent });
  }

  function persistChecked(checked) {
    return fetch(
      `/api/report/${encodeURIComponent(domain)}/${encodeURIComponent(runId)}/manual-progress`,
      {
        method: 'PUT',
        credentials: 'same-origin',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checked }),
      }
    );
  }

  async function saveNow() {
    if (readOnly || !domain || !runId) return;
    if (pendingSave) {
      clearTimeout(pendingSave);
      pendingSave = null;
    }
    const payload = [...checkedSet];
    const gen = ++saveGeneration;
    saving = true;
    saveError = '';
    try {
      const res = await persistChecked(payload);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Save failed (${res.status})`);
      }
      const data = await res.json().catch(() => null);
      if (!dirty && gen === saveGeneration && data && Array.isArray(data.checked)) {
        checkedSet = new Set(data.checked);
        emitProgress();
      }
      savedAt = new Date();
    } catch (err) {
      saveError = err instanceof Error ? err.message : String(err);
    } finally {
      saving = false;
    }
  }

  function scheduleSave() {
    emitProgress();
    if (readOnly) return;
    if (pendingSave) clearTimeout(pendingSave);
    pendingSave = setTimeout(() => {
      pendingSave = null;
      saveNow();
    }, 250);
  }

  function toggle(id) {
    if (readOnly) return;
    dirty = true;
    const next = new Set(checkedSet);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    checkedSet = next;
    scheduleSave();
  }

  onMount(() => {
    emitProgress();
    if (readOnly || !domain || !runId) return undefined;
    const loadTimer = setTimeout(() => {
      fetch(`/api/report/${encodeURIComponent(domain)}/${encodeURIComponent(runId)}/manual-progress`, {
        credentials: 'same-origin',
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (dirty) return;
          if (data && Array.isArray(data.checked)) {
            checkedSet = new Set(data.checked);
            emitProgress();
          }
        })
        .catch(() => {});
    }, 80);
    return () => {
      clearTimeout(loadTimer);
      if (pendingSave) {
        clearTimeout(pendingSave);
        pendingSave = null;
      }
      if (dirty && domain && runId) {
        persistChecked([...checkedSet]).catch(() => {});
      }
    };
  });

  function formatTime(d) {
    if (!d) return '';
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
</script>

<section class="manual-section">
  <header class="manual-head">
    <div>
      <span class="eyebrow"><span class="dot"></span>Human verification</span>
      <h2 style="font-size: 28px; margin-top: 6px;">Manual &amp; assistive-tech checklist</h2>
      <p class="muted" style="max-width: 640px; font-size: 15px;">
        Automated tests can't catch everything. Walk through each item with a real assistive technology and tick when verified.
        {readOnly ? 'Preview only — progress is not saved on a free snapshot.' : 'Ticks are saved for this domain and restored when you open a scan again.'}
      </p>
    </div>
    <div class="manual-progress-card">
      <div class="manual-progress-num">{percent}%</div>
      <div class="manual-progress-lbl">{checkedSet.size}/{total} verified</div>
      <div class="manual-progress-bar"><span style="width: {percent}%;"></span></div>
      <div class="manual-progress-meta">
        {#if saving}Saving…{:else if saveError}<span style="color: var(--us-peach-text);">{saveError}</span>{:else if savedAt}Saved at {formatTime(savedAt)}{/if}
      </div>
    </div>
  </header>

  {#each groups as group (group.label)}
    <div class="card-flat manual-group">
      <h3>{group.label}</h3>
      <ul class="manual-list">
        {#each group.items as item (item.id)}
          {@const isChecked = checkedSet.has(item.id)}
          <li class="manual-item" class:checked={isChecked}>
            <label>
              <input
                type="checkbox"
                checked={isChecked}
                disabled={readOnly}
                onchange={() => toggle(item.id)}
              />
              <span class="manual-text">{item.text}</span>
            </label>
            {#if item.disabilities && item.disabilities.length > 0}
              <div class="manual-tags">
                {#each item.disabilities as d (d)}
                  <span class="tag-outline">{d}</span>
                {/each}
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    </div>
  {/each}
</section>

<style>
  .manual-head {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 24px;
    align-items: end;
    margin-bottom: 24px;
  }
  .manual-progress-card {
    background: var(--us-ink);
    color: var(--us-cream);
    padding: 20px 24px;
    border-radius: 16px;
    min-width: 220px;
  }
  .manual-progress-num {
    font-family: var(--font-display);
    font-size: 40px;
    font-weight: 700;
    line-height: 1;
  }
  .manual-progress-lbl {
    font-size: 12px;
    opacity: 0.65;
    margin-top: 2px;
  }
  .manual-progress-bar {
    margin-top: 12px;
    height: 6px;
    background: rgba(255, 255, 255, 0.12);
    border-radius: 3px;
    overflow: hidden;
  }
  .manual-progress-bar > span {
    display: block;
    height: 100%;
    background: var(--us-mint);
    border-radius: 3px;
    transition: width 0.25s ease;
  }
  .manual-progress-meta {
    font-size: 11px;
    opacity: 0.65;
    margin-top: 8px;
    min-height: 14px;
  }
  .manual-group { padding: 24px; margin-bottom: 16px; }
  .manual-group h3 { font-size: 18px; margin-bottom: 14px; }
  .manual-list { list-style: none; padding: 0; margin: 0; }
  .manual-item {
    padding: 14px 0;
    border-top: 1px solid var(--border-subtle);
  }
  .manual-item:first-child { border-top: 0; }
  .manual-item label {
    display: flex;
    gap: 12px;
    align-items: flex-start;
    cursor: pointer;
  }
  .manual-item input[type='checkbox'] {
    width: 18px;
    height: 18px;
    margin-top: 3px;
    flex-shrink: 0;
    accent-color: var(--us-lilac-deep);
  }
  .manual-text {
    flex: 1;
    line-height: 1.5;
    font-size: 14.5px;
  }
  .manual-item.checked .manual-text {
    color: var(--fg-3);
    text-decoration: line-through;
  }
  .manual-tags {
    margin-left: 30px;
    margin-top: 6px;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .tag-outline {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    border-radius: var(--r-pill);
    border: 1px solid var(--border-default);
    background: var(--us-white);
    font-size: 11px;
    color: var(--fg-2);
  }
  @media (max-width: 720px) {
    .manual-head { grid-template-columns: 1fr; }
    .manual-progress-card { min-width: 0; }
  }
</style>
