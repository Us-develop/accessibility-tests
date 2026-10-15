/**
 * The accessibility statement is written in each language the statement page
 * offers (todo 26). Kept apart from generate-deliverables.js so the web pages
 * can name the files without loading the generator.
 */
export const STATEMENT_LANGS = Object.freeze(['nl', 'en']);

/** File name of the statement in one language; the scan's language is also kept under the plain name. */
export function statementFileName(lang) {
  return `accessibility-statement.${lang}.html`;
}
