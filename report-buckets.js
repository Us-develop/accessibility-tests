/**
 * Honest view-models for reports: POUR, disability impact, suggested fixes, and automated score.
 * Numbers are derived from this run's custom results + axe findings — never a fixed split.
 */
import { getRemediation } from './remediation-data.js';

/** Passes that are true on almost every modern page and must not inflate the score. */
export const VACUOUS_PASS_IDS = new Set([
  'no-auto-refresh',
  'tabindex-positive',
  'flash-alternative',
]);

export const PRINCIPLE_META = {
  perceivable: {
    key: 'perceivable',
    label: 'Perceivable',
    color: 'var(--us-lilac)',
    textColor: 'var(--us-lilac-text)',
    hex: '#BDB4FF',
    hexText: '#423A75',
  },
  operable: {
    key: 'operable',
    label: 'Operable',
    color: 'var(--us-mint)',
    textColor: 'var(--us-mint-text)',
    hex: '#8DFFB7',
    hexText: '#1E625A',
  },
  understandable: {
    key: 'understandable',
    label: 'Understandable',
    color: 'var(--us-sky)',
    textColor: 'var(--us-sky-text)',
    hex: '#A7F0FB',
    hexText: '#0D4F6E',
  },
  robust: {
    key: 'robust',
    label: 'Robust',
    color: 'var(--us-pink)',
    textColor: 'var(--us-pink-text)',
    hex: '#F3AAFF',
    hexText: '#7E1C74',
  },
};

const CHAPTER_TO_POUR = {
  images: 'perceivable',
  visualDesign: 'perceivable',
  multimedia: 'perceivable',
  inputMethods: 'operable',
  responsive: 'operable',
  forms: 'understandable',
  semantics: 'perceivable',
  dynamicUpdates: 'robust',
};

/** Custom check id → disability groups (fails/warns only when counted). */
export const DISABILITY_MAP = {
  'page-title-exists': ['Blindness', 'Low Vision', 'Reading Disabilities', 'Cognitive Disabilities'],
  'html-lang': ['Blindness', 'Reading Disabilities', 'Cognitive Disabilities'],
  'landmarks-present': ['Blindness', 'Low Vision', 'Cognitive Disabilities'],
  'single-main': ['Blindness', 'Low Vision', 'Cognitive Disabilities'],
  'heading-structure': ['Blindness', 'Low Vision', 'Reading Disabilities', 'Cognitive Disabilities'],
  'heading-main-h1': ['Blindness', 'Low Vision', 'Reading Disabilities', 'Cognitive Disabilities'],
  'link-text': ['Blindness', 'Low Vision', 'Reading Disabilities'],
  'link-meaningful': ['Blindness', 'Low Vision', 'Reading Disabilities', 'Cognitive Disabilities'],
  'skip-link': ['Blindness', 'Dexterity/Motor Disabilities'],
  'table-headers': ['Blindness', 'Low Vision', 'Reading Disabilities', 'Cognitive Disabilities'],
  'list-markup': ['Blindness', 'Low Vision', 'Reading Disabilities', 'Cognitive Disabilities'],
  'iframe-titles': ['Blindness', 'Low Vision', 'Cognitive Disabilities'],
  'unique-ids': ['Blindness', 'Cognitive Disabilities'],
  'img-alt': ['Blindness', 'Low Vision', 'Deafblindness'],
  'img-alt-length': ['Blindness', 'Low Vision', 'Deafblindness', 'Cognitive Disabilities'],
  'svg-role': ['Blindness', 'Low Vision', 'Deafblindness'],
  'svg-accessible-name': ['Blindness', 'Low Vision', 'Deafblindness'],
  'canvas-alt': ['Blindness', 'Low Vision', 'Deafblindness'],
  'image-map-alt': ['Blindness', 'Low Vision', 'Deafblindness'],
  'link-differentiation': ['Colorblindness', 'Low Vision'],
  'text-contrast': ['Low Vision', 'Colorblindness'],
  'non-text-contrast': ['Low Vision', 'Colorblindness'],
  'contrast-not-run': ['Low Vision', 'Colorblindness'],
  'focus-indicator': ['Low Vision', 'Dexterity/Motor Disabilities', 'Blindness'],
  'no-horizontal-scroll': ['Low Vision', 'Dexterity/Motor Disabilities'],
  'viewport-zoom': ['Low Vision', 'Dexterity/Motor Disabilities'],
  'video-captions': ['Deafness and Hard-of-Hearing', 'Deafblindness'],
  'video-autoplay': ['Deafness and Hard-of-Hearing', 'Cognitive Disabilities'],
  'audio-autoplay': ['Deafness and Hard-of-Hearing'],
  'embedded-media-captions': ['Deafness and Hard-of-Hearing'],
  'flash-alternative': ['Blindness', 'Deafness and Hard-of-Hearing'],
  'tabindex-positive': ['Dexterity/Motor Disabilities', 'Blindness'],
  'touch-target-size': ['Dexterity/Motor Disabilities', 'Low Vision'],
  'touch-target-size-enhanced': ['Dexterity/Motor Disabilities', 'Low Vision'],
  'form-labels': ['Blindness', 'Cognitive Disabilities', 'Reading Disabilities'],
  'placeholder-not-only-label': ['Blindness', 'Cognitive Disabilities', 'Reading Disabilities'],
  'no-auto-refresh': ['Cognitive Disabilities', 'Dexterity/Motor Disabilities'],
  'dynamic-announcements': ['Blindness', 'Cognitive Disabilities'],
  'dynamic-status-roles': ['Blindness', 'Cognitive Disabilities'],
  'dynamic-aria-busy': ['Blindness', 'Cognitive Disabilities'],
  'spa-may-be-unrendered': ['Blindness', 'Cognitive Disabilities'],
  'page-load': ['Various'],
};

