/**
 * WCAG 2.2 Level A and AA success criteria (56). Used for statement headings
 * and the coverage matrix. AAA 2.5.5 is included only as a label for info checks.
 */

/** @typedef {{ title: string, level: 'A' | 'AA' | 'AAA' }} WcagScMeta */

/** WCAG 2.2 A + AA in spec order. */
export const WCAG_22_AA_SC = [
  { id: '1.1.1', title: 'Non-text Content', level: 'A' },
  { id: '1.2.1', title: 'Audio-only and Video-only (Prerecorded)', level: 'A' },
  { id: '1.2.2', title: 'Captions (Prerecorded)', level: 'A' },
  { id: '1.2.3', title: 'Audio Description or Media Alternative (Prerecorded)', level: 'A' },
  { id: '1.2.4', title: 'Captions (Live)', level: 'AA' },
  { id: '1.2.5', title: 'Audio Description (Prerecorded)', level: 'AA' },
  { id: '1.3.1', title: 'Info and Relationships', level: 'A' },
  { id: '1.3.2', title: 'Meaningful Sequence', level: 'A' },
  { id: '1.3.3', title: 'Sensory Characteristics', level: 'A' },
  { id: '1.3.4', title: 'Orientation', level: 'AA' },
  { id: '1.3.5', title: 'Identify Input Purpose', level: 'AA' },
  { id: '1.4.1', title: 'Use of Color', level: 'A' },
  { id: '1.4.2', title: 'Audio Control', level: 'A' },
  { id: '1.4.3', title: 'Contrast (Minimum)', level: 'AA' },
  { id: '1.4.4', title: 'Resize Text', level: 'AA' },
  { id: '1.4.5', title: 'Images of Text', level: 'AA' },
  { id: '1.4.10', title: 'Reflow', level: 'AA' },
  { id: '1.4.11', title: 'Non-text Contrast', level: 'AA' },
  { id: '1.4.12', title: 'Text Spacing', level: 'AA' },
  { id: '1.4.13', title: 'Content on Hover or Focus', level: 'AA' },
  { id: '2.1.1', title: 'Keyboard', level: 'A' },
  { id: '2.1.2', title: 'No Keyboard Trap', level: 'A' },
  { id: '2.1.4', title: 'Character Key Shortcuts', level: 'A' },
  { id: '2.2.1', title: 'Timing Adjustable', level: 'A' },
  { id: '2.2.2', title: 'Pause, Stop, Hide', level: 'A' },
  { id: '2.3.1', title: 'Three Flashes or Below Threshold', level: 'A' },
  { id: '2.4.1', title: 'Bypass Blocks', level: 'A' },
  { id: '2.4.2', title: 'Page Titled', level: 'A' },
  { id: '2.4.3', title: 'Focus Order', level: 'A' },
  { id: '2.4.4', title: 'Link Purpose (In Context)', level: 'A' },
  { id: '2.4.5', title: 'Multiple Ways', level: 'AA' },
  { id: '2.4.6', title: 'Headings and Labels', level: 'AA' },
  { id: '2.4.7', title: 'Focus Visible', level: 'AA' },
  { id: '2.4.11', title: 'Focus Not Obscured (Minimum)', level: 'AA' },
  { id: '2.5.1', title: 'Pointer Gestures', level: 'A' },
  { id: '2.5.2', title: 'Pointer Cancellation', level: 'A' },
  { id: '2.5.3', title: 'Label in Name', level: 'A' },
  { id: '2.5.4', title: 'Motion Actuation', level: 'A' },
  { id: '2.5.7', title: 'Dragging Movements', level: 'AA' },
  { id: '2.5.8', title: 'Target Size (Minimum)', level: 'AA' },
  { id: '3.1.1', title: 'Language of Page', level: 'A' },
  { id: '3.1.2', title: 'Language of Parts', level: 'AA' },
  { id: '3.2.1', title: 'On Focus', level: 'A' },
  { id: '3.2.2', title: 'On Input', level: 'A' },
  { id: '3.2.3', title: 'Consistent Navigation', level: 'AA' },
  { id: '3.2.4', title: 'Consistent Identification', level: 'AA' },
  { id: '3.2.6', title: 'Consistent Help', level: 'A' },
  { id: '3.3.1', title: 'Error Identification', level: 'A' },
  { id: '3.3.2', title: 'Labels or Instructions', level: 'A' },
  { id: '3.3.3', title: 'Error Suggestion', level: 'AA' },
  { id: '3.3.4', title: 'Error Prevention (Legal, Financial, Data)', level: 'AA' },
  { id: '3.3.7', title: 'Redundant Entry', level: 'A' },
  { id: '3.3.8', title: 'Accessible Authentication (Minimum)', level: 'AA' },
  { id: '4.1.1', title: 'Parsing (Obsolete and removed)', level: 'A' },
  { id: '4.1.2', title: 'Name, Role, Value', level: 'A' },
  { id: '4.1.3', title: 'Status Messages', level: 'AA' },
];

