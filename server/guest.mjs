/**
 * Guest-tier helpers: public URL checks (SSRF), rate limits, Turnstile, tokens, scan caps.
 */
import { lookup } from 'dns/promises';
import { randomBytes } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'fs';
import { BlockList, isIP } from 'net';
import { join } from 'path';
import { REPORTS_BASE } from './paths.js';

export const GUEST_TOKEN_RE = /^[a-f0-9]{32}$/;

const BLOCKED_HOSTS = new Set([
  'localhost',
  'localhost.',
  'metadata.google.internal',
  'metadata.google.internal.',
  'kubernetes.default',
  'kubernetes.default.svc',
]);

const privateNets = new BlockList();
privateNets.addSubnet('0.0.0.0', 8, 'ipv4');
privateNets.addSubnet('10.0.0.0', 8, 'ipv4');
privateNets.addSubnet('127.0.0.0', 8, 'ipv4');
privateNets.addSubnet('169.254.0.0', 16, 'ipv4');
privateNets.addSubnet('172.16.0.0', 12, 'ipv4');
privateNets.addSubnet('192.168.0.0', 16, 'ipv4');
privateNets.addSubnet('100.64.0.0', 10, 'ipv4');
privateNets.addAddress('::1', 'ipv6');
privateNets.addSubnet('fc00::', 7, 'ipv6');
privateNets.addSubnet('fe80::', 10, 'ipv6');

/** @type {Map<string, number[]>} */
const guestHitsByIp = new Map();
/** @type {Map<string, number>} */
const guestRunningByIp = new Map();

export function parsePositiveIntEnv(name, fallback) {
  const n = parseInt(String(process.env[name] || ''), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function isValidGuestToken(token) {
  return typeof token === 'string' && GUEST_TOKEN_RE.test(token);
}

export function newGuestToken() {
  return randomBytes(16).toString('hex');
}

export function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (typeof xf === 'string' && xf.trim()) {
    return xf.split(',')[0].trim().slice(0, 128);
  }
  const raw = req.socket?.remoteAddress || req.ip || '';
  return String(raw).slice(0, 128);
}

function normalizeIp(ip) {
  let value = String(ip || '').trim().toLowerCase();
  if (value.startsWith('::ffff:')) value = value.slice(7);
  return value;
}

function isBlockedIp(ip) {
  const value = normalizeIp(ip);
  if (!value) return true;
  const kind = isIP(value);
  if (kind === 4) return privateNets.check(value, 'ipv4');
  if (kind === 6) return privateNets.check(value, 'ipv6');
  return true;
}

function isBlockedHostname(hostname) {
  const host = String(hostname || '')
    .trim()
    .toLowerCase()
    .replace(/\.$/, '');
  if (!host) return true;
  if (BLOCKED_HOSTS.has(host) || BLOCKED_HOSTS.has(`${host}.`)) return true;
  if (host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) return true;
  if (isIP(host) && isBlockedIp(host)) return true;
  return false;
}

/**
 * Guest scans: a single public http(s) URL. Rejects private/reserved IPs after DNS lookup.
 * @param {string} raw
 * @returns {Promise<string>} canonical URL
 */
export async function assertPublicHttpUrl(raw) {
  const input = String(raw || '').trim();
  if (!input || input.length > 2048) {
    throw Object.assign(new Error('Enter a single public http(s) URL.'), { status: 400 });
  }
  let parsed;
  try {
    parsed = new URL(input);
  } catch {
    throw Object.assign(new Error('Enter a valid URL, including https://.'), { status: 400 });
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw Object.assign(new Error('Only http and https URLs can be scanned.'), { status: 400 });
  }
  if (parsed.username || parsed.password) {
    throw Object.assign(new Error('URLs with credentials are not allowed.'), { status: 400 });
  }
  const hostname = parsed.hostname;
  if (isBlockedHostname(hostname)) {
    throw Object.assign(new Error('That host cannot be scanned.'), { status: 400 });
  }
  let records;
  try {
    records = await lookup(hostname, { all: true });
  } catch {
    throw Object.assign(new Error('Could not resolve that hostname.'), { status: 400 });
  }
  if (!records.length || records.some((r) => isBlockedIp(r.address))) {
    throw Object.assign(new Error('That host cannot be scanned.'), { status: 400 });
  }
  parsed.hash = '';
  return parsed.toString();
}

export function checkGuestRateLimit(ip) {
  const hourLimit = parsePositiveIntEnv('GUEST_SCANS_PER_HOUR', 3);
  const dayLimit = parsePositiveIntEnv('GUEST_SCANS_PER_DAY', 10);
  const now = Date.now();
  const hourAgo = now - 60 * 60 * 1000;
  const dayAgo = now - 24 * 60 * 60 * 1000;
  const key = ip || 'unknown';
  const prev = (guestHitsByIp.get(key) || []).filter((t) => t > dayAgo);
  const hourCount = prev.filter((t) => t > hourAgo).length;
  if (hourCount >= hourLimit || prev.length >= dayLimit) {
    const err = new Error('Too many free scans from this network. Try again later, or sign in.');
    err.status = 429;
    throw err;
  }
  prev.push(now);
  guestHitsByIp.set(key, prev);
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

export function persistGuestToken(token, payload) {
  if (!isValidGuestToken(token)) return;
  const dir = tokenDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${token}.json`),
    JSON.stringify(
      {
        domain: payload.domain,
        runId: payload.runId,
        url: payload.url || null,
        ip: payload.ip || null,
        createdAt: new Date().toISOString(),
      },
      null,
      2
    ),
    'utf8'
  );
}

export function readGuestTokenRecord(token) {
  if (!isValidGuestToken(token)) return null;
  const file = join(tokenDir(), `${token}.json`);
  if (!existsSync(file)) return null;
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    if (!data?.domain || !data?.runId) return null;
    return data;
  } catch {
    return null;
  }
}

function leadsFile() {
  return join(REPORTS_BASE, '_leads.jsonl');
}

export function appendLeadFile(row) {
  const dir = REPORTS_BASE;
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  appendFileSync(leadsFile(), `${JSON.stringify(row)}\n`, 'utf8');
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
  if (ip) body.set('remoteip', ip);
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
