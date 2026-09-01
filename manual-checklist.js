/**
 * Shared catalogue of human-driven WCAG checks. These are intentionally NOT part
 * of the automated score; they live in their own "Manual checks" surface and
 * persist user-confirmed completion via /api/report/:domain/:runId/manual-progress.
 *
 * Each item carries a stable slug `id` so progress can be keyed by id rather
 * than array index. Older saved progress files that contain numeric indices
 * are migrated on the next write (see server/create-app.mjs).
 */

/**
 * @typedef {{ id: string, text: string, disabilities: string[] }} ManualItem
 */

/** Generate a stable, URL-safe id from the item text. */
function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

const MANUAL_VERIFICATION_TEXTS = [
  { text: 'Page title is unique and describes the page or result of the user action.', disabilities: ['Blindness', 'Low Vision', 'Reading Disabilities', 'Cognitive Disabilities'] },
  { text: 'Link purpose can be determined from the link text alone (no "click here").', disabilities: ['Blindness', 'Low Vision', 'Reading Disabilities', 'Cognitive Disabilities'] },
  { text: 'Alternative text is meaningful and concise, not just present.', disabilities: ['Blindness', 'Low Vision', 'Deafblindness'] },
  { text: 'Color contrast meets 4.5:1 for normal text, 3:1 for large text and UI.', disabilities: ['Low Vision', 'Colorblindness'] },
  { text: 'Information is not conveyed by color alone.', disabilities: ['Colorblindness', 'Low Vision'] },
  { text: 'Focus order is logical and matches visual order; no positive tabindex.', disabilities: ['Blindness', 'Dexterity/Motor Disabilities'] },
  { text: 'All interactive elements are keyboard accessible and have visible focus.', disabilities: ['Blindness', 'Dexterity/Motor Disabilities', 'Low Vision'] },
  { text: 'Pointer targets are at least 24×24 CSS pixels (WCAG 2.2 AA 2.5.8), allowing listed exceptions such as inline links. 44×44 is AAA 2.5.5, not the AA bar.', disabilities: ['Dexterity/Motor Disabilities', 'Low Vision'] },
  { text: 'Form error messages are associated with fields and announced to screen readers.', disabilities: ['Blindness', 'Cognitive Disabilities', 'Reading Disabilities'] },
  { text: 'Dynamic content changes are announced (e.g. aria-live) where appropriate.', disabilities: ['Blindness', 'Cognitive Disabilities'] },
  { text: 'No content flashes more than 3 times per second (seizure risk).', disabilities: ['Seizure Disorders'] },
  { text: 'Video has captions and, if needed, audio description; audio has transcript.', disabilities: ['Deafness and Hard-of-Hearing', 'Deafblindness'] },
  { text: 'Motion/animation can be paused or disabled (e.g. prefers-reduced-motion).', disabilities: ['Cognitive Disabilities'] },
];

const ASSISTIVE_TECH_TEXTS = [
  { text: 'Screen reader (NVDA, JAWS, or VoiceOver): Navigate by headings and landmarks; all content reachable.', disabilities: ['Blindness', 'Low Vision'] },
  { text: 'Screen reader: Form fields have announced labels and errors; buttons/links have clear names.', disabilities: ['Blindness', 'Low Vision'] },
  { text: 'Screen reader: No unexpected context changes on focus; dynamic updates are announced.', disabilities: ['Blindness', 'Cognitive Disabilities'] },
  { text: 'Keyboard only: Tab through every interactive element; no keyboard traps.', disabilities: ['Blindness', 'Dexterity/Motor Disabilities'] },
  { text: 'Keyboard only: Focus order matches visual order; focus is always visible.', disabilities: ['Blindness', 'Dexterity/Motor Disabilities', 'Low Vision'] },
  { text: 'Keyboard only: All actions (menus, modals, carousels) work with keyboard alone.', disabilities: ['Blindness', 'Dexterity/Motor Disabilities'] },
  { text: 'Zoom: At 200% zoom, content reflows; no horizontal scrolling; text still readable.', disabilities: ['Low Vision'] },
  { text: 'Zoom: No content clipped or overlapping at 200%.', disabilities: ['Low Vision'] },
  { text: 'Reduce motion: Animations respect prefers-reduced-motion or can be paused.', disabilities: ['Cognitive Disabilities'] },
  { text: 'Mobile/touch: All features work with touch; targets are large enough; no gesture-only actions.', disabilities: ['Dexterity/Motor Disabilities', 'Low Vision'] },
];

/** @type {ManualItem[]} */
export const MANUAL_VERIFICATION_ITEMS = MANUAL_VERIFICATION_TEXTS.map((it) => ({
  id: `manual-${slugify(it.text)}`,
  ...it,
}));

/** @type {ManualItem[]} */
export const ASSISTIVE_TECH_ITEMS = ASSISTIVE_TECH_TEXTS.map((it) => ({
  id: `at-${slugify(it.text)}`,
  ...it,
}));

/** All items in display order, used to migrate legacy index-based progress. */
export const ALL_MANUAL_ITEMS = [...MANUAL_VERIFICATION_ITEMS, ...ASSISTIVE_TECH_ITEMS];

export const MANUAL_TODO_GROUPS = [
  { label: 'Manual verification', items: MANUAL_VERIFICATION_ITEMS },
  { label: 'Assistive technology & manual testing', items: ASSISTIVE_TECH_ITEMS },
];

/**
 * Convert any saved progress payload (legacy numeric indices OR new id strings)
 * to a normalized array of item ids. Drops anything we no longer recognise.
 */
export function normalizeManualProgress(checked) {
  if (!Array.isArray(checked)) return [];
  const ids = new Set(ALL_MANUAL_ITEMS.map((it) => it.id));
  const out = new Set();
  for (const entry of checked) {
    if (typeof entry === 'string' && ids.has(entry)) {
      out.add(entry);
    } else if (typeof entry === 'number' && entry >= 0 && entry < ALL_MANUAL_ITEMS.length) {
      out.add(ALL_MANUAL_ITEMS[entry].id);
    }
  }
  return [...out];
}
