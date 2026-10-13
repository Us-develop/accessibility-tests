/**
 * The score model: three parts and one overall figure.
 *
 *   Errors         automated failures, weighted by severity      60%
 *   To review      findings the tool cannot decide on its own    15%
 *   Manual checks  the human checklist                           25%
 *
 * Overall is 100 only when all three parts are 100, and cannot go above
 * CRITICAL_CAP while a critical failure remains. 100 means "nothing left that
 * this tool can find, and the manual checks are done". It is not WCAG conformance.
 *
 * No dependencies: the dashboard imports this file in the browser to update the
 * overall score as boxes are ticked. Turning a scan result into these inputs
 * happens in scoring.js.
 */

/** Weight of a rule in the Errors part, by the rule's severity. */
export const SEVERITY_WEIGHTS = Object.freeze({ critical: 10, serious: 7, moderate: 3, minor: 1 });

export const OVERALL_WEIGHTS = Object.freeze({ errors: 0.6, review: 0.15, manual: 0.25 });

/** Highest overall score while any critical failure remains. */
export const CRITICAL_CAP = 79;

/** Share of `done` out of `total` as 0..100. Nothing to do counts as done. */
export function partScore(done, total) {
  const t = Math.max(0, Number(total) || 0);
  if (t === 0) return 100;
  const d = Math.max(0, Math.min(Number(done) || 0, t));
  return Math.round((d / t) * 100);
}

/**
 * @param {{
 *   errors: number | null,
 *   reviewDone?: number, reviewTotal?: number,
 *   manualDone?: number, manualTotal?: number,
 *   hasCritical?: boolean,
 * }} input `errors` is the Errors part, 0..100, or null when no page was scored.
 * @returns {{ overall: number, errors: number, review: number, manual: number, capped: boolean } | null}
 */
export function overallScore({
  errors,
  reviewDone = 0,
  reviewTotal = 0,
  manualDone = 0,
  manualTotal = 0,
  hasCritical = false,
} = {}) {
  if (errors == null || !Number.isFinite(Number(errors))) return null;
  const e = Math.max(0, Math.min(100, Math.round(Number(errors))));
  const review = partScore(reviewDone, reviewTotal);
  const manual = partScore(manualDone, manualTotal);
  let overall = Math.round(
    e * OVERALL_WEIGHTS.errors + review * OVERALL_WEIGHTS.review + manual * OVERALL_WEIGHTS.manual
  );
  // Rounding must not hand out a 100 while something is still open.
  if (overall >= 100 && !(e === 100 && review === 100 && manual === 100)) overall = 99;
  const capped = Boolean(hasCritical) && overall > CRITICAL_CAP;
  if (capped) overall = CRITICAL_CAP;
  return { overall, errors: e, review, manual, capped };
}
