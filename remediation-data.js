/**
 * WCAG Success Criteria mapping, remediation snippets, impact & effort.
 * Used by generate-report.js for developer-friendly fix guidance.
 */

const W3C_BASE = 'https://www.w3.org/WAI/WCAG22/Understanding/';

/** WCAG 2.1 Success Criterion ID -> W3C Understanding URL slug */
const SC_TO_SLUG = {
  '1.1.1': 'non-text-content',
  '1.2.1': 'audio-only-and-video-only-prerecorded',
  '1.2.2': 'captions-prerecorded',
  '1.2.3': 'audio-description-or-media-alternative-prerecorded',
  '1.2.4': 'captions-live',
  '1.2.5': 'audio-description-prerecorded',
  '1.3.1': 'info-and-relationships',
  '1.3.2': 'meaningful-sequence',
  '1.3.3': 'sensory-characteristics',
  '1.3.4': 'orientation',
  '1.3.5': 'identify-input-purpose',
  '1.4.1': 'use-of-color',
  '1.4.2': 'audio-control',
  '1.4.3': 'contrast-minimum',
  '1.4.4': 'resize-text',
  '1.4.5': 'images-of-text',
  '1.4.10': 'reflow',
  '1.4.11': 'non-text-contrast',
  '1.4.12': 'text-spacing',
  '1.4.13': 'content-on-hover-or-focus',
  '2.1.1': 'keyboard',
  '2.1.2': 'no-keyboard-trap',
  '2.1.4': 'character-key-shortcuts',
  '2.2.1': 'timing-adjustable',
  '2.2.2': 'pause-stop-hide',
  '2.3.1': 'three-flashes-or-below-threshold',
  '2.4.1': 'bypass-blocks',
  '2.4.2': 'page-titled',
  '2.4.3': 'focus-order',
  '2.4.4': 'link-purpose-in-context',
  '2.4.5': 'multiple-ways',
  '2.4.6': 'headings-and-labels',
  '2.4.7': 'focus-visible',
  '2.4.11': 'focus-not-obscured-minimum',
  '2.5.1': 'pointer-gestures',
  '2.5.2': 'pointer-cancellation',
  '2.5.3': 'label-in-name',
  '2.5.4': 'motion-actuation',
  '2.5.5': 'target-size',
  '2.5.7': 'dragging-movements',
  '2.5.8': 'target-size-minimum',
  '3.1.1': 'language-of-page',
  '3.1.2': 'language-of-parts',
  '3.2.1': 'on-focus',
  '3.2.2': 'on-input',
  '3.2.3': 'consistent-navigation',
  '3.2.4': 'consistent-identification',
  '3.2.6': 'consistent-help',
  '3.3.1': 'error-identification',
  '3.3.2': 'labels-or-instructions',
  '3.3.3': 'error-suggestion',
  '3.3.4': 'error-prevention-legal-financial-data',
  '3.3.7': 'redundant-entry',
  '3.3.8': 'accessible-authentication-minimum',
  '4.1.1': 'parsing',
  '4.1.2': 'name-role-value',
  '4.1.3': 'status-messages',
};

export function wcagScUrl(sc) {
  const slug = SC_TO_SLUG[sc];
  if (slug) return `${W3C_BASE}${slug}.html`;
  return 'https://www.w3.org/WAI/WCAG22/quickref/';
}

/**
 * Per check/rule: WCAG SCs, snippet, impact, effort.
 * impact: high | medium | low
 * effort: simple | moderate | complex
 */
