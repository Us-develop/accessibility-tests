<script>
  /** @type {{ data: Array<{ date: string, score: number }>, width?: number, height?: number, showAxis?: boolean }} */
  let { data, width = 320, height = 100, showAxis = true } = $props();

  const min = 0;
  const max = 100;
  const points = $derived(
    data.length > 0
      ? data.map((d, i) => {
          const x = data.length > 1 ? (i / (data.length - 1)) * (width - 30) + 22 : width / 2;
          const y = height - 18 - ((d.score - min) / (max - min)) * (height - 30);
          return { x, y, ...d };
        })
      : []
  );
  const linePath = $derived(points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' '));
  const areaPath = $derived(
    points.length > 0
      ? `${linePath} L ${points[points.length - 1].x} ${height - 18} L ${points[0].x} ${height - 18} Z`
      : ''
  );
  const chartLabel = $derived.by(() => {
    if (!data.length) return 'Score trend, no data';
    const first = data[0];
    const last = data[data.length - 1];
    const best = data.reduce((a, b) => (b.score > a.score ? b : a), first);
    return `Score trend from ${first.score} on ${first.date} to ${last.score} on ${last.date}, best ${best.score}`;
  });
</script>

<svg
  viewBox="0 0 {width} {height}"
  preserveAspectRatio="xMidYMid meet"
  class="trend-chart-svg"
  role="img"
  aria-label={chartLabel}
>
  <defs>
    <linearGradient id="trend-fill" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0%" stop-color="#BDB4FF" stop-opacity="0.5" />
      <stop offset="100%" stop-color="#BDB4FF" stop-opacity="0" />
    </linearGradient>
  </defs>
  {#if showAxis}
    {#each [0, 25, 50, 75, 100] as v (v)}
      {@const y = height - 18 - (v / 100) * (height - 30)}
      <line x1="22" x2={width - 8} y1={y} y2={y} stroke="var(--us-n-40)" stroke-dasharray="2 4" stroke-width="1" />
    {/each}
  {/if}
  {#if areaPath}
    <path d={areaPath} fill="url(#trend-fill)" />
    <path
      d={linePath}
      fill="none"
      stroke="var(--us-lilac-deep)"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
    {#each points as p, i (i)}
      <circle cx={p.x} cy={p.y} r="3.5" fill="white" stroke="var(--us-lilac-deep)" stroke-width="2" />
    {/each}
    {#if showAxis}
      {#each points as p, i (i)}
        <text x={p.x} y={height - 4} text-anchor="middle" font-size="10" fill="var(--fg-3)" font-family="var(--font-body)">{p.date}</text>
      {/each}
    {/if}
  {/if}
</svg>

<style>
  .trend-chart-svg {
    width: 100%;
    max-width: 100%;
    height: auto;
    display: block;
  }
</style>
