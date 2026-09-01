/**
 * Deterministic WCAG 2.2 A/AA coverage for a run: what automation attempted,
 * what the in-app manual checklist can cover, and what still needs a professional.
 */
import { getRemediation, wcagScUrl } from './remediation-data.js';
import { ALL_MANUAL_ITEMS } from './manual-checklist.js';
import { WCAG_22_AA_SC, WCAG_22_AA_COUNT, getWcagScLabel } from './wcag-sc-labels.js';
import { wcagFromAxeTags } from './report-buckets.js';

/** @typedef {'none' | 'presence' | 'partial'} AutoCapability */

/**
 * What this product's automation can do for each SC (not a WCAG-EM claim).
 * `customIds` are our chapter checks; axe coverage is inferred from tags on this run
 * plus typical axe WCAG rules when nothing fired.
 * @type {Record<string, { auto: AutoCapability, note: string, customIds: string[] }>}
 */
export const AUTO_COVERAGE = {
  '1.1.1': { auto: 'partial', note: 'Alt/name presence on images, SVG, canvas, maps — not whether text is meaningful.', customIds: ['img-alt', 'img-alt-length', 'svg-role', 'svg-accessible-name', 'canvas-alt', 'image-map-alt'] },
  '1.2.1': { auto: 'none', note: 'Transcript / audio description quality is not tested.', customIds: [] },
  '1.2.2': { auto: 'presence', note: 'Native <video> caption tracks only. YouTube/Vimeo is flagged for a human. Quality is not tested.', customIds: ['video-captions', 'embedded-media-captions'] },
  '1.2.3': { auto: 'none', note: 'Audio description or media alternative is not tested.', customIds: [] },
  '1.2.4': { auto: 'none', note: 'Live captions are not tested.', customIds: [] },
  '1.2.5': { auto: 'none', note: 'Prerecorded audio description is not tested.', customIds: [] },
  '1.3.1': { auto: 'partial', note: 'Landmarks, headings, tables, lists, and axe info/relationships rules. Programmatic relationships in custom widgets are often missed.', customIds: ['landmarks-present', 'single-main', 'heading-structure', 'heading-main-h1', 'table-headers', 'list-markup'] },
  '1.3.2': { auto: 'none', note: 'Meaningful reading order needs a human (and a screen reader).', customIds: [] },
  '1.3.3': { auto: 'none', note: 'Instructions that rely on shape, size, or location are not detected.', customIds: [] },
  '1.3.4': { auto: 'none', note: 'Orientation lock is not tested.', customIds: [] },
  '1.3.5': { auto: 'none', note: 'autocomplete / input purpose is not tested.', customIds: [] },
  '1.4.1': { auto: 'partial', note: 'Link-vs-body colour heuristic only. Most “colour alone” cases need a human.', customIds: ['link-differentiation'] },
  '1.4.2': { auto: 'partial', note: 'Flags autoplaying <audio>/<video>; does not prove a pause control exists.', customIds: ['audio-autoplay', 'video-autoplay'] },
  '1.4.3': { auto: 'partial', note: 'Custom contrast plus axe. Skipped on huge DOMs (info). Heuristic, not a full visual audit.', customIds: ['text-contrast', 'contrast-not-run'] },
  '1.4.4': { auto: 'presence', note: 'Checks the viewport allows zoom. Does not test 200% reflow.', customIds: ['viewport-zoom'] },
  '1.4.5': { auto: 'none', note: 'Images of text are not classified.', customIds: [] },
  '1.4.10': { auto: 'partial', note: '320px CSS overflow with a 10px tolerance. Does not prove two-dimensional scrolling is avoided everywhere.', customIds: ['no-horizontal-scroll'] },
  '1.4.11': { auto: 'partial', note: 'Non-text contrast heuristic plus axe; same limits as 1.4.3.', customIds: ['non-text-contrast', 'contrast-not-run'] },
  '1.4.12': { auto: 'none', note: 'Text spacing (user CSS) is not tested.', customIds: [] },
  '1.4.13': { auto: 'none', note: 'Hover/focus content dismiss and hoverable is not tested.', customIds: [] },
  '2.1.1': { auto: 'partial', note: 'Positive tabindex warning and axe keyboard-related rules. Does not tab through the page.', customIds: ['tabindex-positive'] },
  '2.1.2': { auto: 'none', note: 'Keyboard traps are not walked.', customIds: [] },
  '2.1.4': { auto: 'none', note: 'Single-character shortcuts are not detected.', customIds: [] },
  '2.2.1': { auto: 'none', note: 'Time limits are not tested.', customIds: [] },
  '2.2.2': { auto: 'presence', note: 'Meta refresh / auto-refresh heuristic. Moving content generally needs a human.', customIds: ['no-auto-refresh'] },
  '2.3.1': { auto: 'presence', note: 'Legacy Flash embed check only. Flashing content is not measured.', customIds: ['flash-alternative'] },
  '2.4.1': { auto: 'partial', note: 'Skip-link presence and landmarks. Bypass that is not a skip link may be missed.', customIds: ['skip-link', 'landmarks-present', 'single-main'] },
  '2.4.2': { auto: 'presence', note: 'Title element exists. Uniqueness and descriptiveness are not tested.', customIds: ['page-title-exists'] },
  '2.4.3': { auto: 'partial', note: 'Positive tabindex warning. DOM vs visual order is not tested.', customIds: ['tabindex-positive'] },
  '2.4.4': { auto: 'partial', note: '“Click here” / empty link heuristics. Purpose in context often needs a human.', customIds: ['link-text', 'link-meaningful'] },
  '2.4.5': { auto: 'none', note: 'Multiple ways to find pages is a site-level check.', customIds: [] },
  '2.4.6': { auto: 'partial', note: 'Heading outline heuristic. Whether headings describe the topic is not tested.', customIds: ['heading-structure', 'heading-main-h1'] },
  '2.4.7': { auto: 'partial', note: 'Focus-indicator heuristic. Visibility in all states needs a human.', customIds: ['focus-indicator'] },
  '2.4.11': { auto: 'none', note: 'Focus not obscured (sticky headers, cookie bars) is not tested.', customIds: [] },
  '2.5.1': { auto: 'none', note: 'Path-based gestures are not tested.', customIds: [] },
  '2.5.2': { auto: 'none', note: 'Pointer cancellation is not tested.', customIds: [] },
  '2.5.3': { auto: 'none', note: 'Label in name (visible text vs accessible name) is not tested here as a dedicated check.', customIds: [] },
  '2.5.4': { auto: 'none', note: 'Motion actuation is not tested.', customIds: [] },
  '2.5.7': { auto: 'none', note: 'Dragging movements are not tested.', customIds: [] },
  '2.5.8': { auto: 'partial', note: '24×24 CSS px warning. Listed exceptions (inline links, etc.) are not applied automatically.', customIds: ['touch-target-size'] },
  '3.1.1': { auto: 'presence', note: 'lang on <html>. Validity of the language code and language of parts are not tested.', customIds: ['html-lang'] },
  '3.1.2': { auto: 'none', note: 'Language of parts is not tested.', customIds: [] },
  '3.2.1': { auto: 'none', note: 'Context changes on focus are not tested.', customIds: [] },
  '3.2.2': { auto: 'none', note: 'Context changes on input are not tested.', customIds: [] },
  '3.2.3': { auto: 'none', note: 'Consistent navigation is a multi-page human check.', customIds: [] },
  '3.2.4': { auto: 'none', note: 'Consistent identification is a multi-page human check.', customIds: [] },
  '3.2.6': { auto: 'none', note: 'Consistent help is not tested.', customIds: [] },
  '3.3.1': { auto: 'none', note: 'Whether errors are identified in text is not tested automatically.', customIds: [] },
  '3.3.2': { auto: 'partial', note: 'Label / placeholder-as-label heuristics. Instructions quality is not tested.', customIds: ['form-labels', 'placeholder-not-only-label'] },
  '3.3.3': { auto: 'none', note: 'Error suggestions are not tested.', customIds: [] },
  '3.3.4': { auto: 'none', note: 'Error prevention for legal/financial data is not tested.', customIds: [] },
  '3.3.7': { auto: 'none', note: 'Redundant entry is not tested.', customIds: [] },
  '3.3.8': { auto: 'none', note: 'Accessible authentication is not tested.', customIds: [] },
  '4.1.1': { auto: 'partial', note: 'Duplicate ids and axe parsing-related rules. WCAG 2.2 marks 4.1.1 obsolete.', customIds: ['unique-ids'] },
  '4.1.2': { auto: 'partial', note: 'Names on controls, iframes, SVG; axe name/role/value. Custom widgets often need a human.', customIds: ['iframe-titles', 'svg-accessible-name', 'form-labels', 'link-text'] },
  '4.1.3': { auto: 'partial', note: 'aria-live / status-role heuristics. Correct announcement is not verified.', customIds: ['dynamic-announcements', 'dynamic-status-roles', 'dynamic-aria-busy'] },
};

