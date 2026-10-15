/**
 * Which language each kind of finding text in a report is written in.
 *
 * Our own checks write their titles and messages in the language of the scan
 * (`lang` in the results, see tests/scan-text.js). The axe texts follow the
 * axe locale the scan used (`axeLang`). Reports from before either was recorded
 * are English. Pages mark a text whose language differs from the page.
 *
 * @param {object} reportData
 * @returns {{ custom: string, axe: string }}
 */
import { normalizeLang } from './i18n/index.mjs';

export function findingsLangs(reportData) {
  return {
    custom: normalizeLang(reportData?.lang) || 'en',
    axe: normalizeLang(reportData?.axeLang) || 'en',
  };
}
