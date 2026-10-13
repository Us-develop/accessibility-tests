/**
 * Published reference figures shown next to a run's own findings.
 *
 * These are context, not a ranking. They come from a different tool (WAVE)
 * run on home pages only, so they cannot be compared number for number with
 * this scanner's score or counts. The report must say so wherever they appear.
 *
 * To refresh: WebAIM publishes a new edition each spring. Update `edition`,
 * `retrieved` and every figure together from the source page, never one alone.
 *
 * Planned: once enough scans exist in our own database, add percentiles
 * computed from them alongside these figures (see README, "Benchmarks").
 */

export const WEBAIM_MILLION = Object.freeze({
  name: 'The WebAIM Million',
  publisher: 'WebAIM',
  url: 'https://webaim.org/projects/million/',
  edition: 'February 2026',
  retrieved: '2026-10-13',
  sample: 'the home pages of the top 1,000,000 websites',
  tool: 'WAVE',
  /** Share of home pages with at least one detected WCAG 2 failure. */
  pagesWithFailuresPct: 95.9,
  /** Average number of detected errors per home page. */
  averageErrorsPerPage: 56.1,
});

/**
 * WebAIM's six most common failure types, with the rules in this scanner that
 * detect the same kind of problem. `pct` is the share of home pages affected.
 */
export const COMMON_FAILURES = Object.freeze([
  {
    key: 'low-contrast',
    label: 'Low contrast text',
    pct: 83.9,
    axe: ['color-contrast'],
    custom: ['text-contrast'],
  },
  {
    key: 'missing-alt',
    label: 'Missing alternative text for images',
    pct: 53.1,
    axe: ['image-alt', 'input-image-alt', 'area-alt', 'role-img-alt'],
    custom: ['img-alt', 'image-map-alt'],
  },
  {
    key: 'missing-labels',
    label: 'Missing form input labels',
    pct: 51,
    axe: ['label', 'select-name'],
    custom: ['form-labels', 'placeholder-not-only-label'],
  },
  {
    key: 'empty-links',
    label: 'Empty links',
    pct: 46.3,
    axe: ['link-name'],
    custom: ['link-text'],
  },
  {
    key: 'empty-buttons',
    label: 'Empty buttons',
    pct: 30.6,
    axe: ['button-name', 'input-button-name'],
    custom: [],
  },
  {
    key: 'missing-lang',
    label: 'Missing document language',
    pct: 13.5,
    axe: ['html-has-lang'],
    custom: ['html-lang'],
  },
]);

/**
 * For each common failure type, the pages of this run where it was found.
 * Only a `fail` from a custom check or an axe violation counts; warnings and
 * "needs review" results do not.
 *
 * @param {{ urls?: string[], axeResults?: Record<string, any>, customResults?: any[] }} reportData
 * @returns {{ source: typeof WEBAIM_MILLION, pagesScanned: number, rows: { key: string, label: string, pct: number, pagesAffected: number, found: boolean }[] }}
 */
export function buildPublishedBenchmarks(reportData) {
  const scanned = new Set(Array.isArray(reportData?.urls) ? reportData.urls : []);
  const rows = COMMON_FAILURES.map((type) => {
    const pages = new Set();
    for (const row of reportData?.customResults || []) {
      if (row?.status === 'fail' && type.custom.includes(row.id) && scanned.has(row.url)) pages.add(row.url);
    }
    for (const [url, data] of Object.entries(reportData?.axeResults || {})) {
      if (!scanned.has(url)) continue;
      if ((data?.violations || []).some((v) => type.axe.includes(v.id))) pages.add(url);
    }
    return { key: type.key, label: type.label, pct: type.pct, pagesAffected: pages.size, found: pages.size > 0 };
  });
  return { source: WEBAIM_MILLION, pagesScanned: scanned.size, rows };
}
