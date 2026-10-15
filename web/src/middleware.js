import { readAccessFromCookies } from '../../server/session.mjs';
import { LANG_COOKIE, langFromCookieHeader, langSetCookie } from '../../i18n/index.mjs';

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
  const response = await next();
  // First visit: remember the language the page was shown in, so the browser's
  // later requests carry it and the server answers them in the same language.
  if (!new RegExp(`(?:^|;\\s*)${LANG_COOKIE}=`).test(cookie) && isHtml(response)) {
    try {
      response.headers.append('Set-Cookie', langSetCookie(locals.lang, { secure: process.env.NODE_ENV === 'production' }));
    } catch {
      // Some responses have immutable headers; the cookie is then set on the next page.
    }
  }
  return response;
}

function isHtml(response) {
  return String(response?.headers?.get?.('content-type') || '').includes('text/html');
}
