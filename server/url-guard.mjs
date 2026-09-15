/**
 * SSRF guard: only public http(s) URLs may be scanned.
 * Optional `{ lookup }` injects DNS so unit tests never touch the network.
 */
import { lookup as dnsLookup } from 'dns/promises';
import { BlockList, isIP } from 'net';

export const SCANNER_UA_NAME = 'AccessibilityScanner/1.0';
export const SITEMAP_FETCH_TIMEOUT_MS = 10_000;
export const SITEMAP_MAX_BODY_BYTES = 2 * 1024 * 1024;

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
privateNets.addSubnet('192.0.0.0', 24, 'ipv4');
privateNets.addSubnet('198.18.0.0', 15, 'ipv4');
privateNets.addSubnet('224.0.0.0', 4, 'ipv4');
privateNets.addSubnet('240.0.0.0', 4, 'ipv4');
privateNets.addAddress('::1', 'ipv6');
privateNets.addAddress('::', 'ipv6');
privateNets.addSubnet('fc00::', 7, 'ipv6');
privateNets.addSubnet('fe80::', 10, 'ipv6');
privateNets.addSubnet('64:ff9b::', 96, 'ipv6');
privateNets.addSubnet('2002::', 16, 'ipv6');

/** @type {typeof dnsLookup | null} */
let injectedLookup = null;

/**
 * Override the default DNS resolver (tests). Pass `null` to restore `dns.lookup`.
 * @param {typeof dnsLookup | null} fn
 */
export function setUrlGuardLookup(fn) {
  injectedLookup = typeof fn === 'function' ? fn : null;
}

export function scannerUserAgent(baseUrl = process.env.PUBLIC_BASE_URL) {
  const base = String(baseUrl || '')
    .trim()
    .replace(/\/$/, '');
  const href = base || 'https://localhost';
  return `${SCANNER_UA_NAME} (+${href.startsWith('http') ? href : `https://${href}`})`;
}

export function stripBrackets(hostname) {
  const host = String(hostname || '').trim();
  if (host.startsWith('[') && host.endsWith(']')) return host.slice(1, -1);
  return host;
}

function normalizeIp(ip) {
  let value = stripBrackets(ip).trim().toLowerCase();
  if (value.startsWith('::ffff:')) value = value.slice(7);
  return value;
}

export function isBlockedIp(ip) {
  const value = normalizeIp(ip);
  if (!value) return true;
  const kind = isIP(value);
  if (kind === 4) return privateNets.check(value, 'ipv4');
  if (kind === 6) return privateNets.check(value, 'ipv6');
  return true;
}

export function isBlockedHostname(hostname) {
  const host = stripBrackets(hostname)
    .trim()
    .toLowerCase()
    .replace(/\.$/, '');
  if (!host) return true;
  if (BLOCKED_HOSTS.has(host) || BLOCKED_HOSTS.has(`${host}.`)) return true;
  if (host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) return true;
  if (isIP(host) && isBlockedIp(host)) return true;
  return false;
}

function httpError(message, status, code) {
  return Object.assign(new Error(message), { status, code });
}

function recordsToAddresses(records) {
  if (!records) return [];
  const list = Array.isArray(records) ? records : [records];
  return list
    .map((row) => (typeof row === 'string' ? row : row?.address))
    .map((addr) => String(addr || '').trim())
    .filter(Boolean);
}

/**
 * Guest/staff/customer scans: a public http(s) URL. Rejects private/reserved IPs after DNS.
 * @param {string} raw
 * @param {{ lookup?: typeof dnsLookup }} [options]
 * @returns {Promise<{ url: string, hostname: string, addresses: string[] }>}
 */
export async function resolvePublicHttpUrl(raw, options = {}) {
  const input = String(raw || '').trim();
  if (!input || input.length > 2048) {
    throw httpError('Enter a single public http(s) URL.', 400, 'invalid_url');
  }
  let parsed;
  try {
    parsed = new URL(input);
  } catch {
    throw httpError('Enter a valid URL, including https://.', 400, 'invalid_url');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw httpError('Only http and https URLs can be scanned.', 400, 'blocked_target');
  }
  if (parsed.username || parsed.password) {
    throw httpError('URLs with credentials are not allowed.', 400, 'blocked_target');
  }
  const hostname = stripBrackets(parsed.hostname);
  if (isBlockedHostname(hostname)) {
    throw httpError('That host cannot be scanned.', 400, 'blocked_target');
  }
  if (isIP(hostname)) {
    if (isBlockedIp(hostname)) {
      throw httpError('That host cannot be scanned.', 400, 'blocked_target');
    }
    parsed.hash = '';
    return { url: parsed.toString(), hostname, addresses: [hostname] };
  }
  const resolve = options.lookup || injectedLookup || dnsLookup;
  let records;
  try {
    records = await resolve(hostname, { all: true });
  } catch {
    throw httpError('Could not resolve that hostname.', 400, 'invalid_url');
  }
  const addresses = recordsToAddresses(records);
  if (!addresses.length || addresses.some((addr) => isBlockedIp(addr))) {
    throw httpError('That host cannot be scanned.', 400, 'blocked_target');
  }
  parsed.hash = '';
  return { url: parsed.toString(), hostname, addresses };
}

