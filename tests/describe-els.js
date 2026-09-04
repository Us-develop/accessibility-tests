import { OCCURRENCE_LIMIT } from '../occurrence-details.js';

export { OCCURRENCE_LIMIT };

const HTML_MAX = 400;

/**
 * Compact locators plus markup for DOM elements. Safe to serialize into page.evaluate.
 * @param {Iterable<Element> | ArrayLike<Element> | null | undefined} list
 * @param {number} [limit]
 * @returns {Array<{ tag: string, id: string, className: string, html: string, selector: string, occurrenceLabel: string }>}
 */
export function describeEls(list, limit = 40) {
  const cap = Number.isFinite(limit) ? limit : 40;
  const arr = Array.from(list || []).filter(Boolean);
  const total = arr.length;

  function clip(value) {
    const snippet = String(value || '').replace(/\s+/g, ' ').trim();
    if (!snippet) return '';
    return snippet.length > HTML_MAX ? `${snippet.slice(0, HTML_MAX - 1)}…` : snippet;
  }

  function attrNames(el) {
    try {
      if (typeof el.getAttributeNames === 'function') return Array.from(el.getAttributeNames());
    } catch {
      return [];
    }
    return [];
  }

  function attrValue(el, name) {
    try {
      const value = el.getAttribute(name);
      return value == null ? '' : String(value);
    } catch {
      return '';
    }
  }

  function escapeAttr(value) {
    return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  }

  function classOf(el) {
    const fromAttr = attrValue(el, 'class').trim();
    if (fromAttr) return fromAttr.split(/\s+/).filter(Boolean).join(' ');
    if (typeof el.className === 'string') return el.className.trim().split(/\s+/).filter(Boolean).join(' ');
    if (el.className && typeof el.className.baseVal === 'string') {
      return el.className.baseVal.trim().split(/\s+/).filter(Boolean).join(' ');
    }
    return '';
  }

  function serialize(el, tag) {
    const names = attrNames(el);
    const parts = [];
    const seen = new Set();
    function add(name, value) {
      if (!name || seen.has(name) || value == null || String(value) === '') return;
      seen.add(name);
      parts.push(`${name}="${escapeAttr(value)}"`);
    }
    for (const name of names) add(name, attrValue(el, name));
    if (!seen.has('id') && el.id) add('id', String(el.id));
    if (!seen.has('class')) {
      const cls = classOf(el);
      if (cls) add('class', cls);
    }

    let inner = '';
    try {
      inner = clip(el.innerHTML || '');
    } catch {
      inner = '';
    }

    const open = parts.length ? `<${tag} ${parts.join(' ')}>` : `<${tag}>`;
    if (inner) return clip(`${open}${inner}</${tag}>`);
    if (parts.length) return clip(`${open}</${tag}>`);

    try {
      if (typeof el.outerHTML === 'string' && el.outerHTML) return clip(el.outerHTML);
    } catch {
      /* ignore */
    }
    try {
      return clip(new XMLSerializer().serializeToString(el));
    } catch {
      return open;
    }
  }

  function cssPath(el) {
    const parts = [];
    let node = el;
    while (node && parts.length < 5) {
      const isEl = node.nodeType === 1 || (node.nodeType == null && node.tagName);
      if (!isEl) break;
      const tag = String(node.tagName || 'element').toLowerCase();
      const nodeId = node.id ? String(node.id) : attrValue(node, 'id');
      if (nodeId) {
        parts.unshift(`${tag}#${nodeId}`);
        break;
      }
      const parent = node.parentElement;
      if (!parent) {
        parts.unshift(tag);
        break;
      }
      const same = Array.from(parent.children).filter((child) => child.tagName === node.tagName);
      const index = same.indexOf(node) + 1;
      parts.unshift(same.length > 1 ? `${tag}:nth-of-type(${index})` : tag);
      node = parent;
    }
    return parts.join(' > ');
  }

  return arr.slice(0, cap).map((el, idx) => {
    const tag = String(el.tagName || 'element').toLowerCase();
    const id = el.id ? String(el.id) : attrValue(el, 'id');
    const className = classOf(el);
    return {
      tag,
      id,
      className,
      html: serialize(el, tag),
      selector: cssPath(el),
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