function principleFromId(id) {
  const n = Number(String(id).split('.')[0]);
  if (n === 1) return 'perceivable';
  if (n === 2) return 'operable';
  if (n === 3) return 'understandable';
  return 'robust';
}

function manualItemsForSc(sc) {
  return ALL_MANUAL_ITEMS.filter((item) => Array.isArray(item.coversSc) && item.coversSc.includes(sc));
}

function wcagForCustomRow(row) {
  const rem = getRemediation(row.id, null);
  return Array.isArray(rem.wcag) ? rem.wcag.map(String) : [];
}

function wcagForAxeItem(item) {
  const rem = getRemediation(null, item.id);
  const fromRem = Array.isArray(rem.wcag) ? rem.wcag.map(String) : [];
  const fromTags = wcagFromAxeTags(item.tags);
  return [...new Set([...fromRem, ...fromTags])];
}

/**
 * Rank this-run status. Lower is worse / more important to show.
 * @param {string} status
 */
function statusRank(status) {
  switch (status) {
    case 'fail':
      return 0;
    case 'warn':
      return 1;
    case 'incomplete':
      return 2;
    case 'pass':
      return 3;
    case 'not-run':
      return 4;
    default:
      return 5;
  }
}

/**
 * @param {object} reportData
 * @param {string[]} [manualCheckedIds]
 */
