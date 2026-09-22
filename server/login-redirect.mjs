/** Post-login redirects that would loop the user back onto a login screen. */
const LOGIN_LOOP_PATHS = new Set(['/login', '/auth/login', '/auth/staff', '/auth/logout']);

/**
 * Pathname of a relative next URL (`/account?x=1` → `/account`).
 * @param {string} raw
 */
export function pathnameOfNext(raw) {
  const t = String(raw || '').trim();
  const noQuery = t.split('#')[0].split('?')[0];
  if (!noQuery || noQuery === '/') return '/';
  const trimmed = noQuery.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function pathnameFromCandidate(candidate) {
  if (candidate.startsWith('/') && !candidate.startsWith('//')) {
    return pathnameOfNext(candidate);
  }
  try {
    return pathnameOfNext(new URL(candidate).pathname);
  } catch {
    return '/';
  }
}

/**
 * Safe post-login redirect: relative path, or absolute URL matching ALLOWED_ORIGIN.
 * Rejects login-screen self-loops (`/login`, `/auth/login`) and `/api/*`.
 * @param {unknown} raw
 * @param {string} [fallback='/']
 */
export function safeNextAfterLogin(raw, fallback = '/') {
  const fallbackPath = typeof fallback === 'string' && fallback ? fallback : '/';
  if (typeof raw !== 'string') return fallbackPath;
  const t = raw.trim();
  if (!t) return fallbackPath;
  let candidate = '';
  if (t.startsWith('/') && !t.startsWith('//')) {
    candidate = t.slice(0, 2048);
  } else {
    const uiOrigin = String(process.env.ALLOWED_ORIGIN || '').trim();
    if (!uiOrigin || uiOrigin === '*') return fallbackPath;
    try {
      const allowed = new URL(uiOrigin).origin;
      const u = new URL(t);
      if (u.origin === allowed) candidate = t.slice(0, 2048);
    } catch {
      return fallbackPath;
    }
  }
  if (!candidate) return fallbackPath;
  const pathOnly = pathnameFromCandidate(candidate);
  if (LOGIN_LOOP_PATHS.has(pathOnly) || pathOnly.startsWith('/api/')) return fallbackPath;
  return candidate;
}

/** Default landing for a customer `/login` visit when `next` is missing or unsafe. */
export function customerLoginNext(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return '/account';
  return safeNextAfterLogin(raw, '/account');
}

export const PENDING_NEXT_COOKIE = 'wcag_next';
const PENDING_NEXT_MAX_AGE_SEC = 48 * 60 * 60;

function cookieSecureFlag(sameSite) {
  if (sameSite === 'None') return true;
  return process.env.NODE_ENV === 'production';
}

/**
 * Remember a post-verify destination across the email round-trip.
 * Always re-checked with safeNextAfterLogin when read.
 * @param {string} next
 * @param {{ sameSite?: string, secure?: boolean }} [opts]
 */
export function pendingNextSetCookie(next, opts = {}) {
  const sameSite = opts.sameSite || 'Lax';
  const secure = opts.secure ?? cookieSecureFlag(sameSite);
  const value = customerLoginNext(next);
  const securePart = secure ? '; Secure' : '';
  return `${PENDING_NEXT_COOKIE}=${encodeURIComponent(value)}; Path=/; Max-Age=${PENDING_NEXT_MAX_AGE_SEC}; SameSite=${sameSite}; HttpOnly${securePart}`;
}

export function pendingNextClearCookie(opts = {}) {
  const sameSite = opts.sameSite || 'Lax';
  const secure = opts.secure ?? cookieSecureFlag(sameSite);
  const securePart = secure ? '; Secure' : '';
  return `${PENDING_NEXT_COOKIE}=; Path=/; Max-Age=0; SameSite=${sameSite}; HttpOnly${securePart}`;
}

export function pendingNextFromCookieHeader(cookieHeader) {
  const match = String(cookieHeader || '').match(/(?:^|; )wcag_next=([^;]*)/);
  if (!match) return '';
  try {
    return customerLoginNext(decodeURIComponent(match[1]));
  } catch {
    return '/account';
  }
}

export function isPricingNext(raw) {
  return pathnameOfNext(raw) === '/pricing';
}
