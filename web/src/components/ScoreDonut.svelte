<script module>
  let donutSeq = 0;
</script>
<script>
  /** @type {{ score: number, size?: number, stroke?: number, label?: string, showLabel?: boolean, threshold?: number }} */
  let { score, size = 160, stroke = 14, label = 'Score', showLabel = true, threshold = 80 } = $props();

  const radius = $derived((size - stroke) / 2);
  const circumference = $derived(2 * Math.PI * radius);
  const offset = $derived(circumference - (Math.max(0, Math.min(100, score)) / 100) * circumference);
  const passing = $derived(score >= threshold);
  const gradId = `donut-grad-${++donutSeq}`;
</script>

<div class="donut-wrap" style="width:{size}px; height:{size}px;">
  <svg width={size} height={size} viewBox="0 0 {size} {size}" aria-hidden="true">
    <defs>
      <linearGradient id={gradId} x1="0" x2="1" y1="0" y2="1">
        <stop offset="0%" stop-color="#FFB985" />
        <stop offset="50%" stop-color="#F3AAFF" />
        <stop offset="100%" stop-color="#BDB4FF" />
      </linearGradient>
    </defs>
    <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--us-n-30)" stroke-width={stroke} />
    <circle
      cx={size / 2}
      cy={size / 2}
      r={radius}
      fill="none"
      stroke={passing ? '#1E625A' : `url(#${gradId})`}
      stroke-width={stroke}
      stroke-dasharray={circumference}
      stroke-dashoffset={offset}
      stroke-linecap="round"
      transform={`rotate(-90 ${size / 2} ${size / 2})`}
      style="transition: stroke-dashoffset .8s cubic-bezier(.5,0,.2,1);"
    />
  </svg>
  <div class="donut-label">
    <div class="donut-value" style="font-size:{Math.round(size * 0.32)}px;">{score}</div>
    {#if showLabel}
      <div class="donut-caption">{label}</div>
    {/if}
  </div>
</div>

<style>
  .donut-wrap {
    position: relative;
    display: inline-block;
  }
  .donut-label {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
  }
  .donut-value {
    font-family: var(--font-display);
    font-weight: 700;
    line-height: 1;
    letter-spacing: -0.02em;
  }
  .donut-caption {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--fg-3);
    margin-top: 6px;
  }
</style>
