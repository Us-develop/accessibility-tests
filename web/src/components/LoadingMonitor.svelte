<script>
  /**
   * Polls /api/status and shows real page progress from the worker.
   */
  import { onMount, onDestroy } from 'svelte';

  function wcUrl(path) {
    if (typeof globalThis !== 'undefined' && typeof globalThis.wcagApiUrl === 'function') {
      return globalThis.wcagApiUrl(path);
    }
    return path;
  }
  function wcCreds() {
    if (typeof globalThis !== 'undefined' && typeof globalThis.wcagFetchCredentials === 'function') {
      return globalThis.wcagFetchCredentials();
    }
    return 'same-origin';
  }

  /** @type {{ domain?: string, runId?: string, guestToken?: string, sampleUrls?: string[] }} */
  let { domain = '', runId = '', guestToken = '', sampleUrls = [] } = $props();

  let pollTimer;
  let progress = $state(2);
  let totalPages = $state(sampleUrls.length || 1);
  let processedPages = $state(0);
  let currentUrl = $state(sampleUrls[0] || '');
  let errorMsg = $state('');

  const currentStage = $derived(
    progress >= 100
      ? { label: 'Compiling report' }
      : processedPages === 0
        ? { label: 'Starting scan' }
        : { label: `Scanning page ${Math.min(processedPages, totalPages)} of ${totalPages}` }
  );

  function applyStatus(data) {
    const total = Number(data.urls || data.processedUrls || totalPages || 1);
    if (total > 0) totalPages = total;
    if (data.scannedPages != null) processedPages = Number(data.scannedPages);
    else if (data.status === 'running' && data.currentUrl) processedPages = Math.max(processedPages, 1);
    if (data.currentUrl) currentUrl = String(data.currentUrl);
    if (data.error) errorMsg = String(data.error);
    if (data.status === 'done') {
      processedPages = totalPages;
      progress = 100;
    } else if (totalPages > 0) {
      const pct = Math.round((processedPages / totalPages) * 90);
      progress = Math.max(4, Math.min(90, pct || 4));
    }
  }

  async function poll() {
    try {
      const statusPath = guestToken
        ? `/api/guest/${encodeURIComponent(guestToken)}/status`
        : `/api/status/${encodeURIComponent(domain)}/${encodeURIComponent(runId)}`;
      const res = await fetch(wcUrl(statusPath), {
        cache: 'no-store',
        credentials: wcCreds(),
      });
      if (!res.ok) {
        if (res.status === 404) {
          errorMsg = 'Run not found.';
        }
        if (res.status === 401) {
          errorMsg = 'Session expired — sign in again.';
          const next = typeof window !== 'undefined' ? window.location.href : '';
          window.location.href = wcUrl('/auth/login') + '?next=' + encodeURIComponent(next || '/loading');
        }
        return;
      }
      const data = await res.json();
      applyStatus(data);
      if (data.status === 'done') {
        clearInterval(pollTimer);
        setTimeout(() => {
          if (guestToken) {
            window.location.replace(wcUrl(`/teaser/${encodeURIComponent(guestToken)}`));
          } else {
            window.location.replace(wcUrl(`/report/${encodeURIComponent(domain)}/${encodeURIComponent(runId)}/`));
          }
        }, 600);
      } else if (data.status === 'error') {
        clearInterval(pollTimer);
      }
    } catch {
      /* network blip; the next tick will retry */
    }
  }

  onMount(() => {
    poll();
    pollTimer = setInterval(poll, 1500);
  });

  onDestroy(() => {
    clearInterval(pollTimer);
  });
</script>