export const DISABILITY_DISPLAY = [
  { key: 'blind', label: 'Blind / screen reader', icon: 'eye', sources: ['Blindness'] },
  { key: 'lowvision', label: 'Low vision / colour vision', icon: 'low-vision', sources: ['Low Vision', 'Colorblindness'] },
  { key: 'deaf', label: 'Deaf / hard of hearing', icon: 'audio', sources: ['Deafness and Hard-of-Hearing', 'Deafblindness'] },
  { key: 'motor', label: 'Motor / dexterity', icon: 'hand', sources: ['Dexterity/Motor Disabilities'] },
  { key: 'cognitive', label: 'Cognitive / reading', icon: 'brain', sources: ['Cognitive Disabilities', 'Reading Disabilities'] },
  { key: 'seizure', label: 'Seizure / vestibular', icon: 'warning', sources: ['Seizure Disorders'] },
];

const NAME_RULE_IDS = new Set([
  'img-alt',
  'image-alt',
  'svg-accessible-name',
  'form-labels',
  'label',
  'link-text',
  'link-name',
  'button-name',
  'input-button-name',
  'iframe-titles',
  'frame-title',
]);

const CONTRAST_RULE_IDS = new Set([
  'text-contrast',
  'non-text-contrast',
  'color-contrast',
  'link-differentiation',
  'contrast-not-run',
]);

const KEYBOARD_RULE_IDS = new Set([
  'tabindex-positive',
  'tabindex',
  'focus-indicator',
  'skip-link',
  'no-horizontal-scroll',
  'touch-target-size',
]);

/**
 * Parse axe tags such as wcag111, wcag143, wcag2411 → "1.1.1", "1.4.3", "2.4.11".
 * @param {string[] | undefined} tags
 * @returns {string[]}
 */
export function wcagFromAxeTags(tags) {
  const out = [];
  for (const tag of tags || []) {
    const m = String(tag).match(/^wcag(\d)(\d)(\d+)$/i);
    if (!m) continue;
    out.push(`${m[1]}.${m[2]}.${m[3]}`);
  }
  return out;
}

/**
 * @param {string[] | undefined} scs
 * @returns {'perceivable' | 'operable' | 'understandable' | 'robust' | null}
 */