export function buildWcagCoverage(reportData, manualCheckedIds = []) {
  const checkedSet = new Set(Array.isArray(manualCheckedIds) ? manualCheckedIds : []);
  /** @type {Map<string, { status: string, label: string }[]>} */
  const findingsBySc = new Map();

  function addFinding(sc, status, label) {
    if (!sc || !AUTO_COVERAGE[sc]) return;
    if (!findingsBySc.has(sc)) findingsBySc.set(sc, []);
    findingsBySc.get(sc).push({ status, label });
  }

  for (const row of reportData?.customResults || []) {
    const scs = wcagForCustomRow(row);
    const label = row.rule || row.id || 'custom check';
    let status = 'not-run';
    if (row.status === 'fail') status = 'fail';
    else if (row.status === 'warn') status = 'warn';
    else if (row.status === 'pass') status = 'pass';
    else if (row.status === 'info') status = 'incomplete';
    for (const sc of scs) addFinding(sc, status, label);
  }

  for (const data of Object.values(reportData?.axeResults || {})) {
    for (const v of data.violations || []) {
      const label = v.help || v.id || 'axe violation';
      for (const sc of wcagForAxeItem(v)) addFinding(sc, 'fail', label);
    }
    for (const v of data.incomplete || []) {
      const label = v.help || v.id || 'axe incomplete';
      for (const sc of wcagForAxeItem(v)) addFinding(sc, 'incomplete', label);
    }
    for (const v of data.passes || []) {
      const label = v.help || v.id || 'axe pass';
      for (const sc of wcagForAxeItem(v)) addFinding(sc, 'pass', label);
    }
  }

  const criteria = WCAG_22_AA_SC.map((row) => {
    const meta = AUTO_COVERAGE[row.id] || { auto: 'none', note: '', customIds: [] };
    const findings = findingsBySc.get(row.id) || [];
    let thisRun = 'not-run';
    for (const f of findings) {
      if (statusRank(f.status) < statusRank(thisRun)) thisRun = f.status;
    }
    const manuals = manualItemsForSc(row.id);
    const manualCanCover = manuals.length > 0;
    const manualChecked =
      manualCanCover && manuals.every((item) => checkedSet.has(item.id));
    const manualPartial =
      manualCanCover && !manualChecked && manuals.some((item) => checkedSet.has(item.id));
    const needsProfessional = meta.auto === 'none' && !manualCanCover;
    return {
      id: row.id,
      title: row.title,
      level: row.level,
      principle: principleFromId(row.id),
      auto: meta.auto,
      autoNote: meta.note,
      url: wcagScUrl(row.id),
      thisRun: meta.auto === 'none' && findings.length === 0 ? 'not-checked' : thisRun,
      findings: findings.slice(0, 8),
      manualCanCover,
      manualChecked,
      manualPartial,
      manualItems: manuals.map((item) => ({
        id: item.id,
        text: item.text,
        checked: checkedSet.has(item.id),
      })),
      needsProfessional,
    };
  });

  const autoAttempted = criteria.filter((c) => c.auto !== 'none');
  const autoNotChecked = criteria.filter((c) => c.auto === 'none');
  const manualCanCover = autoNotChecked.filter((c) => c.manualCanCover);
  const outsideChecklist = autoNotChecked.filter((c) => !c.manualCanCover);
  const autoFails = criteria.filter((c) => c.thisRun === 'fail' || c.thisRun === 'warn');

  return {
    standard: 'WCAG 2.2 Level A and AA',
    total: WCAG_22_AA_COUNT,
    pages: Array.isArray(reportData?.urls) ? reportData.urls.length : 0,
    counts: {
      autoAttempted: autoAttempted.length,
      autoNotChecked: autoNotChecked.length,
      manualCanCover: manualCanCover.length,
      manualFullyChecked: criteria.filter((c) => c.manualChecked).length,
      outsideProduct: outsideChecklist.length,
      autoFails: autoFails.length,
    },
    criteria,
    buckets: {
      autoAttempted: autoAttempted.map((c) => c.id),
      autoNotChecked: autoNotChecked.map((c) => c.id),
      manualCanCover: manualCanCover.map((c) => c.id),
      outsideProduct: outsideChecklist.map((c) => c.id),
      autoFails: autoFails.map((c) => c.id),
    },
  };
}