<div class="loading-shell" data-screen-label="02 Loading - Running audit">
  <!-- background orbs -->
  <div aria-hidden="true" class="orb orb-warm"></div>
  <div aria-hidden="true" class="orb orb-cool"></div>
  <div aria-hidden="true" class="orb orb-iri"></div>

  <div class="loading-grid">
    <!-- LEFT: copy + status -->
    <div>
      <span class="eyebrow">
        <span class="dot" style="background: var(--us-mint-text);"></span>
        Audit in progress &middot; automated WCAG 2.2 AA checks
      </span>
      <h1 class="loading-title">
        Reading every <em>pixel</em>, line, and aria.
      </h1>
      <p class="p-large muted loading-lead">
        {#if guestToken}
          We're scanning this page with axe-core and custom checks aligned with WCAG 2.2 AA. A snapshot of the top issues will appear next. This is not a full audit.
        {:else}
          We're scanning {totalPages} page{totalPages === 1 ? '' : 's'} with automated WCAG 2.2 AA checks.
          You can close this tab — we'll email when it's done if you asked us to.
        {/if}
      </p>

      <div class="progress-row">
        <div class="progress-meta">
          <span class="stage">{currentStage.label}&hellip;</span>
          <span class="progress-pct">{Math.round(progress)}%</span>
        </div>
        <div class="progress-track">
          <div class="progress-fill" style="width: {progress}%;"></div>
        </div>
      </div>

      <div class="live-log">
        <div class="log-line log-ok">
          <span>&check;</span>
          <span>{totalPages} URL{totalPages === 1 ? '' : 's'} queued</span>
        </div>
        <div class="log-line log-active">
          <span>&rarr;</span>
          <span>
            {processedPages > 0
              ? `page ${Math.min(processedPages, totalPages)} of ${totalPages}`
              : 'waiting for first page'}
            {#if currentUrl}
              &middot; <strong>{currentUrl}</strong>
            {/if}
          </span>
        </div>
        <div class="log-line">
          <span>·</span>
          <span>Issue counts appear when the scan finishes — we do not invent them while it runs.</span>
        </div>
        {#if errorMsg}
          <div class="log-line log-error">
            <span>&#x2715;</span><span>{errorMsg}</span>
          </div>
        {/if}
      </div>
    </div>

    <!-- RIGHT: holo objects -->
    <div class="holo-stage">
      <div aria-hidden="true" class="halo"></div>

      <img src="/assets/holo-ring-1.png" alt="" class="ring ring-1" />
      <img src="/assets/holo-ring-2.png" alt="" class="ring ring-2" />
      <img src="/assets/holo-swirl.png" alt="" class="ring swirl" />

      {#each [0, 1, 2, 3, 4, 5] as i (i)}
        {@const angle = (i / 6) * Math.PI * 2 + progress / 40}
        {@const radius = 260 + Math.sin(progress / 20 + i) * 10}
        {@const colors = ['#FFB985', '#F3AAFF', '#BDB4FF', '#A7F0FB', '#8DFFB7', '#6257E8']}
        {@const size = 12 + (i % 3) * 4}
        <div
          aria-hidden="true"
          class="orbit-dot"
          style={`width:${size}px; height:${size}px; background:${colors[i]}; left:calc(50% + ${Math.cos(angle) * radius}px - ${size / 2}px); top:calc(50% + ${Math.sin(angle) * radius}px - ${size / 2}px); box-shadow:0 4px 16px ${colors[i]};`}
        ></div>
      {/each}

      <div class="counter-pill">{Math.round(progress)}%</div>
    </div>
  </div>

  <div class="loading-footer">
    Audit ID: {domain} / {runId} &middot; You can safely close this tab.
  </div>
</div>

<style>
  .loading-shell {
    min-height: calc(100dvh - 65px);
    min-height: calc(100vh - 65px);
    position: relative;
    background: var(--us-cream);
    color: var(--fg-1);
    overflow: hidden;
    padding-bottom: env(safe-area-inset-bottom, 0px);
  }
  .orb {
    position: absolute;
    border-radius: 50%;
  }
  .orb-warm {
    top: -20%;
    left: 5%;
    width: 580px;
    height: 580px;
    background: var(--us-grad-warm);
    opacity: 0.5;
    filter: blur(70px);
    animation: drift 18s ease-in-out infinite;
  }
  .orb-cool {
    bottom: -25%;
    right: 0;
    width: 700px;
    height: 700px;
    background: var(--us-grad-cool);
    opacity: 0.55;
    filter: blur(80px);
    animation: drift 22s ease-in-out infinite reverse;
  }
  .orb-iri {
    top: 20%;
    right: 15%;
    width: 320px;
    height: 320px;
    background: var(--us-grad-iridescent);
    opacity: 0.35;
    filter: blur(40px);
    animation: drift 14s ease-in-out infinite;
  }
  .loading-grid {
    position: relative;
    max-width: 1280px;
    margin: 0 auto;
    padding: clamp(28px, 6vw, 60px) clamp(16px, 4vw, 32px) clamp(100px, 14vw, 120px);
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: clamp(28px, 5vw, 60px);
    align-items: center;
    min-height: calc(100dvh - 65px);
    min-height: calc(100vh - 65px);
  }
  @media (max-width: 900px) {
    .loading-grid {
      grid-template-columns: 1fr;
      gap: 32px;
    }
  }
  @media (max-width: 520px) {
    .loading-grid {
      padding-bottom: 120px;
    }
    .loading-lead {
      margin-bottom: 24px;
    }
    .progress-pct {
      font-size: 24px;
    }
    .live-log {
      font-size: 11.5px;
      padding: 14px;
    }
  }
  .loading-title {
    font-size: clamp(40px, 5vw, 64px);
    margin-top: 14px;
    margin-bottom: 18px;
  }
  .loading-title em {
    font-style: normal;
    background: var(--us-grad-iridescent);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }
  .loading-lead {
    max-width: 480px;
    margin-bottom: 36px;
  }
  .progress-row {
    margin-bottom: 26px;
  }
  .progress-meta {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 10px;
  }
  .stage {
    font-family: var(--font-mono);
    font-size: 13px;
    color: var(--fg-2);
  }
  .progress-pct {
    font-family: var(--font-display);
    font-size: 30px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .progress-track {
    height: 6px;
    border-radius: 999px;
    background: rgba(25, 25, 27, 0.08);
    overflow: hidden;
  }
  .progress-fill {
    height: 100%;
    background: var(--us-grad-iridescent);
    background-size: 200% 100%;
    animation: shimmer 3s linear infinite;
    transition: width 0.3s ease;
  }
  .live-log {
    padding: 18px;
    border-radius: 14px;
    background: var(--us-white);
    border: 1px solid var(--border-subtle);
    font-family: var(--font-mono);
    font-size: 12.5px;
    line-height: 1.7;
    box-shadow: var(--shadow-card);
  }
  .log-line {
    display: flex;
    gap: 10px;
  }
  .log-line + .log-line {
    margin-top: 4px;
  }
  .log-ok {
    color: var(--us-mint-text);
  }
  .log-active {
    color: var(--fg-1);
  }
  .log-active span:first-child {
    color: var(--us-lilac-deep);
  }
  .log-warn {
    color: var(--us-peach-text);
  }
  .log-error {
    color: var(--status-error);
  }
  .holo-stage {
    position: relative;
    height: clamp(260px, 55vw, 560px);
    max-width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  @media (max-width: 520px) {
    .holo-stage {
      height: clamp(220px, 58vmin, 340px);
      transform: scale(0.82);
      transform-origin: center center;
    }
    .ring-1 {
      width: min(520px, 100%) !important;
    }
  }
  .halo {
    position: absolute;
    width: 480px;
    height: 480px;
    border-radius: 50%;
    background: var(--us-grad-iridescent);
    opacity: 0.55;
    filter: blur(45px);
    animation: pulse-soft 5s ease-in-out infinite;
  }
  .ring {
    user-select: none;
    pointer-events: none;
  }
  .ring-1 {
    position: relative;
    width: 520px;
    height: auto;
    filter: drop-shadow(0 30px 60px rgba(98, 87, 232, 0.35));
    animation: ring-spin 14s linear infinite, float-y 6s ease-in-out infinite;
  }
  .ring-2 {
    position: absolute;
    width: 220px;
    height: auto;
    top: 12%;
    right: 5%;
    filter: drop-shadow(0 16px 32px rgba(243, 170, 255, 0.45));
    animation: ring-spin 9s linear infinite reverse, float-y 4.5s ease-in-out infinite;
  }
  .swirl {
    position: absolute;
    width: 200px;
    height: auto;
    bottom: 5%;
    left: 0;
    filter: drop-shadow(0 20px 40px rgba(141, 255, 183, 0.4));
    animation: float-y 5s ease-in-out infinite reverse, drift 12s ease-in-out infinite;
  }
  .orbit-dot {
    position: absolute;
    border-radius: 50%;
    transition: all 0.4s ease;
  }
  .counter-pill {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    background: rgba(255, 255, 255, 0.85);
    backdrop-filter: blur(20px);
    padding: 10px 22px;
    border-radius: 999px;
    border: 1px solid rgba(255, 255, 255, 0.9);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
    font-family: var(--font-display);
    font-weight: 700;
    font-size: 24px;
    font-variant-numeric: tabular-nums;
  }
  .loading-footer {
    position: absolute;
    bottom: max(16px, env(safe-area-inset-bottom, 0px));
    left: 0;
    right: 0;
    padding: 0 16px;
    text-align: center;
    font-size: clamp(11px, 2.8vw, 13px);
    color: var(--fg-3);
  }
  @keyframes ring-spin {
    0% {
      transform: rotate(0deg);
    }
    100% {
      transform: rotate(360deg);
    }
  }
</style>