export function principleFromWcag(scs) {
  for (const sc of scs || []) {
    const n = Number(String(sc).split('.')[0]);
    if (n === 1) return 'perceivable';
    if (n === 2) return 'operable';
    if (n === 3) return 'understandable';
    if (n === 4) return 'robust';
  }
  return null;
}

/**
 * @param {string[] | undefined} scs
 * @returns {string[]}
 */
export function disabilitiesFromWcag(scs) {
  const set = new Set();
  for (const sc of scs || []) {
    const s = String(sc);
    if (s.startsWith('1.1') || s.startsWith('1.3') || s.startsWith('4.1')) set.add('Blindness');
    if (s.startsWith('1.4')) {
      set.add('Low Vision');
      set.add('Colorblindness');
    }
    if (s.startsWith('1.2')) set.add('Deafness and Hard-of-Hearing');
    if (s.startsWith('2.1') || s.startsWith('2.4') || s.startsWith('2.5')) {
      set.add('Dexterity/Motor Disabilities');
      if (s.startsWith('2.4')) set.add('Blindness');
    }
    if (s.startsWith('2.2') || s.startsWith('2.3')) {
      set.add('Seizure Disorders');
      set.add('Cognitive Disabilities');
    }
    if (s.startsWith('3.')) {
      set.add('Cognitive Disabilities');
      set.add('Reading Disabilities');
    }
  }
  return [...set];
}

function wcagForCustom(row) {
  const rem = getRemediation(row.id, null);
  if (Array.isArray(rem.wcag) && rem.wcag.length) return rem.wcag.map(String);
  return [];
}

function wcagForAxe(violation) {
  const rem = getRemediation(null, violation.id);
  const fromRem = Array.isArray(rem.wcag) ? rem.wcag.map(String) : [];
  const fromTags = wcagFromAxeTags(violation.tags);
  return [...new Set([...fromRem, ...fromTags])];
}

function principleForFinding({ wcag, chapter, axeId }) {
  const fromSc = principleFromWcag(wcag);
  if (fromSc) return fromSc;
  if (chapter && CHAPTER_TO_POUR[chapter]) return CHAPTER_TO_POUR[chapter];
  if (axeId) {
    const rem = getRemediation(null, axeId);
    const fromAxe = principleFromWcag(rem.wcag);
    if (fromAxe) return fromAxe;
  }
  return 'robust';
}

function disabilitiesForFinding({ id, wcag }) {
  if (id && DISABILITY_MAP[id]) return DISABILITY_MAP[id];
  const fromSc = disabilitiesFromWcag(wcag);
  if (fromSc.length) return fromSc;
  return ['Various'];
}

export function effortToPoints(effort) {
  if (typeof effort === 'number' && Number.isFinite(effort)) {
    return Math.max(1, Math.min(8, Math.round(effort)));
  }
  const s = String(effort || '').toLowerCase();
  if (s === 'simple') return 2;
  if (s === 'complex') return 5;
  return 3;
}

/**
 * Automated score 0–100, or null when nothing scored.
 * Excludes info rows and vacuous passes. Axe incomplete is not treated as a pass.
 * @param {object} reportData
 * @returns {number | null}
 */
export function scoreFromReport(reportData) {
  if (!reportData || typeof reportData !== 'object') return null;
  let pass = 0;
  let fail = 0;
  let warn = 0;
  for (const row of reportData.customResults || []) {
    if (row.status === 'info') continue;
    if (row.status === 'pass' && VACUOUS_PASS_IDS.has(row.id)) continue;
    if (row.status === 'pass') pass += 1;
    else if (row.status === 'fail') fail += 1;
    else if (row.status === 'warn') warn += 1;
  }
  let axeViolations = 0;
  let axePasses = 0;
  for (const data of Object.values(reportData.axeResults || {})) {
    axeViolations += Number((data && data.violations && data.violations.length) || 0);
    axePasses += Number((data && data.passes && data.passes.length) || 0);
  }
  const den = pass + fail + warn + axeViolations + axePasses;
  if (den === 0) return null;
  return Math.max(0, Math.min(100, Math.round(((pass + axePasses) / den) * 100)));
}

