/**
 * Language of the page being rendered on the server.
 *
 * A page that has been translated calls `usePageLang(Astro)` in its
 * frontmatter and gets a translator for the visitor's language. The layout and
 * the header then use the same language.
 *
 * A page that has not been translated yet does not call it, and the layout and
 * header stay in English with <html lang="en">: a page must never claim a
 * language its content is not written in.
 */
import { defaultLang, normalizeLang, translator } from '../../../i18n/index.mjs';

/** For a translated page: mark it as such and return its translator (`tr`, `tr.lang`). */
export function usePageLang(Astro) {
  const lang = normalizeLang(Astro.locals?.lang) || defaultLang();
  Astro.locals.pageLang = lang;
  return translator(lang);
}

/** For the layout and header: the page's language, English when it is not translated. */
export function chromeTranslator(Astro) {
  return translator(Astro.locals?.pageLang || 'en');
}
