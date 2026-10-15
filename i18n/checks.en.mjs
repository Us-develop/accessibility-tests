/**
 * Titles and messages of our own checks, in English. The scanner writes them in
 * the language of the scan (WCAG_SCAN_LANG); a report keeps that language.
 * Keep keys and {placeholders} identical to checks.nl.mjs.
 */
export default {
  // ── Structure and semantics ───────────────────────────────────────
  'chk.page-title-exists.rule': 'Page MUST have a title with text',
  'chk.page-title-exists.found': 'Title: "{title}"',
  'chk.page-title-exists.missing': 'Page has no title',
  'chk.html-lang.rule': 'Primary language MUST be identified on html element',
  'chk.html-lang.found': 'lang="{lang}"',
  'chk.html-lang.missing': 'Missing or empty lang attribute on <html>',
  'chk.landmarks-present.rule': 'Landmarks SHOULD be used for layout (main, nav, header, footer, etc.)',
  'chk.landmarks-present.count': 'Found {n} landmark element(s)',
  'chk.single-main.rule': 'Page SHOULD have only one main landmark',
  'chk.single-main.count': 'Found {n} main landmark(s)',
  'chk.heading-structure.rule':
    'At least one h1 SHOULD exist; heading levels SHOULD NOT skip (e.g. h1 → h3)',
  'chk.heading-structure.summary': 'Headings: {total} total, {h1} h1(s), {skips} level skip(s)',
  'chk.heading-main-h1.rule': 'First heading inside <main> SHOULD be h1 when headings are used there',
  'chk.heading-main-h1.yes': 'First heading in main is h1',
  'chk.heading-main-h1.no': 'First heading in main is not h1',
  'chk.link-text.rule': 'Links MUST have programmatically-discernible text',
  'chk.link-text.empty': '{n} link(s) with no accessible text',
  'chk.link-text.checked': '{n} links checked',
  'chk.link-meaningful.rule': 'Link purpose SHOULD be determinable from link text alone',
  'chk.link-meaningful.generic': '{n} link(s) with generic text (e.g. "click here")',
  'chk.skip-link.rule': 'Skip link SHOULD be provided for keyboard users',
  'chk.skip-link.found': 'Skip link found',
  'chk.skip-link.missing': 'No skip link detected',
  'chk.table-headers.rule': 'Data tables MUST have header cells (th)',
  'chk.table-headers.missing': '{n} table(s) without th',
  'chk.table-headers.ok': 'All tables have headers',
  'chk.list-markup.rule': 'Lists MUST use semantic markup (ul/ol)',
  'chk.list-markup.orphans': '{n} orphan li element(s) found',
  'chk.iframe-titles.rule': 'Iframes MUST have non-empty title attribute',
  'chk.iframe-titles.missing': '{n} iframe(s) without title',
  'chk.iframe-titles.ok': 'All iframes have titles',
  'chk.unique-ids.rule': 'IDs MUST be unique within the page',
  'chk.unique-ids.duplicates': 'Duplicate IDs: {ids}',

  // ── Images and non-text content ───────────────────────────────────
  'chk.img-alt.rule': 'Informative images MUST have programmatically-discernible alternative text',
  'chk.img-alt.missing': '{n} image(s) missing alt attribute',
  'chk.img-alt.ok': '{n} images have alt text',
  'chk.img-alt-length.rule': 'Alternative text SHOULD be concise (≤250 characters)',
  'chk.img-alt-length.long': '{n} image(s) with alt > 250 chars',
  'chk.svg-role.rule': 'SVG elements SHOULD have role="img"',
  'chk.svg-role.missing': '{n} SVG(s) without role="img"',
  'chk.svg-role.ok': 'All SVGs have role',
  'chk.svg-accessible-name.rule': 'Informative/actionable SVGs MUST have meaningful alternative text',
  'chk.svg-accessible-name.missing': '{n} SVG(s) without accessible name',
  'chk.svg-accessible-name.ok': 'All SVGs have accessible names',
  'chk.canvas-alt.rule': 'Canvas elements MUST have role="img" and text alternative',
  'chk.canvas-alt.missing': '{n} canvas element(s) need role and alternative text',
  'chk.canvas-alt.ok': 'All canvases have role and alt',
  'chk.image-map-alt.rule': 'Image map areas MUST have alternative text',
  'chk.image-map-alt.missing': '{n} area(s) in image map without alt',

  // ── Contrast and visual design ────────────────────────────────────
  'chk.text-contrast.rule': 'Text contrast MUST meet 4.5:1 (normal) or 3:1 (large text)',
  'chk.text-contrast.fail':
    'Heuristic (solid-background approximation; axe also reports WCAG 1.4.3): {n} text element(s) below minimum contrast{lowest} across {checked} checked element(s)',
  'chk.text-contrast.lowest': ' (lowest: {ratio}:1)',
  'chk.text-contrast.ok': 'No low-contrast text found in {checked} checked element(s)',
  'chk.non-text-contrast.rule':
    'Visual UI indicators MUST meet 3:1 contrast (borders, outlines, control boundaries)',
  'chk.non-text-contrast.fail':
    'Heuristic (solid-background approximation; axe also reports WCAG 1.4.11): {n} low-contrast UI indicator(s) across {checked} checked border/outline indicator(s)',
  'chk.non-text-contrast.ok':
    'No low-contrast UI indicators found in {checked} checked border/outline indicator(s)',
  'chk.contrast-checks-disabled.rule': 'Contrast checks execution',
  'chk.contrast-checks-disabled.skipped':
    'Skipped text and non-text contrast checks because ENABLE_CONTRAST_CHECKS=false',
  'chk.link-differentiation.rule':
    'Links MUST not rely on color alone; provide underline/outline on hover/focus',
  'chk.link-differentiation.colorOnly': '{n} link(s) may rely on color only (no underline/border)',
  'chk.focus-indicator.rule': 'Focusable elements MUST have visible focus indicator (axe covers contrast)',
  'chk.focus-indicator.verify': '{n} focusable elements - verify focus styles in axe results',

  // ── Responsive ────────────────────────────────────────────────────
  'chk.no-horizontal-scroll.rule':
    'Content MUST NOT require horizontal scrolling at 320px width (simplified check; not a full WCAG 1.4.10 assessment)',
  'chk.no-horizontal-scroll.overflow':
    'Horizontal overflow: content {docWidth}px vs viewport {viewWidth}px (more than 10px)',
  'chk.no-horizontal-scroll.ok': 'No meaningful horizontal overflow at 320px',
  'chk.viewport-zoom.rule': 'Page MUST allow users to zoom on mobile (no user-scalable=no)',
  'chk.viewport-zoom.ok': 'Viewport allows zoom',
  'chk.viewport-zoom.restricted': 'Viewport may restrict zoom: {content}',
  'chk.viewport-zoom.missing': 'No viewport meta tag',

  // ── Multimedia ────────────────────────────────────────────────────
  'chk.video-captions.rule': 'Prerecorded video MUST include synchronized captions',
  'chk.video-captions.missing':
    '{n} video(s) without a caption track. This tool cannot tell whether captions are burned into the video or whether the video has no speech, so check by hand.',
  'chk.video-captions.ok': 'All videos have caption tracks',
  'chk.video-autoplay.rule': 'Auto-play video (>5s) MUST have pause/stop mechanism',
  'chk.video-autoplay.found': '{n} video(s) with autoplay - verify pause control exists',
  'chk.audio-autoplay.rule': 'Audio auto-playing >3s MUST have stop/pause/mute control',
  'chk.audio-autoplay.found': '{n} audio element(s) with autoplay',
  'chk.flash-alternative.rule': 'Flash/Silverlight SHOULD have HTML alternative',
  'chk.flash-alternative.found': '{n} Flash/plugin object(s) found - ensure accessible alternative',
  'chk.embedded-media-captions.rule':
    'Embedded video players must be checked manually for captions (WCAG 1.2.2)',
  'chk.embedded-media-captions.found':
    'Found {n} YouTube/Vimeo/other embed(s). Native <track> checks do not apply; a human must verify captions.',

  // ── Keyboard and pointer ──────────────────────────────────────────
  'chk.tabindex-positive.rule': 'tabindex with positive values SHOULD NOT be used',
  'chk.tabindex-positive.found': '{n} element(s) with positive tabindex',
  'chk.tabindex-positive.ok': 'No positive tabindex values',
  'chk.touch-target-size.rule': 'Pointer targets SHOULD be at least 24×24 CSS pixels (WCAG 2.2 AA 2.5.8)',
  'chk.touch-target-size.small':
    '{n} interactive element(s) below 24×24px (exceptions such as inline links are not applied automatically)',
  'chk.touch-target-size-enhanced.rule':
    'Targets below 44×44 CSS pixels (AAA 2.5.5 / platform guidance) — not an AA fail',
  'chk.touch-target-size-enhanced.between': '{n} interactive element(s) are between 24px and 44px',

  // ── Forms ─────────────────────────────────────────────────────────
  'chk.form-labels.rule': 'Form inputs MUST have programmatically-associated labels',
  'chk.form-labels.missing': '{n} input(s) without proper label',
  'chk.form-labels.ok': 'All inputs have labels',
  'chk.placeholder-not-only-label.rule': 'Placeholder MUST NOT be the only label for inputs',
  'chk.placeholder-not-only-label.found': '{n} input(s) use a placeholder as their only label',
  'chk.placeholder-not-only-label.ok': 'No placeholder-only labels',

  // ── Dynamic content ───────────────────────────────────────────────
  'chk.no-auto-refresh.rule': 'Page MUST NOT refresh or reload automatically',
  'chk.no-auto-refresh.found': 'Meta refresh found - may auto-reload page',
  'chk.no-auto-refresh.ok': 'No meta refresh',
  'chk.dynamic-announcements.rule': 'Dynamic content changes SHOULD be announced (aria-live, etc.)',
  'chk.dynamic-announcements.count': 'Found {n} aria-live region(s) - verify status messages are announced',
  'chk.dynamic-status-roles.rule':
    'Status and alert regions (role=status / role=alert) — verify messages for users',
  'chk.dynamic-status-roles.found':
    'Found {n} element(s) with role="status" or role="alert" — confirm important updates are communicated',
  'chk.dynamic-status-roles.none':
    'No role="status" or role="alert" regions found (not required on every page)',
  'chk.dynamic-aria-busy.rule':
    'Loading state (aria-busy) — verify assistive tech users get appropriate feedback',
  'chk.dynamic-aria-busy.found':
    'Found {n} element(s) with aria-busy="true" — ensure content updates are announced when loading finishes',
  'chk.dynamic-aria-busy.none':
    'No aria-busy="true" while testing initial load (SPA loading states may appear after interaction)',
  'chk.spa-may-be-unrendered.rule':
    'Page looks client-rendered; automated checks may have missed in-app content',
  'chk.spa-may-be-unrendered.found':
    'SPA root detected with only {n} characters of text at scan time. Enable WAIT_FOR_NETWORKIDLE or test URLs after hydration. This chapter cannot certify dynamic updates.',

  // ── Scanner ───────────────────────────────────────────────────────
  'chk.chapter-error.rule': '{chapter} checks',
  'chk.chapter-error.missing':
    'These checks could not be completed on this page, so their results are missing.',
  'chk.large-dom.rule': 'Custom contrast checks skipped on a large DOM',
  'chk.large-dom.skipped':
    'This page has {n} nodes. Custom contrast was skipped to avoid timeouts; axe WCAG contrast rules still ran.',
  'chk.page-load.rule': 'Page load',
  'chk.needs-review.suffix': ' (needs review)',
  'chk.page-load.deadline': 'This page did not finish within {seconds} seconds and was stopped.',

  // ── Fix guidance (shown with a finding) ───────────────────────────
  'fix.page-title-exists': '<title>Descriptive page title – e.g. Home | Company Name</title>',
  'fix.html-lang': '<html lang="en">',
  'fix.landmarks-present':
    '<main>, <nav>, <header>, <footer>, <aside>, or role="main", role="navigation", etc.',
  'fix.single-main': 'Use exactly one <main> or [role="main"] for primary content.',
  'fix.heading-structure': 'Start with <h1>, then <h2>, <h3>… without skipping levels.',
  'fix.heading-main-h1': 'Use <h1> as the first heading inside <main> for the primary page topic.',
  'fix.link-text': '<a href="...">Descriptive text</a> – avoid empty links or "click here".',
  'fix.link-meaningful':
    'Link text should describe the destination. Replace "click here" with e.g. "Download the guide".',
  'fix.skip-link': '<a href="#main" class="skip-link">Skip to main content</a>',
  'fix.table-headers': '<th scope="col">Header</th> or <th scope="row">Row label</th>',
  'fix.list-markup': '<ul><li>...</li></ul> or <ol><li>...</li></ol> for lists.',
  'fix.iframe-titles': '<iframe title="Description of iframe content" src="...">',
  'fix.unique-ids':
    'Ensure every id attribute is unique within the page, above all ids that labels or ARIA attributes point to.',
  'fix.img-alt': '<img src="photo.jpg" alt="Description of the image">',
  'fix.img-alt-length':
    'Keep alt concise (under ~125 chars). Use longdesc or surrounding text for long descriptions.',
  'fix.svg-role': '<svg role="img" aria-labelledby="chart-title"> or role="presentation" for decorative.',
  'fix.svg-accessible-name': '<svg aria-label="Chart showing..." > or <title> inside <svg>.',
  'fix.canvas-alt': '<canvas id="c">…</canvas> + accessible alternative (text or link).',
  'fix.image-map-alt': '<area alt="Region description" shape="rect" coords="...">',
  'fix.link-differentiation':
    'Don\'t rely on color alone. Add underline, icon, or text (e.g. "opens in new tab").',
  'fix.text-contrast':
    'Increase foreground/background contrast to at least 4.5:1 (normal text) or 3:1 (large text).',
  'fix.non-text-contrast':
    'Ensure visual UI indicators (borders, icons, outlines, focus rings) have at least 3:1 contrast against adjacent colors.',
  'fix.focus-indicator': ':focus { outline: 2px solid currentColor; outline-offset: 2px; }',
  'fix.no-horizontal-scroll': 'Use max-width: 100%, overflow-wrap: break-word. Avoid fixed pixel widths.',
  'fix.viewport-zoom': 'Ensure user-scalable=yes (or omit) in <meta name="viewport">.',
  'fix.video-captions': '<track kind="captions" src="captions.vtt" srclang="en">',
  'fix.video-autoplay': 'Don\'t autoplay with sound, or provide pause/mute controls.',
  'fix.audio-autoplay': 'Avoid autoplay. If needed, provide immediate pause control.',
  'fix.flash-alternative': 'Provide HTML alternative or ensure content is accessible without Flash.',
  'fix.tabindex-positive':
    'Remove tabindex > 0. Use natural DOM order or tabindex="0" for focusable widgets.',
  'fix.touch-target-size':
    'WCAG 2.2 AA 2.5.8: targets at least 24×24 CSS pixels (with listed exceptions). 44×44 is AAA 2.5.5 / platform guidance.',
  'fix.form-labels': '<label for="id">Label</label><input id="id"> or aria-label="Label"',
  'fix.placeholder-not-only-label': 'Use <label> or aria-label. Placeholder is a hint, not a replacement.',
  'fix.no-auto-refresh': 'Avoid auto-refresh. If required, allow user to extend time.',
  'fix.dynamic-announcements': 'Use aria-live="polite" or aria-live="assertive" on live regions.',
  'fix.page-load': 'Check URL, network, bot protection, and server availability.',
  'fix.axe.button-name': '<button>Label</button> or aria-label="Label"',
  'fix.axe.color-contrast':
    'Increase contrast to 4.5:1 (normal) or 3:1 (large). Use WebAIM contrast checker.',
  'fix.axe.region': 'Use landmarks: main, nav, header, footer, aside.',
  'fix.axe.landmark-unique': 'Give landmarks unique aria-label if multiple of same type.',
  'fix.axe.focus-order-semantics': 'Ensure DOM order matches visual order. Avoid positive tabindex.',
  'fix.axe.aria-valid-attr': 'Use only valid ARIA attributes. See MDN ARIA reference.',
  'fix.axe.aria-valid-attr-value':
    'Ensure ARIA attribute values are valid (e.g. aria-expanded="true" or "false").',
  'fix.axe.aria-required-attr':
    'Add all required ARIA attributes for the role (e.g. combobox needs aria-expanded).',
  'fix.axe.form-field-multiple-labels': 'Each form control should have one associated label.',
  'fix.default': 'Review the issue and apply appropriate fix. See W3C WCAG guidelines.',
};
