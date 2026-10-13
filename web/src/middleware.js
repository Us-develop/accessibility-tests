import { readAccessFromCookies } from '../../server/session.mjs';
import { langFromCookieHeader } from '../../i18n/index.mjs';

/**
 * Standalone @astrojs/node ignores Express locals. Re-read the signed session
 * so domain history and other SSR pages see the same customer as /api/account.
 */
export async function onRequest({ locals, request }, next) {
  const cookie = request.headers.get('cookie') || '';
  if (!locals.access) {
    locals.access = (await readAccessFromCookies({ headers: { cookie } })) || null;
  }
  // The visitor's language (wcag_lang cookie, Dutch by default). Pages that are
  // translated pick it up with usePageLang().
  locals.lang = langFromCookieHeader(cookie);
  return next();
}
