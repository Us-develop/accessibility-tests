import { formatOccurrenceDescriptor } from './duplicate-ids.js';

/** Max elements listed on a single finding. */
export const OCCURRENCE_LIMIT = 40;

function uniqueNonEmpty(list) {
  const seen = new Set();
  const out = [];
  for (const raw of list || []) {
    const value = String(raw || '').trim();
    if (!value || value === '—') continue;
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

/**
 * @param {object | null | undefined} row custom result
 * @param {number} [limit]
 * @returns {string[]}
 */
export function occurrenceDetailsFromCustom(row, limit = OCCURRENCE_LIMIT) {
  if (!row || typeof row !== 'object') return [];
  const fromList = Array.isArray(row.occurrences)
    ? row.occurrences.map((occ) => formatOccurrenceDescriptor(occ))
    : [];
  if (fromList.length) return uniqueNonEmpty(fromList).slice(0, limit);
  if (row.selector) return uniqueNonEmpty([row.selector]).slice(0, limit);
  return [];
}

/**
 * @param {object | null | undefined} violation axe violation
 * @param {number} [limit]
 * @returns {string[]}
 */
export function occurrenceDetailsFromAxe(violation, limit = OCCURRENCE_LIMIT) {
  const nodes = violation && Array.isArray(violation.nodes) ? violation.nodes : [];
  return uniqueNonEmpty(nodes.map((node) => formatOccurrenceDescriptor(node))).slice(0, limit);
}
