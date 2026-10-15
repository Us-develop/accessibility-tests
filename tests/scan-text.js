/**
 * Texts the scanner writes into a report, in the language of the scan.
 *
 * The server starts each scan in its own process with WCAG_SCAN_LANG set to the
 * language the visitor uses. A report keeps that language, whatever language
 * it is opened in later. Without the variable (command line, older setups) the
 * scan is in English.
 */
import { normalizeLang, t } from '../i18n/index.mjs';

export const SCAN_LANG = normalizeLang(process.env.WCAG_SCAN_LANG) || 'en';

/** A check text (i18n/checks.*.mjs) in the language of this scan. */
export function say(key, vars) {
  return t(SCAN_LANG, key, vars);
}
