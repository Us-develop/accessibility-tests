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
