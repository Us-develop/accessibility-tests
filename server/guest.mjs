/**
 * Guest-tier helpers: rate limits, Turnstile, tokens, scan caps.
 * Public URL / SSRF checks live in `url-guard.mjs`.
 */
import { createHash, randomBytes } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { REPORTS_BASE } from './paths.js';
import { readJsonStore, writeJsonStore } from './json-store.mjs';
import { commercialCtas } from './plan-catalog.mjs';
import { pruneLeadPrivacyConsents } from './consents.mjs';

export { assertPublicHttpUrl } from './url-guard.mjs';

export const GUEST_TOKEN_RE = /^[a-f0-9]{32}$/;

/** @type {Map<string, number>} */
const guestRunningByIp = new Map();

export function parsePositiveIntEnv(name, fallback) {
  const n = parseInt(String(process.env[name] || ''), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function isValidGuestToken(token) {
  return typeof token === 'string' && GUEST_TOKEN_RE.test(token);
}

/**
 * Guest homepage posts `url` (one page). Staff posts `urls` and/or a file.
 * AUTH_ENABLED=false still treats most requests as staff; this keeps the public
 * 1-page form on the guest scan path so it receives a guestToken.
 */
export function isGuestScanPayload(body, file) {
  if (file) return false;
  const staffUrls = String(body?.urls || '').trim();
  if (staffUrls) return false;
  return Boolean(body) && Object.prototype.hasOwnProperty.call(body, 'url');
}

export function runRequestIsStaff({ authEnabled, accessRole, body, file }) {
  if (isGuestScanPayload(body, file)) return false;
  if (!authEnabled) return true;
  return accessRole === 'staff';
}

export function newGuestToken() {
  return randomBytes(16).toString('hex');
}

export function clientIp(req) {
  return String(req?.ip || '').slice(0, 128);
}

export function guestFreebieUsed(req) {
  const raw = String(req?.headers?.cookie || '');
  return /(?:^|;\s*)wcag_freebie=1(?:;|$)/.test(raw);
}

function guestIpKey(ip) {
  const hashed = hashGuestIp(ip);
  if (hashed) return hashed.slice(0, 16);
  return createHash('sha256')
    .update(`guest-freebie:${guestIpHashSalt()}:unknown`)
    .digest('hex')
    .slice(0, 16);
}

function guestFreebieError() {
  return Object.assign(new Error('You already used your free snapshot. Sign in or buy tokens for another scan.'), {
    status: 429,
    code: 'guest_freebie_used',
    ctas: commercialCtas(),
  });
}

function guestIpAlreadyUsed(ip) {
  const key = guestIpKey(ip);
  const data = readJsonStore('guest-freebies.json', { used: {} });
  const used = data.used && typeof data.used === 'object' ? data.used : {};
  return Boolean(used[key]);
}

/** Cookie or IP already claimed the one free guest snapshot. */
export function guestFreebieClaimed(req) {
  return guestFreebieUsed(req) || guestIpAlreadyUsed(clientIp(req));
}

/**
 * One free guest snapshot per visitor (cookie + IP). Replaces the old 3/hour 10/day cap.
 */
export function checkGuestFreeScan(req) {
  if (guestFreebieClaimed(req)) throw guestFreebieError();
}

export function markGuestFreeScan(req, res) {
  const key = guestIpKey(clientIp(req));
  const data = readJsonStore('guest-freebies.json', { used: {} });
  const used = data.used && typeof data.used === 'object' ? data.used : {};
  used[key] = new Date().toISOString();
  writeJsonStore('guest-freebies.json', { used });
  if (res && typeof res.append === 'function') {
    res.append('Set-Cookie', 'wcag_freebie=1; Path=/; Max-Age=31536000; SameSite=Lax');
  }
}

/** @deprecated Use checkGuestFreeScan */
export function checkGuestRateLimit(ip) {
  checkGuestFreeScan({ headers: {}, socket: { remoteAddress: ip } });
}

export function guestIpHasRunningScan(ip) {
  return (guestRunningByIp.get(ip || 'unknown') || 0) > 0;
}

export function trackGuestRunStart(ip) {
  const key = ip || 'unknown';
  guestRunningByIp.set(key, (guestRunningByIp.get(key) || 0) + 1);
}

export function trackGuestRunEnd(ip) {
  const key = ip || 'unknown';
  const next = (guestRunningByIp.get(key) || 1) - 1;
  if (next <= 0) guestRunningByIp.delete(key);
  else guestRunningByIp.set(key, next);
}

export function countRunningScans(runStatus) {
  let n = 0;
  for (const value of runStatus.values()) {
    if (value?.status === 'running') n += 1;
  }
  return n;
}

export function scanPoolFull(runStatus) {
  const max = parsePositiveIntEnv('SCAN_MAX_CONCURRENT', 3);
  return countRunningScans(runStatus) >= max;
}

function tokenDir() {
  return join(REPORTS_BASE, '_guest-tokens');
}

export function guestIpHashSalt() {
  return String(process.env.GUEST_IP_HASH_SALT || process.env.SESSION_SECRET || 'guest-ip-salt');
}

/** Salted SHA-256 of a guest IP. Already-hashed 64-hex values are left unchanged. */
export function hashGuestIp(ip) {
  const raw = String(ip || '').trim();
  if (!raw) return null;
  if (/^[a-f0-9]{64}$/i.test(raw)) return raw.toLowerCase();
  return createHash('sha256').update(`guest-ip:${guestIpHashSalt()}:${raw}`).digest('hex');
}

export function persistGuestToken(token, payload) {
  if (!isValidGuestToken(token)) return;
  const dir = tokenDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const createdAt = payload.createdAt || new Date().toISOString();
  const expiresAt = payload.expiresAt || guestTokenExpiresAt(createdAt);
  writeFileSync(
    join(dir, `${token}.json`),
    JSON.stringify(
      {
        domain: payload.domain,
        runId: payload.runId,
        url: payload.url || null,
        ip: hashGuestIp(payload.ip) || null,
        createdAt,
        expiresAt,
      },
      null,
      2
    ),
    'utf8'
  );
}

export const GUEST_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function guestTokenExpiresAt(createdAt = new Date()) {
  const start = createdAt instanceof Date ? createdAt : new Date(createdAt);
  const ms = Number.isNaN(start.getTime()) ? Date.now() : start.getTime();
  return new Date(ms + GUEST_TOKEN_TTL_MS).toISOString();
}

export function isGuestTokenExpired(record, now = new Date()) {
  if (!record) return true;
  const exp = record.expiresAt
    ? new Date(record.expiresAt)
    : record.createdAt
      ? new Date(new Date(record.createdAt).getTime() + GUEST_TOKEN_TTL_MS)
      : null;
  if (!exp || Number.isNaN(exp.getTime())) return true;
  return exp.getTime() <= now.getTime();
}

export function readGuestTokenRecord(token, now = new Date()) {
  if (!isValidGuestToken(token)) return null;
  const file = join(tokenDir(), `${token}.json`);
  if (!existsSync(file)) return null;
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    if (!data?.domain || !data?.runId) return null;
    if (isGuestTokenExpired(data, now)) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Delete expired guest token files. Called from scripts/prune-guest-tokens.mjs
 * (and later from the retention job).
 * @returns {{ scanned: number, pruned: number }}
 */
export function listGuestTokenRecords() {
  const dir = tokenDir();
  if (!existsSync(dir)) return [];
  let names = [];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const out = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const token = name.slice(0, -'.json'.length);
    const file = join(dir, name);
    try {
      const data = JSON.parse(readFileSync(file, 'utf8'));
      out.push({ token, file, ...data });
    } catch {
      out.push({ token, file, unreadable: true });
    }
  }
  return out;
}

export function deleteGuestTokenFile(token) {
  if (!isValidGuestToken(token)) return false;
  const file = join(tokenDir(), `${token}.json`);
  if (!existsSync(file)) return false;
  try {
    unlinkSync(file);
    return true;
  } catch {
    return false;
  }
}

export function deleteGuestBindingsForRuns(runs) {
  const wanted = new Set(
    (runs || [])
      .filter((row) => row?.domain && row?.runId)
      .map((row) => `${String(row.domain).toLowerCase()}::${row.runId}`)
  );
  if (!wanted.size) return 0;
  let deleted = 0;
  for (const rec of listGuestTokenRecords()) {
    const key = `${String(rec.domain || '').toLowerCase()}::${rec.runId || ''}`;
    if (!wanted.has(key)) continue;
    if (deleteGuestTokenFile(rec.token)) deleted += 1;
  }
  return deleted;
}

export function guestBindingsForRuns(runs) {
  const wanted = new Set(
    (runs || [])
      .filter((row) => row?.domain && row?.runId)
      .map((row) => `${String(row.domain).toLowerCase()}::${row.runId}`)
  );
  if (!wanted.size) return [];
  return listGuestTokenRecords()
    .filter((rec) => wanted.has(`${String(rec.domain || '').toLowerCase()}::${rec.runId || ''}`))
    .map((rec) => ({
      token: rec.token,
      domain: rec.domain || null,
      runId: rec.runId || null,
      url: rec.url || null,
      createdAt: rec.createdAt || null,
      expiresAt: rec.expiresAt || null,
    }));
}

export function pruneExpiredGuestTokens(now = new Date()) {
  const records = listGuestTokenRecords();
  let pruned = 0;
  for (const rec of records) {
    const expired = rec.unreadable || isGuestTokenExpired(rec, now);
    if (!expired) continue;
    if (deleteGuestTokenFile(rec.token)) pruned += 1;
  }
  return { scanned: records.length, pruned };
}

const TWELVE_MONTHS_MS = 365 * 24 * 60 * 60 * 1000;

export function pruneGuestFreebies(now = new Date(), maxAgeMs = TWELVE_MONTHS_MS) {
  const data = readJsonStore('guest-freebies.json', { used: {} });
  const used = data.used && typeof data.used === 'object' ? data.used : {};
  const cutoff = now.getTime() - maxAgeMs;
  let pruned = 0;
  const next = {};
  for (const [key, value] of Object.entries(used)) {
    const ts = Date.parse(value);
    if (!Number.isFinite(ts) || ts < cutoff) {
      pruned += 1;
      continue;
    }
    next[key] = value;
  }
  if (pruned) writeJsonStore('guest-freebies.json', { used: next });
  return { scanned: Object.keys(used).length, pruned };
}

function leadsFile() {
  return join(REPORTS_BASE, '_leads.jsonl');
}

export function appendLeadFile(row) {
  const dir = REPORTS_BASE;
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const stored = { ...row, id: row?.id || randomBytes(8).toString('hex') };
  appendFileSync(leadsFile(), `${JSON.stringify(stored)}\n`, 'utf8');
  return stored;
}

export function readLeadFileRows(limit = 200) {
  const file = leadsFile();
  if (!existsSync(file)) return [];
  try {
    const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
    const sliced = lines.slice(-Math.max(1, limit));
    const rows = [];
    for (const line of sliced.reverse()) {
      try {
        rows.push(JSON.parse(line));
      } catch {
        /* skip */
      }
    }
    return rows;
  } catch {
    return [];
  }
}

function rewriteLeadFile(rows) {
  const file = leadsFile();
  if (!rows.length) {
    if (existsSync(file)) unlinkSync(file);
    return;
  }
  const dir = REPORTS_BASE;
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(file, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
}

function allLeadFileRows() {
  const file = leadsFile();
  if (!existsSync(file)) return [];
  try {
    const rows = [];
    for (const line of readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
      try {
        rows.push(JSON.parse(line));
      } catch {
        /* skip */
      }
    }
    return rows;
  } catch {
    return [];
  }
}

export function leadsForEmail(email) {
  const needle = String(email || '').trim().toLowerCase();
  if (!needle) return [];
  return allLeadFileRows().filter((row) => String(row?.email || '').trim().toLowerCase() === needle);
}

export function deleteLeadsByEmail(email) {
  const needle = String(email || '').trim().toLowerCase();
  if (!needle) return 0;
  const rows = allLeadFileRows();
  const kept = rows.filter((row) => String(row?.email || '').trim().toLowerCase() !== needle);
  const deleted = rows.length - kept.length;
  if (deleted) rewriteLeadFile(kept);
  void pruneLeadPrivacyConsents({ email: needle });
  return deleted;
}

export function deleteLeadFileById(id) {
  const needle = String(id || '').trim();
  if (!needle) return false;
  const rows = allLeadFileRows();
  const removed = rows.find((row) => String(row?.id ?? '') === needle);
  const kept = rows.filter((row) => String(row?.id ?? '') !== needle);
  if (kept.length === rows.length) return false;
  rewriteLeadFile(kept);
  const email = String(removed?.email || '').trim().toLowerCase();
  if (email) void pruneLeadPrivacyConsents({ email });
  return true;
}

export function pruneLeadFileRows(now = new Date(), maxAgeMs = TWELVE_MONTHS_MS) {
  const cutoff = now.getTime() - maxAgeMs;
  const rows = allLeadFileRows();
  const kept = [];
  let pruned = 0;
  for (const row of rows) {
    const ts = Date.parse(row?.createdAt || row?.created_at || '');
    if (!Number.isFinite(ts) || ts >= cutoff) kept.push(row);
    else pruned += 1;
  }
  if (pruned) rewriteLeadFile(kept);
  if (pruned) void pruneLeadPrivacyConsents({ olderThan: new Date(cutoff) });
  return { scanned: rows.length, pruned };
}

export function turnstileSendIp() {
  const raw = String(process.env.TURNSTILE_SEND_IP || '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

/**
 * @param {string | undefined} token
 * @param {string} ip
 * @returns {Promise<void>}
 */
export async function verifyTurnstileIfConfigured(token, ip) {
  const secret = String(process.env.TURNSTILE_SECRET_KEY || '').trim();
  if (!secret) return;
  const response = String(token || '').trim();
  if (!response) {
    const err = new Error('Complete the captcha and try again.');
    err.status = 400;
    throw err;
  }
  const body = new URLSearchParams();
  body.set('secret', secret);
  body.set('response', response);
  if (ip && turnstileSendIp()) body.set('remoteip', ip);
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (!data?.success) {
    const err = new Error('Captcha verification failed. Try again.');
    err.status = 400;
    throw err;
  }
}

export function publicConfig() {
  return {
    turnstileSiteKey: String(process.env.TURNSTILE_SITE_KEY || process.env.PUBLIC_TURNSTILE_SITE_KEY || '').trim(),
  };
}
