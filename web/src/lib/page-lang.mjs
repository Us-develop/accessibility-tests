import { resolvePageLang } from '../../../server/i18n.mjs';

/** Query `?lang=` wins; otherwise the `lang` cookie. */
export function langFromAstro(astro) {
  return resolvePageLang({
    searchLang: astro.url.searchParams.get('lang'),
    cookieLang: astro.cookies.get('lang')?.value,
  });
}
