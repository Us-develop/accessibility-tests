/**
 * WCAG 2.x success criterion short titles and conformance levels (for accessibility statement headings).
 */

export const WCAG_SC_LABEL = {
  '1.1.1': { title: 'Non-text Content', level: 'A' },
  '1.2.2': { title: 'Captions (Prerecorded)', level: 'A' },
  '1.3.1': { title: 'Info and Relationships', level: 'A' },
  '1.3.2': { title: 'Meaningful Sequence', level: 'A' },
  '1.4.1': { title: 'Use of Color', level: 'A' },
  '1.4.2': { title: 'Audio Control', level: 'A' },
  '1.4.3': { title: 'Contrast (Minimum)', level: 'AA' },
  '1.4.4': { title: 'Resize Text', level: 'AA' },
  '1.4.10': { title: 'Reflow', level: 'AA' },
  '1.4.11': { title: 'Non-text Contrast', level: 'AA' },
  '1.4.12': { title: 'Text Spacing', level: 'AA' },
  '2.1.1': { title: 'Keyboard', level: 'A' },
  '2.1.2': { title: 'No Keyboard Trap', level: 'A' },
  '2.2.2': { title: 'Pause, Stop, Hide', level: 'A' },
  '2.4.1': { title: 'Bypass Blocks', level: 'A' },
  '2.4.2': { title: 'Page Titled', level: 'A' },
  '2.4.3': { title: 'Focus Order', level: 'A' },
  '2.4.4': { title: 'Link Purpose (In Context)', level: 'A' },
  '2.4.6': { title: 'Headings and Labels', level: 'AA' },
  '2.4.7': { title: 'Focus Visible', level: 'AA' },
  '2.5.5': { title: 'Target Size (Enhanced)', level: 'AAA' },
  '3.1.1': { title: 'Language of Page', level: 'A' },
  '3.2.2': { title: 'On Input', level: 'A' },
  '3.3.1': { title: 'Error Identification', level: 'A' },
  '3.3.2': { title: 'Labels or Instructions', level: 'A' },
  '4.1.1': { title: 'Parsing', level: 'A' },
  '4.1.2': { title: 'Name, Role, Value', level: 'A' },
  '4.1.3': { title: 'Status Messages', level: 'AA' },
};

export function getWcagScLabel(sc) {
  if (!sc || sc === '_other') {
    return { title: 'Other findings', level: '—' };
  }
  const row = WCAG_SC_LABEL[sc];
  if (row) return { title: row.title, level: row.level };
  return { title: `Success Criterion ${sc}`, level: 'AA' };
}

/** Sort keys like 1.3.1, 2.1.1, 10.2.3 */
export function compareScIds(a, b) {
  if (a === '_other') return 1;
  if (b === '_other') return -1;
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
