/**
 * Names of duplicated HTML id attributes, from custom unique-ids checks or axe duplicate-id* rules.
 */

/**
 * @param {string | null | undefined} id
 * @returns {string}
 */
export function formatIdSelector(id) {
  const value = id == null ? '' : String(id);
  if (value === '') return '(empty id)';
  return `#${value}`;
}

/**
 * @param {string[]} ids
 * @returns {string}
 */
export function formatDuplicateIdList(ids) {
  return (ids || []).map(formatIdSelector).join(', ');
}

/**
 * @param {unknown[]} list
 * @returns {string[]}
 */
function uniqueIds(list) {
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const id = raw == null ? '' : String(raw);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * @param {object | null | undefined} row custom result
 * @returns {string[]}
 */
export function idsFromCustomResult(row) {
  if (!row || row.id !== 'unique-ids') return [];
  const occ = Array.isArray(row.occurrences) ? row.occurrences : [];
  if (occ.length > 0) {
    const named = uniqueIds(occ.map((item) => (item && item.id != null ? String(item.id) : '')).filter((id) => id !== ''));
    if (named.length) return named;
    const emptyCount = occ.filter((item) => item && (item.id == null || String(item.id) === '')).length;
    if (emptyCount > 1) return [''];
  }
  const msg = String(row.message || '');
  const match = msg.match(/Duplicate IDs:\s*(.*)$/i);
  if (!match) return [];
  return uniqueIds(
    match[1]
      .split(/\s*,\s*/)
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
  );
}

/**
 * @param {object | null | undefined} violation axe violation
 * @returns {string[]}
 */
export function idsFromAxeViolation(violation) {
  const ruleId = String(violation?.id || '');
  if (!ruleId.startsWith('duplicate-id')) return [];
  const collected = [];
  for (const node of violation.nodes || []) {
    for (const check of [...(node.any || []), ...(node.all || []), ...(node.none || [])]) {
      if (check && check.data != null && String(check.data) !== '') {
        collected.push(String(check.data));
      }
    }
    const html = String(node.html || '');
    const htmlMatch = html.match(/\bid\s*=\s*["']([^"']*)["']/i);
    if (htmlMatch) collected.push(htmlMatch[1]);
    const target = Array.isArray(node.target) ? node.target[0] : node.target;
    if (typeof target === 'string') {
      const hash = target.match(/#([^\s.#\[]+)/);
      if (hash) collected.push(hash[1]);
    }
  }
  return uniqueIds(collected);
}

const HTML_SNIPPET_MAX = 400;

/**
 * @param {unknown} html
 * @returns {string}
 */
function clipHtmlSnippet(html) {
  const snippet = String(html || '').replace(/\s+/g, ' ').trim();
  if (!snippet) return '';
  return snippet.length > HTML_SNIPPET_MAX ? `${snippet.slice(0, HTML_SNIPPET_MAX - 1)}…` : snippet;
}

/**
 * True when markup is only a tag (optionally empty, optionally xmlns-only).
 * @param {string} html
 * @param {string} tag
 * @returns {boolean}
 */
function isUnhelpfulHtml(html, tag) {
  const compact = String(html || '').replace(/\s+/g, '');
  const name = String(tag || 'element').toLowerCase();
  const xmlns = '(?:xmlns(?::[\\w-]+)?="[^"]*")*';
  return (
    new RegExp(`^<${name}${xmlns}(?:\\s*/)?>$`, 'i').test(compact) ||
    new RegExp(`^<${name}${xmlns}></${name}>$`, 'i').test(compact)
  );
}

/**
 * Drop selectors that are just the tag name — they do not help locate the node.
 * @param {string} selector
 * @param {string} tag
 * @returns {string}
 */
function usefulSelector(selector, tag) {
  const value = String(selector || '').trim();
  if (!value || value === '—' || value === tag || value === 'element') return '';
  return value;
}

/**
 * Format occurrence as "tag#id.class" when a class exists.
 * If there is no class, prefer the element HTML so developers can find a bare <svg>.
 * @param {object | null | undefined} occ
 * @returns {string}
 */
export function formatOccurrenceDescriptor(occ) {
  if (!occ || typeof occ !== 'object') return '—';
  const label = occ.occurrenceLabel || '';
  const htmlSnippet = clipHtmlSnippet(occ.html);
  const sel = occ.selector || (Array.isArray(occ.target) ? occ.target[0] : occ.target);
  const selectorRaw = sel != null ? String(sel) : '';

  if (occ.tag != null) {
    const tag = (occ.tag || 'element').toLowerCase();
    const idPart = occ.id ? '#' + String(occ.id) : '';
    const classPart = occ.className
      ? '.' + String(occ.className).trim().split(/\s+/).filter(Boolean).join('.')
      : '';
    const selector = usefulSelector(selectorRaw, tag);
    if (classPart) return tag + idPart + classPart + label;
    if (htmlSnippet && !isUnhelpfulHtml(htmlSnippet, tag)) return htmlSnippet + label;
    if (selector) return (htmlSnippet ? `${htmlSnippet} — ${selector}` : selector) + label;
    if (idPart) return tag + idPart + label;
    if (htmlSnippet) return htmlSnippet + label;
    return tag + label;
  }
  if (occ.html) {
    const tagMatch = htmlSnippet.match(/<([a-z][a-z0-9]*)/i);
    const tag = tagMatch ? tagMatch[1].toLowerCase() : 'element';
    const idMatch = htmlSnippet.match(/\bid=["']([^"']*)["']/i);
    const id = idMatch ? idMatch[1] : '';
    const classMatch = htmlSnippet.match(/\bclass=["']([^"']*)["']/i);
    const rawClass = classMatch ? classMatch[1] : '';
    const selector = usefulSelector(selectorRaw, tag);
    if (rawClass.trim()) {
      const classPart = '.' + rawClass.trim().split(/\s+/).filter(Boolean).join('.');
      return tag + (id ? '#' + id : '') + classPart + label;
    }
    if (htmlSnippet && !isUnhelpfulHtml(htmlSnippet, tag)) return htmlSnippet + label;
    if (selector) return (htmlSnippet ? `${htmlSnippet} — ${selector}` : selector) + label;
    if (id) return tag + '#' + id + label;
    return htmlSnippet || tag;
  }
  return usefulSelector(selectorRaw, '') || selectorRaw || '—';
}

/**
 * @param {string[]} ids
 * @param {string} [fallback]
 * @returns {string}
 */
export function duplicateIdSnippet(ids, fallback) {
  if (!ids || ids.length === 0) return fallback || '';
  return `These id values appear more than once: ${formatDuplicateIdList(ids)}. Give each element its own unique id.`;
}
