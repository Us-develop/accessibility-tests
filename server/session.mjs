import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

const SESSION_COOKIE = 'wcag_sid';
const UI_COOKIE = 'wcag_ui';
const CSRF_COOKIE = 'wcag_csrf';
const LEGACY_COOKIE = 'wcag_access';
const MAX_AGE_SEC = 12 * 60 * 60;
const USER_CACHE_MS = 60 * 1000;

/** @type {Map<string, { user: object | null, expiresAt: number }>} */
const userCache = new Map();
let generatedDevSecret = null;
let loggedDevSecretWarning = false;

function parseBooleanEnv(name, defaultValue = false) {
  const raw = process.env[name];
  if (raw == null) return defaultValue;
  const value = String(raw).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(value)) return true;
  if (['0', 'false', 'no', 'off'].includes(value)) return false;
  return defaultValue;
}

export function staffSessionVersion() {
  const n = parseInt(String(process.env.STAFF_SESSION_VERSION || '1'), 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export function sessionSecret() {
  const explicit = String(process.env.SESSION_SECRET || '').trim();
  if (explicit.length >= 32) return explicit;
  const authEnabled = parseBooleanEnv('AUTH_ENABLED', true);
  if (process.env.NODE_ENV === 'production' || authEnabled) {
    throw new Error('SESSION_SECRET (>=32 chars) is required');
  }
  if (!generatedDevSecret) {
    generatedDevSecret = randomBytes(32).toString('hex');
  }
  if (!loggedDevSecretWarning) {
    loggedDevSecretWarning = true;
    console.warn('[session] SESSION_SECRET unset; using a random per-process secret (AUTH_ENABLED=false).');
  }
  return generatedDevSecret;
}

function cookieSecure(sameSite) {
  if (sameSite === 'None') return true;
  if (process.env.NODE_ENV === 'production') return true;
  return parseBooleanEnv('AUTH_COOKIE_SECURE', false);
}

/**
 * Shared Path/SameSite/Max-Age/Secure/HttpOnly suffix for first-party cookies.
 * @param {{ httpOnly?: boolean, maxAge?: number, sameSite?: string }} [opts]
 */
export function cookieFlags(opts = {}) {
  const sameSiteRaw = String(opts.sameSite || 'Lax').trim();
  const sameSite = ['Lax', 'Strict', 'None'].includes(sameSiteRaw) ? sameSiteRaw : 'Lax';
  const maxAge = Number.isFinite(Number(opts.maxAge)) ? Number(opts.maxAge) : MAX_AGE_SEC;
  const secure = cookieSecure(sameSite) ? '; Secure' : '';
  const httpOnly = opts.httpOnly ? '; HttpOnly' : '';
  return `; Path=/; SameSite=${sameSite}; Max-Age=${maxAge}${secure}${httpOnly}`;
}

function cookieSuffix(sameSite) {
  return cookieFlags({ sameSite, maxAge: MAX_AGE_SEC });
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

function sign(payloadB64) {
  return createHmac('sha256', sessionSecret()).update(payloadB64).digest('base64url');
}

export function encodeSession(data) {
  const payload = b64url(JSON.stringify({ ...data, iat: Date.now(), exp: Date.now() + MAX_AGE_SEC * 1000 }));
  return `${payload}.${sign(payload)}`;
}

export function decodeSession(token) {
  const raw = String(token || '');
  const i = raw.lastIndexOf('.');
  if (i < 1) return null;
  const payload = raw.slice(0, i);
  const mac = raw.slice(i + 1);
  const expected = sign(payload);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data?.exp || data.exp < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

export function parseCookies(req) {
  const raw = req.headers.cookie || '';
  const out = {};
  raw.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (!k) return;
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  });
  return out;
}

function appendCookie(res, line) {
  res.append('Set-Cookie', line);
}

function clearLegacyCookie(res, sameSite) {
  const secure = cookieSecure(sameSite) ? '; Secure' : '';
  appendCookie(res, `${LEGACY_COOKIE}=; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=0${secure}`);
}

export function setSessionCookies(res, { userId, role, email, ver }, sameSite = 'Lax') {
  const token = encodeSession({ sub: userId, role, email, ver: ver ?? 1 });
  const csrf = randomBytes(16).toString('hex');
  const suffix = cookieSuffix(sameSite);
  const httpOnly = `; HttpOnly`;
  appendCookie(res, `${SESSION_COOKIE}=${token}${httpOnly}${suffix}`);
  appendCookie(res, `${CSRF_COOKIE}=${csrf}${suffix}`);
  const uiValue = role === 'staff' ? '1' : 'c';
  appendCookie(res, `${UI_COOKIE}=${uiValue}${suffix}`);
  clearLegacyCookie(res, sameSite);
  return csrf;
}

export function clearSessionCookies(res, sameSite = 'Lax') {
  const secure = cookieSecure(sameSite) ? '; Secure' : '';
  const clear = (name, httpOnly) =>
    `${name}=; Path=/; SameSite=${sameSite}; Max-Age=0${secure}${httpOnly ? '; HttpOnly' : ''}`;
  appendCookie(res, clear(SESSION_COOKIE, true));
  appendCookie(res, clear(LEGACY_COOKIE, true));
  appendCookie(res, clear(UI_COOKIE, false));
  appendCookie(res, clear(CSRF_COOKIE, false));
}

export function invalidateSessionUserCache(userId) {
  if (userId) userCache.delete(String(userId));
}

async function loadCachedUser(userId) {
  const id = String(userId || '');
  if (!id) return null;
  const now = Date.now();
  const hit = userCache.get(id);
  if (hit && hit.expiresAt > now) return hit.user;
  const { getUserById } = await import('./users.mjs');
  const user = await getUserById(id);
  userCache.set(id, { user, expiresAt: now + USER_CACHE_MS });
  return user;
}

export async function readAccessFromCookies(req) {
  const cookies = parseCookies(req);
  const session = decodeSession(cookies[SESSION_COOKIE]);
  if (!session?.sub || !session.role) return null;
  const csrf = cookies[CSRF_COOKIE] || '';
  if (session.role === 'staff' && session.sub === 'staff') {
    if (Number(session.ver) !== staffSessionVersion()) return null;
    return { role: 'staff', userId: 'staff', email: session.email || '', csrf, ver: session.ver };
  }
  const user = await loadCachedUser(session.sub);
  if (!user) return null;
  const currentVer = Number(user.sessionVersion) || 1;
  if (Number(session.ver) !== currentVer) return null;
  return {
    role: session.role,
    userId: session.sub,
    email: session.email || user.email || '',
    csrf,
    ver: session.ver,
  };
}

const CSRF_SAFE_PATHS = new Set([
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/signup',
  '/api/auth/forgot',
  '/api/auth/reset',
  '/api/auth/verify',
  '/api/auth/verify/resend',
  '/api/lead',
  '/api/access-request',
  '/api/stripe/webhook',
  '/auth/logout',
]);

/**
 * Native <form method="post"> submissions (no fetch). Used so login/signup
 * can redirect instead of returning JSON when JavaScript is missing or a
 * ClientRouter swap dropped the submit handler.
 */
export function isHtmlFormPost(req) {
  const type = String(req.headers['content-type'] || '');
  if (!type.includes('application/x-www-form-urlencoded')) return false;
  const accept = String(req.headers.accept || '*/*');
  if (accept.includes('application/json') && !/\btext\/html\b/i.test(accept)) return false;
  return true;
}

export function csrfOk(req) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return true;
  if (CSRF_SAFE_PATHS.has(req.path)) return true;
  const cookies = parseCookies(req);
  const cookieToken = cookies[CSRF_COOKIE] || '';
  const header = String(req.headers['x-csrf-token'] || req.body?.csrfToken || '').trim();
  if (!cookieToken || !header) return false;
  const a = Buffer.from(cookieToken);
  const b = Buffer.from(header);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Issue a CSRF cookie on HTML/API GETs so guest forms can send it.
 * Does not rotate an existing token.
 * @returns {string} cookie value
 */
export function ensureCsrfCookie(req, res, sameSite = 'Lax') {
  const cookies = parseCookies(req);
  const existing = cookies[CSRF_COOKIE] || '';
  if (existing) return existing;
  const csrf = randomBytes(16).toString('hex');
  appendCookie(res, `${CSRF_COOKIE}=${csrf}${cookieSuffix(sameSite)}`);
  return csrf;
}

export { SESSION_COOKIE, UI_COOKIE, CSRF_COOKIE };