export function compactCoverageForPrompt(coverage) {
  return {
    standard: coverage.standard,
    total: coverage.total,
    pages: coverage.pages,
    counts: coverage.counts,
    autoAttempted: coverage.criteria
      .filter((c) => c.auto !== 'none')
      .map((c) => ({
        id: c.id,
        title: c.title,
        level: c.level,
        auto: c.auto,
        thisRun: c.thisRun,
        note: c.autoNote,
        findings: c.findings.map((f) => f.label).slice(0, 4),
      })),
    notAutomatedManualCanCover: coverage.criteria
      .filter((c) => c.auto === 'none' && c.manualCanCover)
      .map((c) => ({
        id: c.id,
        title: c.title,
        level: c.level,
        checked: c.manualChecked,
        items: c.manualItems.map((i) => ({ text: i.text, checked: i.checked })),
      })),
    outsideProduct: coverage.criteria
      .filter((c) => c.needsProfessional)
      .map((c) => ({ id: c.id, title: c.title, level: c.level })),
  };
}

export function buildStaticNarrative(coverage) {
  const { counts } = coverage;
  const failIds = coverage.buckets.autoFails
    .map((id) => {
      const { title, level } = getWcagScLabel(id);
      return `${id} ${title} (Level ${level})`;
    })
    .slice(0, 12);
  const manualIds = coverage.buckets.manualCanCover
    .map((id) => {
      const { title, level } = getWcagScLabel(id);
      return `${id} ${title} (Level ${level})`;
    });
  const outsideIds = coverage.buckets.outsideProduct
    .map((id) => {
      const { title, level } = getWcagScLabel(id);
      return `${id} ${title} (Level ${level})`;
    });

  const checked =
    `This run attempted automated checks that map to ${counts.autoAttempted} of ${counts.autoAttempted + counts.autoNotChecked} WCAG 2.2 Level A and AA success criteria (${coverage.total} in total). ` +
    `Automation is presence- or heuristic-based: a pass means the machine check did not fail, not that the criterion is met. ` +
    (failIds.length
      ? `On this run, automated fails or warnings still touch: ${failIds.join('; ')}.`
      : `On this run, no mapped success criterion showed an automated fail or warning. That is not a WCAG pass.`);

  const notChecked =
    `${counts.autoNotChecked} success criteria are not checked by this scanner. ` +
    `Examples include captions quality, keyboard traps, accessible authentication, and consistent navigation. ` +
    `axe-core and the custom chapters cannot see most of those.`;

  const manualCanCover =
    `Of those untested criteria, ${counts.manualCanCover} can be addressed with the in-app Manual checks (keyboard, screen reader, zoom, captions quality, meaningful names, and related items). ` +
    (manualIds.length ? `They include: ${manualIds.join('; ')}. ` : '') +
    `Ticking a box only counts if someone actually performed that test.`;

  const pathToConformance =
    `If automated findings are fixed and the manual and assistive-technology checks are done thoroughly — real keyboard, screen reader, and zoom testing, not just ticks — you will have covered both what this scanner can find and the human checks this product includes. ` +
    `That is the path this tool is designed for, and it is necessary for WCAG 2.2 AA. It is not sufficient on its own: ${counts.outsideProduct} success criteria remain outside this checklist` +
    (outsideIds.length ? ` (including ${outsideIds.slice(0, 8).join('; ')})` : '') +
    `. Completing the product well does not make the site fully compliant by itself.`;

  const disclaimer =
    `This is not an official WCAG 2.2 AA audit, not EN 301 549 certification, and not an EAA legal sign-off. ` +
    `Contact Us or another qualified accessibility professional for an official evaluation before you publish a conformance claim.`;

  return { checked, notChecked, manualCanCover, pathToConformance, disclaimer };
}