export function countAxeIncomplete(reportData) {
  let n = 0;
  for (const data of Object.values(reportData.axeResults || {})) {
    n += Number((data && data.incomplete && data.incomplete.length) || 0);
  }
  return n;
}

function emptyPrincipleCounts() {
  return Object.fromEntries(
    Object.keys(PRINCIPLE_META).map((key) => [key, { errors: 0, warnings: 0, passed: 0 }])
  );
}

/**
 * @param {object} reportData
 */
export function buildPrinciples(reportData) {
  const counts = emptyPrincipleCounts();
  for (const row of reportData.customResults || []) {
    if (row.status === 'info') continue;
    if (row.status === 'pass' && VACUOUS_PASS_IDS.has(row.id)) continue;
    const wcag = wcagForCustom(row);
    const key = principleForFinding({ wcag, chapter: row.chapter });
    if (row.status === 'fail') counts[key].errors += 1;
    else if (row.status === 'warn') counts[key].warnings += 1;
    else if (row.status === 'pass') counts[key].passed += 1;
  }
  for (const data of Object.values(reportData.axeResults || {})) {
    for (const v of data.violations || []) {
      const wcag = wcagForAxe(v);
      const key = principleForFinding({ wcag, axeId: v.id });
      counts[key].errors += 1;
    }
    for (const v of data.passes || []) {
      const wcag = wcagForAxe(v);
      const key = principleForFinding({ wcag, axeId: v.id });
      counts[key].passed += 1;
    }
  }
  return Object.values(PRINCIPLE_META).map((meta) => ({
    ...meta,
    errors: counts[meta.key].errors,
    warnings: counts[meta.key].warnings,
    passed: counts[meta.key].passed,
  }));
}

function pageKey(url) {
  return url ? String(url) : '';
}

/**
 * Percent = share of scanned pages that have at least one relevant fail/warn/violation.
 * @param {object} reportData
 */
export function buildDisabilities(reportData) {
  const urls = Array.isArray(reportData.urls) ? reportData.urls.map(String) : [];
  const pageCount = Math.max(1, urls.length);
  const buckets = DISABILITY_DISPLAY.map((d) => ({
    ...d,
    issueCount: 0,
    pages: new Set(),
  }));
  const sourceToBuckets = new Map();
  for (const b of buckets) {
    for (const src of b.sources) {
      if (!sourceToBuckets.has(src)) sourceToBuckets.set(src, []);
      sourceToBuckets.get(src).push(b);
    }
  }

  function add(groups, url) {
    for (const g of groups) {
      const list = sourceToBuckets.get(g) || [];
      for (const b of list) {
        b.issueCount += 1;
        if (url) b.pages.add(pageKey(url));
      }
    }
  }

  for (const row of reportData.customResults || []) {
    if (row.status !== 'fail' && row.status !== 'warn') continue;
    const wcag = wcagForCustom(row);
    add(disabilitiesForFinding({ id: row.id, wcag }), row.url);
  }
  for (const [url, data] of Object.entries(reportData.axeResults || {})) {
    for (const v of data.violations || []) {
      const wcag = wcagForAxe(v);
      add(disabilitiesForFinding({ id: v.id, wcag }), url);
    }
  }

  return buckets.map((b) => {
    const percent = Math.round((b.pages.size / pageCount) * 100);
    let impact = 'None found';
    if (percent > 0 && percent <= 30) impact = 'Some pages';
    else if (percent > 30 && percent <= 70) impact = 'Many pages';
    else if (percent > 70) impact = 'Most pages';
    return {
      key: b.key,
      label: b.label,
      icon: b.icon,
      issues: b.issueCount,
      percent,
      pagesAffected: b.pages.size,
      impact,
    };
  });
}

/**
 * @param {Array<{ rule?: string, id?: string, status?: string, effort?: number | string, impact?: string }>} fixOrderItems
 * @param {number} [topN]
 */