/**
 * Guest/staff/customer scans: a public http(s) URL. Rejects private/reserved IPs after DNS.
 * @param {string} raw
 * @param {{ lookup?: typeof dnsLookup }} [options]
 * @returns {Promise<string>} canonical URL
 */
export async function assertPublicHttpUrl(raw, options = {}) {
  const target = await resolvePublicHttpUrl(raw, options);
  return target.url;
}

/**
 * Chromium `--host-resolver-rules` value pinning hostnames to the IPs validated at accept time.
 * @param {{ hostname?: string, addresses?: string[] }[]} targets
 */
export function hostResolverRulesFromTargets(targets) {
  const maps = [];
  const seen = new Set();
  for (const target of targets || []) {
    const host = String(target?.hostname || '').toLowerCase();
    const ip = target?.addresses?.[0];
    if (!host || !ip || isIP(host) || seen.has(host)) continue;
    seen.add(host);
    maps.push(`MAP ${host} ${ip}`);
  }
  return maps.join(',');
}

/**
 * @param {string[]} candidates
 * @param {{ lookup?: typeof dnsLookup }} [options]
 * @returns {Promise<{ accepted: string[], rejected: { url: string, reason: string }[], targets: { url: string, hostname: string, addresses: string[] }[] }>}
 */
export async function filterPublicHttpUrls(candidates, options = {}) {
  const accepted = [];
  const rejected = [];
  const targets = [];
  const seen = new Set();
  for (const raw of candidates || []) {
    const input = String(raw || '').trim();
    if (seen.has(input)) continue;
    seen.add(input);
    try {
      const target = await resolvePublicHttpUrl(input, options);
      accepted.push(target.url);
      targets.push(target);
    } catch (err) {
      rejected.push({
        url: input,
        reason: err?.message || 'That host cannot be scanned.',
      });
    }
  }
  return { accepted: [...new Set(accepted)], rejected, targets };
}

/**
 * Tokens that should be treated as scan URL candidates (http(s) plus other schemes like file:).
 * @param {string} text
 * @returns {string[]}
 */
export function collectUrlCandidates(text) {
  if (!text || typeof text !== 'string') return [];
  const out = [];
  const httpRegex = /https?:\/\/[^\s"'<>,\\|]+/g;
  const matches = text.match(httpRegex) || [];
  for (const u of matches) {
    out.push(u.replace(/[.,;:!?)]+$/, ''));
  }
  for (const part of text.split(/[\s,|]+/)) {
    const u = part.replace(/[.,;:!?)]+$/, '').trim();
    if (u.includes('://')) out.push(u);
  }
  return [...new Set(out.filter(Boolean))];
}

export function looksLikeUrlCandidate(value) {
  const p = String(value || '').trim();
  if (!p) return false;
  return p.includes('://') || /^https?:/i.test(p);
}

/**
 * Fetch a child sitemap only after SSRF checks. Drops redirects, caps body size, 10 s timeout.
 * @param {string} loc
 * @param {{ lookup?: typeof dnsLookup, fetch?: typeof fetch }} [options]
 * @returns {Promise<string | null>} XML text, or null to skip
 */
export async function fetchSitemapDocument(loc, options = {}) {
  try {
    await assertPublicHttpUrl(loc, options);
  } catch {
    return null;
  }
  const fetchFn = options.fetch || fetch;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), SITEMAP_FETCH_TIMEOUT_MS);
  try {
    const res = await fetchFn(loc, {
      redirect: 'manual',
      signal: ac.signal,
      headers: { 'User-Agent': scannerUserAgent() },
    });
    const status = Number(res?.status) || 0;
    if (status >= 300 && status < 400) return null;
    if (!res || !res.ok) return null;
    const declared = Number(res.headers?.get?.('content-length'));
    if (Number.isFinite(declared) && declared > SITEMAP_MAX_BODY_BYTES) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > SITEMAP_MAX_BODY_BYTES) return null;
    return buf.toString('utf8');
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const SCAN_ENV_FIXED = ['PATH', 'HOME', 'NODE_ENV', 'REPORTS_BASE', 'PLAYWRIGHT_BROWSERS_PATH', 'PUBLIC_BASE_URL'];
const SCAN_ENV_NAMED = new Set([
  'URL_CONCURRENCY',
  'BLOCK_MEDIA_REQUESTS',
  'LARGE_DOM_THRESHOLD',
  'SCANNER_NO_SANDBOX',
  'WAIT_FOR_NETWORKIDLE',
  'ENABLE_CONTRAST_CHECKS',
  'AUTO_DISABLE_CONTRAST_ON_LARGE_DOM',
  'ENABLE_AXE_PASSES',
]);

/**
 * Explicit env for the Playwright child. No Stripe keys, session secrets, or other parent env.
 * @param {NodeJS.ProcessEnv} [source]
 */
export function buildScanProcessEnv(source = process.env) {
  const env = {};
  for (const key of SCAN_ENV_FIXED) {
    if (source[key] != null && String(source[key]) !== '') env[key] = source[key];
  }
  for (const key of Object.keys(source)) {
    if (SCAN_ENV_NAMED.has(key) || key.endsWith('_TIMEOUT_MS')) {
      env[key] = source[key];
    }
  }
  return env;
}