export const WCAG_22_AA_COUNT = WCAG_22_AA_SC.length;

/** @type {Record<string, WcagScMeta>} */
export const WCAG_SC_LABEL = Object.fromEntries(
  WCAG_22_AA_SC.map((row) => [row.id, { title: row.title, level: row.level }])
);
WCAG_SC_LABEL['2.5.5'] = { title: 'Target Size (Enhanced)', level: 'AAA' };

/**
 * Dutch titles from the authorized Dutch translation of WCAG 2.2 (W3C, 12 June 2024):
 * https://www.w3.org/Translations/WCAG22-nl-20240612/ . The English text is normative.
 */
export const WCAG_SC_TITLE_NL = Object.freeze({
  '1.1.1': 'Niet-tekstuele content',
  '1.2.1': 'Louter-geluid en louter-videobeeld (vooraf opgenomen)',
  '1.2.2': 'Ondertitels voor doven en slechthorenden (vooraf opgenomen)',
  '1.2.3': 'Audiodescriptie of media-alternatief (vooraf opgenomen)',
  '1.2.4': 'Ondertitels voor doven en slechthorenden (live)',
  '1.2.5': 'Audiodescriptie (vooraf opgenomen)',
  '1.3.1': 'Info en relaties',
  '1.3.2': 'Betekenisvolle volgorde',
  '1.3.3': 'Zintuiglijke eigenschappen',
  '1.3.4': 'Weergavestand',
  '1.3.5': 'Identificeer het doel van de input',
  '1.4.1': 'Gebruik van kleur',
  '1.4.2': 'Geluidsbediening',
  '1.4.3': 'Contrast (minimum)',
  '1.4.4': 'Herschalen van tekst',
  '1.4.5': 'Afbeeldingen van tekst',
  '1.4.10': 'Reflow',
  '1.4.11': 'Contrast van niet-tekstuele content',
  '1.4.12': 'Tekstafstand',
  '1.4.13': 'Content bij hover of focus',
  '2.1.1': 'Toetsenbord',
  '2.1.2': 'Geen toetsenbordval',
  '2.1.4': 'Enkel teken sneltoetsen',
  '2.2.1': 'Timing aanpasbaar',
  '2.2.2': 'Pauzeren, stoppen, verbergen',
  '2.3.1': 'Drie flitsen of beneden drempelwaarde',
  '2.4.1': 'Blokken omzeilen',
  '2.4.2': 'Paginatitel',
  '2.4.3': 'Focus volgorde',
  '2.4.4': 'Linkdoel (in context)',
  '2.4.5': 'Meerdere manieren',
  '2.4.6': 'Koppen en labels',
  '2.4.7': 'Focus zichtbaar',
  '2.4.11': 'Focus niet bedekt (minimum)',
  '2.5.1': 'Aanwijzergebaren',
  '2.5.2': 'Aanwijzerannulering',
  '2.5.3': 'Label in naam',
  '2.5.4': 'Bewegingsactivering',
  '2.5.7': 'Sleepbewegingen',
  '2.5.8': 'Grootte van het aanwijsgebied (minimum)',
  '3.1.1': 'Taal van de pagina',
  '3.1.2': 'Taal van onderdelen',
  '3.2.1': 'Bij focus',
  '3.2.2': 'Bij input',
  '3.2.3': 'Consistente navigatie',
  '3.2.4': 'Consistente identificatie',
  '3.2.6': 'Consistente hulp',
  '3.3.1': 'Foutidentificatie',
  '3.3.2': 'Labels of instructies',
  '3.3.3': 'Foutsuggestie',
  '3.3.4': 'Foutpreventie (wettelijk, financieel, gegevens)',
  '3.3.7': 'Overbodige invoer',
  '3.3.8': 'Toegankelijke authenticatie (minimum)',
  '4.1.1': 'Parsen (verouderd en verwijderd)',
  '4.1.2': 'Naam, rol, waarde',
  '4.1.3': 'Statusberichten',
  '2.5.5': 'Grootte van het aanwijsgebied (uitgebreid)',
});

/**
 * @param {string} sc success criterion id, or '_other'
 * @param {string} [lang] 'nl' for the official Dutch title
 */
export function getWcagScLabel(sc, lang = 'en') {
  const dutch = lang === 'nl';
  if (!sc || sc === '_other') {
    return { title: dutch ? 'Andere bevindingen' : 'Other findings', level: '—' };
  }
  const row = WCAG_SC_LABEL[sc];
  if (row) return { title: (dutch && WCAG_SC_TITLE_NL[sc]) || row.title, level: row.level };
  return { title: dutch ? `Succescriterium ${sc}` : `Success Criterion ${sc}`, level: 'AA' };
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