export const REMEDIATION_MAP = {
  // Custom checks
  'page-title-exists': {
    wcag: ['2.4.2'],
    snippet: '<title>Descriptive page title – e.g. Home | Company Name</title>',
    impact: 'high',
    effort: 'simple',
  },
  'html-lang': {
    wcag: ['3.1.1'],
    snippet: '<html lang="en">',
    impact: 'high',
    effort: 'simple',
  },
  'landmarks-present': {
    wcag: ['1.3.1', '2.4.1'],
    snippet: '<main>, <nav>, <header>, <footer>, <aside>, or role="main", role="navigation", etc.',
    impact: 'medium',
    effort: 'moderate',
  },
  'single-main': {
    wcag: ['1.3.1', '2.4.1'],
    snippet: 'Use exactly one <main> or [role="main"] for primary content.',
    impact: 'medium',
    effort: 'simple',
  },
  'heading-structure': {
    wcag: ['1.3.1', '2.4.6'],
    snippet: 'Start with <h1>, then <h2>, <h3>… without skipping levels.',
    impact: 'medium',
    effort: 'moderate',
  },
  'heading-main-h1': {
    wcag: ['1.3.1', '2.4.6'],
    snippet: 'Use <h1> as the first heading inside <main> for the primary page topic.',
    impact: 'medium',
    effort: 'simple',
  },
  'link-text': {
    wcag: ['2.4.4', '4.1.2'],
    snippet: '<a href="...">Descriptive text</a> – avoid empty links or "click here".',
    impact: 'high',
    effort: 'simple',
  },
  'link-meaningful': {
    wcag: ['2.4.4'],
    snippet: 'Link text should describe the destination. Replace "click here" with e.g. "Download the guide".',
    impact: 'medium',
    effort: 'moderate',
  },
  'skip-link': {
    wcag: ['2.4.1'],
    snippet: '<a href="#main" class="skip-link">Skip to main content</a>',
    impact: 'high',
    effort: 'simple',
  },
  'table-headers': {
    wcag: ['1.3.1'],
    snippet: '<th scope="col">Header</th> or <th scope="row">Row label</th>',
    impact: 'high',
    effort: 'moderate',
  },
  'list-markup': {
    wcag: ['1.3.1'],
    snippet: '<ul><li>...</li></ul> or <ol><li>...</li></ol> for lists.',
    impact: 'medium',
    effort: 'simple',
  },
  'iframe-titles': {
    wcag: ['4.1.2'],
    snippet: '<iframe title="Description of iframe content" src="...">',
    impact: 'high',
    effort: 'simple',
  },
  'unique-ids': {
    wcag: ['4.1.1'],
    snippet: 'Ensure every id attribute is unique within the page.',
    impact: 'high',
    effort: 'moderate',
  },
  'img-alt': {
    wcag: ['1.1.1'],
    snippet: '<img src="photo.jpg" alt="Description of the image">',
    impact: 'high',
    effort: 'simple',
  },
  'img-alt-length': {
    wcag: ['1.1.1'],
    snippet: 'Keep alt concise (under ~125 chars). Use longdesc or surrounding text for long descriptions.',
    impact: 'medium',
    effort: 'simple',
  },
  'svg-role': {
    wcag: ['1.1.1', '4.1.2'],
    snippet: '<svg role="img" aria-labelledby="chart-title"> or role="presentation" for decorative.',
    impact: 'high',
    effort: 'simple',
  },
  'svg-accessible-name': {
    wcag: ['1.1.1'],
    snippet: '<svg aria-label="Chart showing..." > or <title> inside <svg>.',
    impact: 'high',
    effort: 'simple',
  },
  'canvas-alt': {
    wcag: ['1.1.1'],
    snippet: '<canvas id="c">…</canvas> + accessible alternative (text or link).',
    impact: 'high',
    effort: 'moderate',
  },
  'image-map-alt': {
    wcag: ['1.1.1'],
    snippet: '<area alt="Region description" shape="rect" coords="...">',
    impact: 'high',
    effort: 'moderate',
  },
  'link-differentiation': {
    wcag: ['1.4.1'],
    snippet: 'Don\'t rely on color alone. Add underline, icon, or text (e.g. "opens in new tab").',
    impact: 'medium',
    effort: 'simple',
  },
  'text-contrast': {
    wcag: ['1.4.3'],
    snippet: 'Increase foreground/background contrast to at least 4.5:1 (normal text) or 3:1 (large text).',
    impact: 'high',
    effort: 'moderate',
  },
  'non-text-contrast': {
    wcag: ['1.4.11'],
    snippet: 'Ensure visual UI indicators (borders, icons, outlines, focus rings) have at least 3:1 contrast against adjacent colors.',
    impact: 'high',
    effort: 'moderate',
  },
  'focus-indicator': {
    wcag: ['2.4.7'],
    snippet: ':focus { outline: 2px solid currentColor; outline-offset: 2px; }',
    impact: 'high',
    effort: 'simple',
  },
  'no-horizontal-scroll': {
    wcag: ['1.4.10'],
    snippet: 'Use max-width: 100%, overflow-wrap: break-word. Avoid fixed pixel widths.',
    impact: 'medium',
    effort: 'moderate',
  },
  'viewport-zoom': {
    wcag: ['1.4.4'],
    snippet: 'Ensure user-scalable=yes (or omit) in <meta name="viewport">.',
    impact: 'high',
    effort: 'simple',
  },
  'video-captions': {
    wcag: ['1.2.2'],
    snippet: '<track kind="captions" src="captions.vtt" srclang="en">',
    impact: 'high',
    effort: 'complex',
  },
  'video-autoplay': {
    wcag: ['1.4.2'],
    snippet: 'Don\'t autoplay with sound, or provide pause/mute controls.',
    impact: 'medium',
    effort: 'simple',
  },
  'audio-autoplay': {
    wcag: ['1.4.2'],
    snippet: 'Avoid autoplay. If needed, provide immediate pause control.',
    impact: 'medium',
    effort: 'simple',
  },
  'flash-alternative': {
    wcag: ['1.1.1'],
    snippet: 'Provide HTML alternative or ensure content is accessible without Flash.',
    impact: 'high',
    effort: 'complex',
  },
  'tabindex-positive': {
    wcag: ['2.4.3'],
    snippet: 'Remove tabindex > 0. Use natural DOM order or tabindex="0" for focusable widgets.',
    impact: 'high',
    effort: 'simple',
  },
  'touch-target-size': {
    wcag: ['2.5.8'],
    snippet: 'WCAG 2.2 AA 2.5.8: targets at least 24×24 CSS pixels (with listed exceptions). 44×44 is AAA 2.5.5 / platform guidance.',
    impact: 'medium',
    effort: 'moderate',
  },
  'form-labels': {
    wcag: ['3.3.2', '4.1.2'],
    snippet: '<label for="id">Label</label><input id="id"> or aria-label="Label"',
    impact: 'high',
    effort: 'simple',
  },
  'placeholder-not-only-label': {
    wcag: ['3.3.2'],
    snippet: 'Use <label> or aria-label. Placeholder is a hint, not a replacement.',
    impact: 'high',
    effort: 'simple',
  },
  'no-auto-refresh': {
    wcag: ['2.2.2'],
    snippet: 'Avoid auto-refresh. If required, allow user to extend time.',
    impact: 'medium',
    effort: 'moderate',
  },
  'dynamic-announcements': {
    wcag: ['4.1.3'],
    snippet: 'Use aria-live="polite" or aria-live="assertive" on live regions.',
    impact: 'high',
    effort: 'moderate',
  },
  'page-load': {
    wcag: [],
    snippet: 'Check URL, network, bot protection, and server availability.',
    impact: 'high',
    effort: 'complex',
  },
};