export function buildSuggestedFixes(fixOrderItems, topN = 8) {
  const tickets = (fixOrderItems || []).slice(0, topN).map((item, idx) => {
    const points = effortToPoints(item.effort);
    const severity =
      item.status === 'violation' || item.status === 'fail' || item.type === 'violation'
        ? 'error'
        : 'warning';
    return {
      id: item.id || `fix-${idx + 1}`,
      title: item.rule || item.id || `Fix #${idx + 1}`,
      points,
      severity,
    };
  });
  return {
    name: 'Suggested fix order',
    duration: '',
    points: tickets.reduce((sum, t) => sum + t.points, 0),
    tickets,
  };
}

function pagesWithRule(reportData, idSet) {
  const pages = new Set();
  for (const row of reportData.customResults || []) {
    if (row.status !== 'fail' && row.status !== 'warn') continue;
    if (idSet.has(row.id) && row.url) pages.add(pageKey(row.url));
  }
  for (const [url, data] of Object.entries(reportData.axeResults || {})) {
    for (const v of data.violations || []) {
      if (idSet.has(v.id)) pages.add(pageKey(url));
    }
  }
  return pages.size;
}

function pagesWithErrors(reportData) {
  const pages = new Set();
  for (const row of reportData.customResults || []) {
    if (row.status === 'fail' && row.url) pages.add(pageKey(row.url));
  }
  for (const [url, data] of Object.entries(reportData.axeResults || {})) {
    if ((data.violations || []).length > 0) pages.add(pageKey(url));
  }
  return pages.size;
}

/**
 * Plain-English stats for the sales deck — always from this run.
 * @param {object} reportData
 */
export function buildPlainEnglishStats(reportData) {
  const pageCount = Math.max(1, (reportData.urls || []).length);
  const errorPages = pagesWithErrors(reportData);
  const contrastPages = pagesWithRule(reportData, CONTRAST_RULE_IDS);
  const namePages = pagesWithRule(reportData, NAME_RULE_IDS);
  const keyboardPages = pagesWithRule(reportData, KEYBOARD_RULE_IDS);

  let headline;
  if (errorPages === 0) {
    headline = 'Automated checks did not find errors on these pages.';
  } else if (errorPages === pageCount && pageCount === 1) {
    headline = 'This page has at least one automated error.';
  } else if (errorPages === pageCount) {
    headline = `Every scanned page (${pageCount}) has at least one automated error.`;
  } else {
    headline = `${errorPages} of ${pageCount} scanned pages have at least one automated error.`;
  }

  function card(pages, label, bodyWhenZero, bodyWhenSome) {
    const pct = Math.round((pages / pageCount) * 100);
    return {
      value: pageCount === 1 ? (pages ? 'Yes' : 'No') : `${pct}%`,
      label,
      body: pages === 0 ? bodyWhenZero : bodyWhenSome.replace('{n}', String(pages)).replace('{pct}', String(pct)),
    };
  }

  return {
    headline,
    errorPages,
    pageCount,
    cards: [
      card(
        namePages,
        'Text alternatives & names',
        'No missing names or alt text in this automated pass.',
        '{n} page(s) have missing names, labels, or text alternatives.'
      ),
      card(
        contrastPages,
        'Contrast & visual design',
        'No automated contrast failures on these pages.',
        '{n} page(s) fail automated contrast or related visual checks.'
      ),
      card(
        keyboardPages,
        'Keyboard & target size',
        'No automated keyboard or target-size failures on these pages.',
        '{n} page(s) have keyboard, focus, reflow, or target-size issues.'
      ),
    ],
  };
}

/**
 * Group fix-order items by POUR for the developer deliverable.
 * @param {Array<{ wcag?: string[], chapter?: string, id?: string, type?: string }>} fixOrderItems
 */
export function groupFixesByPrinciple(fixOrderItems) {
  const groups = Object.values(PRINCIPLE_META).map((meta) => ({
    ...meta,
    color: meta.hex,
    textColor: meta.hexText,
    issues: [],
  }));
  const byKey = Object.fromEntries(groups.map((g) => [g.key, g]));
  for (const item of fixOrderItems || []) {
    const wcag = Array.isArray(item.wcag) ? item.wcag : [];
    const key = principleForFinding({
      wcag,
      chapter: item.chapter,
      axeId: item.type === 'violation' ? item.id : undefined,
    });
    byKey[key].issues.push(item);
  }
  return groups;
}
