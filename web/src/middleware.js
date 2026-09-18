import { readAccessFromCookies } from '../../server/session.mjs';

/**
 * Standalone @astrojs/node ignores Express locals. Re-read the signed session
 * so domain history and other SSR pages see the same customer as /api/account.
 */
export async function onRequest({ locals, request }, next) {
  if (!locals.access) {
    const cookie = request.headers.get('cookie') || '';
    locals.access = (await readAccessFromCookies({ headers: { cookie } })) || null;
  }
  return next();
}
