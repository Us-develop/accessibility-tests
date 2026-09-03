import { OCCURRENCE_LIMIT } from '../occurrence-details.js';

export { OCCURRENCE_LIMIT };

/**
 * Compact tag#id.class descriptors for DOM elements. Safe to serialize into page.evaluate.
 * @param {Iterable<Element> | ArrayLike<Element> | null | undefined} list
 * @param {number} [limit]
 * @returns {Array<{ tag: string, id: string, className: string, occurrenceLabel: string }>}
 */
export function describeEls(list, limit = 40) {
  const cap = Number.isFinite(limit) ? limit : 40;
  const arr = Array.from(list || []).filter(Boolean);
  const total = arr.length;
  return arr.slice(0, cap).map((el, idx) => {
    const tag = String(el.tagName || 'element').toLowerCase();
    const id = el.id ? String(el.id) : '';
    let className = '';
    if (typeof el.className === 'string') className = el.className.trim();
    else if (el.className && typeof el.className.baseVal === 'string') className = el.className.baseVal.trim();
    className = className.split(/\s+/).filter(Boolean).join(' ');
    return {
      tag,
      id,
      className,
      occurrenceLabel: total > 1 ? ` (occurrence ${idx + 1} of ${total})` : '',
    };
  });
}

/**
 * Run a collector in the page with describeEls in scope (no eval of page CSP user code).
 * collector must be a function (describeEls, limit) => value and must not close over Node bindings.
 * @param {import('playwright').Page} page
 * @param {(describeEls: typeof describeEls, limit: number) => unknown} collector
 */
export async function pageCollect(page, collector) {
  const wrapped = `(() => {
    const describeEls = ${describeEls.toString()};
    const collector = ${collector.toString()};
    return collector(describeEls, ${OCCURRENCE_LIMIT});
  })()`;
  return page.evaluate(wrapped);
}
