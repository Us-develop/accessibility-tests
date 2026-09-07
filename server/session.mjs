import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

const SESSION_COOKIE = 'wcag_sid';
const UI_COOKIE = 'wcag_ui';
const CSRF_COOKIE = 'wcag_csrf';
const LEGACY_COOKIE = 'wcag_access';
const MAX_AGE_SEC = 12 * 60 * 60;

function parseBooleanEnv(name, defaultValue = false) {
  const raw = process.env[name];
  if (raw == null) return defaultValue;
  const value = String(raw).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(value)) return true;
  if (['0', 'false', 'no', 'off'].includes(value)) return false;
  return defaultValue;
}

export function sessionSecret() {
  const explicit = String(process.env.SESSION_SECRET || '').trim();
  if (explicit) return explicit;
  const fallback = String(process.env.APP_PASSWORD || 'root');
  return `dev-only:${fallback}`;
}

function cookieSecure(sameSite) {
  if (sameSite === 'None') return true;
  return parseBooleanEnv('AUTH_COOKIE_SECURE', false);
}

function cookieSuffix(sameSite) {
  const secure = cookieSecure(sameSite) ? '; Secure' : '';
  return `; Path=/; SameSite=${sameSite}; Max-Age=${MAX_AGE_SEC}${secure}`;
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

export function setSessionCookies(res, { userId, role, email }, sameSite = 'Lax') {
  const token = encodeSession({ sub: userId, role, email });
  const csrf = randomBytes(16).toString('hex');
  const suffix = cookieSuffix(sameSite);
  const httpOnly = `; HttpOnly`;
  appendCookie(res, `${SESSION_COOKIE}=${token}${httpOnly}${suffix}`);
  appendCookie(res, `${CSRF_COOKIE}=${csrf}${suffix}`);
  const uiValue = role === 'staff' ? '1' : 'c';
  appendCookie(res, `${UI_COOKIE}=${uiValue}${suffix}`);
  if (role === 'staff') {
    appendCookie(res, `${LEGACY_COOKIE}=1${httpOnly}${suffix}`);
  } else {
    appendCookie(res, `${LEGACY_COOKIE}=; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=0`);
  }
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

export function readAccessFromCookies(req) {
  const cookies = parseCookies(req);
  const session = decodeSession(cookies[SESSION_COOKIE]);
  if (session?.sub && session.role) {
    return {
      role: session.role,
      userId: session.sub,
      email: session.email || '',
      csrf: cookies[CSRF_COOKIE] || '',
    };
  }
  if (cookies[LEGACY_COOKIE] === '1') {
    return { role: 'staff', userId: 'staff', email: '', csrf: cookies[CSRF_COOKIE] || '' };
  }
  return null;
}

const CSRF_SAFE_PATHS = new Set([
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/signup',
  '/api/auth/forgot',
  '/api/auth/reset',
  '/api/auth/verify',
  '/api/lead',
  '/api/access-request',
  '/api/billing/webhook',
]);

export function csrfOk(req) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return true;
  if (CSRF_SAFE_PATHS.has(req.path)) return true;
  if (req.path === '/api/run' && req.access?.role === 'guest') return true;
  const cookies = parseCookies(req);
  const cookieToken = cookies[CSRF_COOKIE] || '';
  const header = String(req.headers['x-csrf-token'] || req.body?.csrfToken || '').trim();
  if (!cookieToken || !header) return false;
  const a = Buffer.from(cookieToken);
  const b = Buffer.from(header);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export { SESSION_COOKIE, UI_COOKIE, CSRF_COOKIE, LEGACY_COOKIE };