/** Common axe rule IDs -> remediation (axe provides helpUrl; we add SC, snippet, impact, effort) */
export const AXE_REMEDIATION = {
  'document-title': REMEDIATION_MAP['page-title-exists'],
  'html-has-lang': REMEDIATION_MAP['html-lang'],
  'image-alt': REMEDIATION_MAP['img-alt'],
  'label': REMEDIATION_MAP['form-labels'],
  'link-name': REMEDIATION_MAP['link-text'],
  'button-name': { wcag: ['2.1.1', '4.1.2'], snippet: '<button>Label</button> or aria-label="Label"', impact: 'high', effort: 'simple' },
  'color-contrast': { wcag: ['1.4.3'], snippet: 'Increase contrast to 4.5:1 (normal) or 3:1 (large). Use WebAIM contrast checker.', impact: 'high', effort: 'moderate' },
  'landmark-one-main': REMEDIATION_MAP['single-main'],
  'region': { wcag: ['1.3.1', '2.4.1'], snippet: 'Use landmarks: main, nav, header, footer, aside.', impact: 'medium', effort: 'moderate' },
  'landmark-unique': { wcag: ['1.3.1'], snippet: 'Give landmarks unique aria-label if multiple of same type.', impact: 'medium', effort: 'simple' },
  'frame-title': REMEDIATION_MAP['iframe-titles'],
  'duplicate-id': REMEDIATION_MAP['unique-ids'],
  'heading-order': REMEDIATION_MAP['heading-structure'],
  'list': REMEDIATION_MAP['list-markup'],
  'tabindex': REMEDIATION_MAP['tabindex-positive'],
  'focus-order-semantics': { wcag: ['2.4.3'], snippet: 'Ensure DOM order matches visual order. Avoid positive tabindex.', impact: 'medium', effort: 'moderate' },
  'meta-viewport': REMEDIATION_MAP['viewport-zoom'],
  'aria-valid-attr': { wcag: ['4.1.2'], snippet: 'Use only valid ARIA attributes. See MDN ARIA reference.', impact: 'high', effort: 'simple' },
  'aria-valid-attr-value': { wcag: ['4.1.2'], snippet: 'Ensure ARIA attribute values are valid (e.g. aria-expanded="true" or "false").', impact: 'high', effort: 'simple' },
  'aria-required-attr': { wcag: ['4.1.2'], snippet: 'Add all required ARIA attributes for the role (e.g. combobox needs aria-expanded).', impact: 'high', effort: 'moderate' },
  'input-button-name': REMEDIATION_MAP['form-labels'],
  'form-field-multiple-labels': { wcag: ['3.3.2'], snippet: 'Each form control should have one associated label.', impact: 'medium', effort: 'simple' },
};

/** Priority order: impact (high first) then effort (simple first) */
export const IMPACT_ORDER = { high: 0, medium: 1, low: 2 };
export const EFFORT_ORDER = { simple: 0, moderate: 1, complex: 2 };

export function getRemediation(checkId, axeRuleId) {
  return REMEDIATION_MAP[checkId] || AXE_REMEDIATION[axeRuleId] || {
    wcag: [],
    snippet: 'Review the issue and apply appropriate fix. See W3C WCAG guidelines.',
    impact: 'medium',
    effort: 'moderate',
  };
}

export function fixOrderScore(item) {
  const imp = IMPACT_ORDER[item.impact] ?? 1;
  const eff = EFFORT_ORDER[item.effort] ?? 1;
  return imp * 10 + eff;
}
