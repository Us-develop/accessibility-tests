/**
 * Express app factory: API routes, auth, report file serving.
 * Designed for the Astro shell (web/) — Astro serves the UI, this app serves /api/* and /report/* artifacts.
 * @param {string} repoRoot - Repository root (directory containing run-tests.js, generate-report.js, reports/).
 */
import express from 'express';
import multer from 'multer';
import { spawn } from 'child_process';
import { randomBytes } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { sendRunNotificationEmail, createSmtpTransport, sendAccessRequestEmail, sendLeadEmail } from '../server-email.js';
import { REPORTS_BASE } from './paths.js';
import { dbPool, dbUpsertRun, dbGetRun, dbGetLatestRun, dbGetRunByGuestToken, dbInsertLead, dbListLeads } from './db.js';
import { mergeReportData } from './report-data.js';
import { readJsonIfExists, isValidReportId } from './fs-utils.js';
import { listAuditEntries, listRunsForDomain } from './audit-list.js';
import { getFtpConfig, ftpDownload, ftpUpload, persistReportArtifactsToFtp } from './ftp.js';
import { normalizeManualProgress } from '../manual-checklist.js';
import {
  newRunId,
  isValidRunId,
  isValidDomain,
  runDir as runDirOf,
  domainDir as domainDirOf,
  latestRunIdOnDisk,
} from './run-ids.js';
import {
  assertPublicHttpUrl,
  checkGuestRateLimit,
  clientIp,
  guestIpHasRunningScan,
  isValidGuestToken,
  newGuestToken,
  persistGuestToken,
  publicConfig,
  readGuestTokenRecord,
  scanPoolFull,
  trackGuestRunEnd,
  trackGuestRunStart,
  verifyTurnstileIfConfigured,
  appendLeadFile,
  readLeadFileRows,
} from './guest.mjs';
import { buildTeaserPayload } from './teaser-payload.mjs';

const DELIVERABLE_FILES = [
  'accessibility-developers.html',
  'accessibility-client.html',
  'accessibility-statement.html',
];

function runKey(domain, runId) {
  return `${domain}:${runId}`;
}

/** Find any in-memory `running` run for a domain (used by /report/:domain/ redirects). */
function findRunningRun(runStatusMap, domain) {
  for (const [key, value] of runStatusMap.entries()) {
    if (!key.startsWith(`${domain}:`)) continue;
    if (value?.status === 'running') {
      const runId = key.slice(domain.length + 1);
      return { runId, state: value };
    }
  }
  return null;
}

const GENERATE_REPORT_URL = new URL('../generate-report.js', import.meta.url).href;

const FTP_CONFIG = getFtpConfig();

function parseBooleanEnv(name, defaultValue = false) {
  const raw = process.env[name];
  if (raw == null) return defaultValue;
  const value = String(raw).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(value)) return true;
  if (['0', 'false', 'no', 'off'].includes(value)) return false;
  return defaultValue;
}
let AUTH_ENABLED = parseBooleanEnv('AUTH_ENABLED', true);
let APP_USERNAME = 'root';
let APP_PASSWORD = 'root';
let AUTH_COOKIE_SAMESITE = 'Lax';
const AUTH_COOKIE_NAME = 'wcag_access';
const AUTH_COOKIE_SECURE = parseBooleanEnv('AUTH_COOKIE_SECURE', false);

// In-memory run status (running, done, error)
const runStatus = new Map();
/** Run IDs we already attempted to notify (success or skip) */
const notificationAttempted = new Set();

function clipEmail(s, max = 200) {
  if (typeof s !== 'string') return '';
  return s.trim().slice(0, max);
}

function parseNotifyFields(body) {
  const raw = body?.notify_on_complete;
  const notifyOnComplete =
    raw === 'on' ||
    raw === '1' ||
    raw === 'true' ||
    raw === true;
  const notifyEmail = clipEmail(body?.notify_email || body?.statement_email || '');
  return { notifyOnComplete, notifyEmail };
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isIndexablePath(pathname) {
  if (pathname === '/' || pathname === '') return true;
  if (pathname === '/teaser' || pathname.startsWith('/teaser/')) return true;
  return false;
}

function isGuestOpenPath(req) {
  const p = req.path;
  if (req.method === 'GET') {
    if (p === '/' || p === '/loading') return true;
    if (p === '/teaser' || p.startsWith('/teaser/')) return true;
    if (p === '/api/config') return true;
    if (p.startsWith('/api/guest/')) return true;
    if (p.startsWith('/assets/') || p.startsWith('/styles/') || p.startsWith('/_astro/')) return true;
  }
  if (req.method === 'POST' && (p === '/api/run' || p === '/api/lead')) return true;
  return false;
}

function requestIsStaff(req) {
  if (!AUTH_ENABLED) return true;
  return req.access?.role === 'staff';
}

function getJiraConfig() {
  return {
    // Atlassian OAuth (3LO)
    clientId: String(process.env.ATLASSIAN_CLIENT_ID || '').trim(),
    clientSecret: String(process.env.ATLASSIAN_CLIENT_SECRET || '').trim(),
    redirectUri: String(process.env.ATLASSIAN_REDIRECT_URI || '').trim(),
  };
}

function jiraOAuthFile(domain) {
  return join(domainDirOf(domain), 'jira-oauth.json');
}

function readJiraOAuth(domain) {
  if (!isValidDomain(domain)) return null;
  const p = jiraOAuthFile(domain);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function writeJiraOAuth(domain, data) {
  if (!isValidDomain(domain)) return;
  const dir = domainDirOf(domain);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(jiraOAuthFile(domain), JSON.stringify(data, null, 2), 'utf8');
}

/** @type {Map<string, { domain: string, expiresAt: number }>} */
const jiraOauthState = new Map();

function newOauthState(domain) {
  const state = randomBytes(24).toString('hex');
  jiraOauthState.set(state, { domain, expiresAt: Date.now() + 10 * 60 * 1000 });
  return state;
}

function consumeOauthState(state) {
  const row = jiraOauthState.get(state);
  jiraOauthState.delete(state);
  if (!row) return null;
  if (row.expiresAt < Date.now()) return null;
  return row;
}

async function atlassianTokenExchange(payload) {
  const cfg = getJiraConfig();
  const res = await fetch('https://auth.atlassian.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      ...payload,
    }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(out.error_description || out.error || `OAuth token exchange failed (${res.status})`);
  }
  return out;
}

async function atlassianAccessibleResources(accessToken) {
  const res = await fetch('https://api.atlassian.com/oauth/token/accessible-resources', {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  const out = await res.json().catch(() => []);
  if (!res.ok || !Array.isArray(out)) {
    throw new Error(`Could not fetch accessible Jira resources (${res.status})`);
  }
  return out;
}

async function getValidJiraAccess(domain) {
  const cfg = getJiraConfig();
  const saved = readJiraOAuth(domain);
  if (!saved?.refreshToken) return null;
  const now = Date.now();
  if (saved.accessToken && Number(saved.expiresAt || 0) > now + 60 * 1000) {
    return saved;
  }
  const refreshed = await atlassianTokenExchange({
    grant_type: 'refresh_token',
    refresh_token: saved.refreshToken,
  });
  const next = {
    ...saved,
    accessToken: refreshed.access_token,
    refreshToken: refreshed.refresh_token || saved.refreshToken,
    expiresAt: Date.now() + Number(refreshed.expires_in || 3600) * 1000,
    updatedAt: new Date().toISOString(),
  };
  writeJiraOAuth(domain, next);
  return next;
}

function runStatePatch(domain, runId, patch) {
  const key = runKey(domain, runId);
  const prev = runStatus.get(key) || {};
  const next = { ...prev, ...patch, domain, runId };
  runStatus.set(key, next);
  dbUpsertRun(domain, runId, next).catch((err) => {
    console.error(`[run ${domain}/${runId}] DB state update failed:`, err.message);
  });
  void maybeSendRunEmail(domain, runId);
}

async function maybeSendRunEmail(domain, runId) {
  const key = runKey(domain, runId);
  if (notificationAttempted.has(key)) return;
  const cur = runStatus.get(key);
  if (!cur?.notifyRequested || !cur.notifyEmail) return;
  if (cur.status !== 'done' && cur.status !== 'error') return;
  notificationAttempted.add(key);
  const base = (process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 3456}`).replace(
    /\/$/,
    ''
  );
  const reportUrl = `${base}/report/${domain}/${runId}/`;
  if (!createSmtpTransport()) {
    console.warn(
      `[run ${domain}/${runId}] Notification requested for ${cur.notifyEmail} but SMTP is not configured (set SMTP_HOST and related env vars).`
    );
    return;
  }
  try {
    await sendRunNotificationEmail({
      to: cur.notifyEmail,
      reportId: `${domain}/${runId}`,
      status: cur.status,
      error: cur.error || null,
      reportUrl,
    });
  } catch (err) {
    console.error(`[run ${domain}/${runId}] Notification email failed:`, err.message);
  }
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024 },
});

function extractUrlsFromText(text) {
  if (!text || typeof text !== 'string') return [];
  const urlRegex = /https?:\/\/[^\s"'<>,\|]+/g;
  const matches = text.match(urlRegex) || [];
  return [...new Set(matches.map((u) => u.replace(/[.,;:!?)]+$/, '')))];
}

function normalizeDomainFromUrl(input) {
  try {
    const u = new URL(input);
    return (u.hostname || '').toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function getSingleDomainKey(urls) {
  const domains = [...new Set((urls || []).map((u) => normalizeDomainFromUrl(u)).filter(Boolean))];
  if (domains.length !== 1) return null;
  return domains[0];
}

function parseCsv(buffer) {
  const text = buffer.toString('utf8');
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const urls = [];
  for (const line of lines) {
    const parts = line.split(/[,\t]/).map((p) => p.trim().replace(/^["']|["']$/g, ''));
    for (const p of parts) {
      if (p.startsWith('http')) urls.push(p);
    }
  }
  return [...new Set(urls)];
}

/** Pull every &lt;loc&gt; value from a sitemap-shaped XML string. */
function extractLocs(text) {
  const out = [];
  for (const m of text.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)) {
    const v = m[1].trim();
    if (v) out.push(v);
  }
  return out;
}

/**
 * Parse a sitemap (or sitemapindex) buffer and resolve to a flat list of page URLs.
 * Follows nested &lt;sitemapindex&gt; entries by HTTP-fetching each child sitemap.
 *
 * @param {Buffer} buffer Initial sitemap XML (uploaded by the user).
 * @param {{ maxDepth?: number, maxUrls?: number }} [opts]
 * @returns {Promise<string[]>}
 */
async function parseSitemapBuffer(buffer, opts = {}) {
  const maxDepth = Number.isFinite(opts.maxDepth) ? opts.maxDepth : 3;
  const maxUrls = Number.isFinite(opts.maxUrls) && opts.maxUrls > 0 ? opts.maxUrls : 5000;

  /** @type {Set<string>} */
  const pageUrls = new Set();
  /** @type {Set<string>} */
  const seenSitemaps = new Set();

  /**
   * @param {string} text
   * @param {number} depth
   * @param {string | null} sourceUrl - URL of the sitemap we are currently parsing (null for the initial upload)
   */
  async function walk(text, depth, sourceUrl) {
    if (pageUrls.size >= maxUrls) return;
    const isIndex = /<sitemapindex[\s>]/i.test(text);
    const locs = extractLocs(text);
    if (isIndex) {
      if (depth >= maxDepth) {
        console.warn(`[sitemap] depth ${depth} exceeded at ${sourceUrl || '<upload>'}; skipping nested sitemaps`);
        return;
      }
      for (const loc of locs) {
        if (pageUrls.size >= maxUrls) break;
        if (!/^https?:\/\//i.test(loc)) continue;
        if (loc.toLowerCase().endsWith('.gz')) {
          console.warn(`[sitemap] skipping gzip child sitemap (not supported): ${loc}`);
          continue;
        }
        if (seenSitemaps.has(loc)) continue;
        seenSitemaps.add(loc);
        try {
          const res = await fetch(loc, { redirect: 'follow' });
          if (!res.ok) {
            console.warn(`[sitemap] HTTP ${res.status} for ${loc}`);
            continue;
          }
          const childText = await res.text();
          await walk(childText, depth + 1, loc);
        } catch (err) {
          console.warn(`[sitemap] failed to fetch ${loc}: ${err?.message || err}`);
        }
      }
    } else {
      for (const loc of locs) {
        if (pageUrls.size >= maxUrls) break;
        if (!/^https?:\/\//i.test(loc)) continue;
        pageUrls.add(loc);
      }
    }
  }

  await walk(buffer.toString('utf8'), 0, null);
  return [...pageUrls];
}

const STATEMENT_MAX = 2000;

function clipStatement(s, max = STATEMENT_MAX) {
  if (typeof s !== 'string') return '';
  return s.trim().slice(0, max);
}

/** Fields from the run form; used only to pre-fill accessibility-statement.html */
function parseStatementMeta(body) {
  const rd = parseInt(String(body?.statement_response_days ?? '').trim(), 10);
  return {
    orgName: clipStatement(body?.statement_org_name ?? ''),
    orgShortName: clipStatement(body?.statement_org_short ?? '', 200),
    phone: clipStatement(body?.statement_phone ?? '', 120),
    email: clipStatement(body?.statement_email ?? '', 200),
    visitorAddress: clipStatement(body?.statement_visitor_address ?? ''),
    postalAddress: clipStatement(body?.statement_postal_address ?? ''),
    responseDays: Number.isFinite(rd) && rd > 0 && rd <= 365 ? rd : null,
  };
}

export function createAccessibilityApp(repoRoot) {
  if (typeof repoRoot !== 'string' || !repoRoot) {
    throw new Error('createAccessibilityApp(repoRoot): repoRoot must be a non-empty path string');
  }
  AUTH_ENABLED = parseBooleanEnv('AUTH_ENABLED', true);
  APP_USERNAME = String(process.env.APP_USERNAME ?? 'root').trim() || 'root';
  APP_PASSWORD = String(process.env.APP_PASSWORD ?? 'root').trim() || 'root';
  const sameSiteRaw = String(process.env.AUTH_COOKIE_SAMESITE || 'Lax').trim();
  AUTH_COOKIE_SAMESITE = ['Lax', 'Strict', 'None'].includes(sameSiteRaw) ? sameSiteRaw : 'Lax';
  const loadingPath = '/loading';

  const app = express();

// CORS: set ALLOWED_ORIGIN to your UI origin (no trailing slash) when using PUBLIC_APP_BASE / split hosting.
// RELAX_CORS_LOCALHOST=true + browser hitting PUBLIC_DEV_API_URL lets `astro dev` call :3456 without the Vite proxy (fixes many multipart 403s).
const allowedOrigin = String(process.env.ALLOWED_ORIGIN || '*').trim() || '*';
const relaxCorsLocalhost = parseBooleanEnv('RELAX_CORS_LOCALHOST', false);
function isLocalhostBrowserOrigin(o) {
  try {
    const u = new URL(o);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    const h = u.hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1';
  } catch {
    return false;
  }
}
app.use((req, res, next) => {
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin.trim() : '';
  // Local dev: reflect browser Origin so credentialed calls to :3456 work even when ALLOWED_ORIGIN is set for prod.
  if (relaxCorsLocalhost && origin && isLocalhostBrowserOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
  } else if (allowedOrigin !== '*') {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-App-Username, X-App-Password');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

/** Safe post-login redirect: relative path, or absolute URL matching ALLOWED_ORIGIN. */
function safeNextAfterLogin(raw) {
  if (typeof raw !== 'string') return '/';
  const t = raw.trim();
  if (!t) return '/';
  if (t.startsWith('/') && !t.startsWith('//')) return t.slice(0, 2048);
  const uiOrigin = String(process.env.ALLOWED_ORIGIN || '').trim();
  if (!uiOrigin || uiOrigin === '*') return '/';
  try {
    const allowed = new URL(uiOrigin).origin;
    const u = new URL(t);
    if (u.origin === allowed) return t.slice(0, 2048);
  } catch {
    /* ignore */
  }
  return '/';
}

function parseCookies(req) {
  const raw = req.headers.cookie || '';
  const out = {};
  raw.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (!k) return;
    out[k] = decodeURIComponent(v);
  });
  return out;
}

function parseBasicAuth(req) {
  const raw = req.headers.authorization;
  if (typeof raw !== 'string' || !raw.startsWith('Basic ')) return null;
  try {
    const decoded = Buffer.from(raw.slice(6), 'base64').toString('utf8');
    const i = decoded.indexOf(':');
    if (i === -1) return null;
    return { user: decoded.slice(0, i), pass: decoded.slice(i + 1) };
  } catch {
    return null;
  }
}

/** Username + password from Basic auth, headers, or query (legacy single-password queries use default username). */
function credentialsFromRequest(req) {
  const basic = parseBasicAuth(req);
  if (basic) return basic;
  const headerPwd = req.headers['x-app-password'];
  if (typeof headerPwd === 'string' && headerPwd) {
    const headerUser = req.headers['x-app-username'];
    const user = typeof headerUser === 'string' && headerUser.trim() ? headerUser.trim() : APP_USERNAME;
    return { user, pass: headerPwd };
  }
  const qp = req.query?.password;
  if (typeof qp === 'string' && qp) {
    const qu = req.query?.username;
    const user = typeof qu === 'string' && qu.trim() ? qu.trim() : APP_USERNAME;
    return { user, pass: qp };
  }
  return null;
}

function credentialsValid(user, pass) {
  return String(user || '') === String(APP_USERNAME) && String(pass || '') === String(APP_PASSWORD);
}

function setAuthCookie(res) {
  const useSecure = AUTH_COOKIE_SAMESITE === 'None' ? true : AUTH_COOKIE_SECURE;
  const securePart = useSecure ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${AUTH_COOKIE_NAME}=1; Path=/; HttpOnly; SameSite=${AUTH_COOKIE_SAMESITE}; Max-Age=43200${securePart}`
  );
}

function clearAuthCookie(res) {
  const useSecure = AUTH_COOKIE_SAMESITE === 'None' ? true : AUTH_COOKIE_SECURE;
  const securePart = useSecure ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${AUTH_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=${AUTH_COOKIE_SAMESITE}; Max-Age=0${securePart}`
  );
}

function loginPageHtml(nextPath = '', errorMessage = '') {
  const safeNext = String(nextPath || '/')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;');
  const esc =
    typeof errorMessage === 'string'
      ? errorMessage
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/"/g, '&quot;')
      : '';
  const safeError = esc ? `<p class="login-error" role="alert">${esc}</p>` : '';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex, nofollow, noarchive, nosnippet, noimageindex" />
  <title>Sign in · Accessibility reports</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..800&family=Public+Sans:ital,wght@0,300..900;1,400..700&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: "Public Sans", system-ui, sans-serif;
      color: #19191B;
      overflow-x: hidden;
    }
    .login-scene {
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 24px;
      position: relative;
      background: #F5F4E5;
    }
    .login-scene::before {
      content: "";
      position: absolute;
      inset: -20%;
      background:
        radial-gradient(ellipse 50% 40% at 20% 30%, rgba(255,185,133,0.45), transparent 55%),
        radial-gradient(ellipse 45% 35% at 85% 20%, rgba(189,180,255,0.5), transparent 50%),
        radial-gradient(ellipse 40% 45% at 70% 85%, rgba(141,255,183,0.35), transparent 55%),
        radial-gradient(ellipse 35% 30% at 10% 80%, rgba(167,240,251,0.4), transparent 50%);
      filter: blur(2px);
      z-index: 0;
    }
    .login-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(25,25,27,0.12);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      z-index: 1;
    }
    .glass-panel {
      position: relative;
      z-index: 2;
      width: min(420px, 100%);
      padding: 32px 28px 30px;
      border-radius: 20px;
      background: rgba(255,255,255,0.28);
      border: 1px solid rgba(255,255,255,0.55);
      box-shadow:
        0 4px 24px rgba(25,25,27,0.08),
        inset 0 1px 0 rgba(255,255,255,0.65);
      backdrop-filter: blur(22px) saturate(1.35);
      -webkit-backdrop-filter: blur(22px) saturate(1.35);
    }
    .glass-panel h1 {
      font-family: "Bricolage Grotesque", ui-serif, Georgia, serif;
      margin: 0 0 6px;
      font-size: 1.45rem;
      letter-spacing: -0.02em;
    }
    .glass-panel .lead {
      margin: 0 0 22px;
      font-size: 0.95rem;
      color: #494949;
      line-height: 1.45;
    }
    .login-error {
      margin: 0 0 14px;
      padding: 10px 12px;
      border-radius: 10px;
      background: rgba(135,32,18,0.08);
      color: #872012;
      font-size: 0.9rem;
    }
    label {
      display: block;
      margin: 14px 0 6px;
      font-weight: 600;
      font-size: 0.82rem;
      letter-spacing: 0.02em;
      text-transform: uppercase;
      color: #2E2E2E;
    }
    label:first-of-type { margin-top: 0; }
    input {
      width: 100%;
      padding: 12px 14px;
      border: 1px solid rgba(25,25,27,0.12);
      border-radius: 12px;
      font-size: 1rem;
      font-family: inherit;
      background: rgba(255,255,255,0.55);
      color: #19191B;
    }
    input:focus {
      outline: 2px solid #6257E8;
      outline-offset: 2px;
      border-color: transparent;
    }
    button {
      margin-top: 22px;
      width: 100%;
      padding: 12px 16px;
      border: none;
      border-radius: 12px;
      font-family: "Bricolage Grotesque", ui-serif, Georgia, serif;
      font-weight: 700;
      font-size: 1rem;
      cursor: pointer;
      color: #fff;
      background: linear-gradient(135deg, #19191B 0%, #423A75 100%);
      box-shadow: 0 4px 16px rgba(25,25,27,0.2);
    }
    button:hover {
      filter: brightness(1.06);
    }
  </style>
</head>
<body>
  <div class="login-scene">
    <div class="login-backdrop" aria-hidden="true"></div>
    <form class="glass-panel" method="post" action="/auth/login" aria-labelledby="login-title">
      <h1 id="login-title">Sign in</h1>
      <p class="lead">Enter your username and password to access reports and APIs.</p>
      ${safeError}
      <input type="hidden" name="next" value="${safeNext}" />
      <label for="username">Username</label>
      <input id="username" name="username" type="text" autocomplete="username" required autofocus />
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required />
      <button type="submit">Continue</button>
    </form>
  </div>
</body>
</html>`;
}

app.use((req, res, next) => {
  if (!isIndexablePath(req.path)) {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet, noimageindex');
  }
  next();
});

app.get('/robots.txt', (_req, res) => {
  res.type('text/plain');
  res.send(
    [
      'User-agent: *',
      'Allow: /',
      'Allow: /teaser/',
      'Disallow: /api/',
      'Disallow: /report/',
      'Disallow: /audits',
      'Disallow: /admin/',
      'Disallow: /auth/',
      'Disallow: /loading',
      '',
    ].join('\n')
  );
});

app.get('/design-system.css', (_req, res) => {
  const p = join(repoRoot, 'public', 'design-system.css');
  if (existsSync(p)) res.sendFile(p);
  else res.status(404).send('/* design-system.css not found */');
});

app.get('/auth/login', (req, res) => {
  if (!AUTH_ENABLED) return res.redirect('/');
  const nextPath = safeNextAfterLogin(typeof req.query.next === 'string' ? req.query.next : '/');
  return res.status(200).send(loginPageHtml(nextPath));
});

app.post('/auth/login', (req, res) => {
  if (!AUTH_ENABLED) return res.redirect('/');
  const nextPath = safeNextAfterLogin(typeof req.body?.next === 'string' ? req.body.next : '/');
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  if (!credentialsValid(username, password)) {
    return res.status(401).send(loginPageHtml(nextPath, 'Invalid username or password. Try again.'));
  }
  setAuthCookie(res);
  return res.redirect(nextPath);
});

app.get('/auth/logout', (req, res) => {
  if (!AUTH_ENABLED) return res.redirect('/');
  clearAuthCookie(res);
  const nextPath = typeof req.query?.next === 'string' ? safeNextAfterLogin(req.query.next) : '/auth/login';
  return res.redirect(302, nextPath);
});

app.get('/auth/jira/connect', (req, res) => {
  const cfg = getJiraConfig();
  const domain = String(req.query?.domain || '').trim().toLowerCase();
  if (!cfg.clientId || !cfg.clientSecret || !cfg.redirectUri) {
    return res.status(501).send('Atlassian OAuth not configured on server.');
  }
  if (!isValidDomain(domain)) {
    return res.status(400).send('Invalid domain.');
  }
  const state = newOauthState(domain);
  const u = new URL('https://auth.atlassian.com/authorize');
  u.searchParams.set('audience', 'api.atlassian.com');
  u.searchParams.set('client_id', cfg.clientId);
  u.searchParams.set('scope', 'read:jira-work write:jira-work offline_access');
  u.searchParams.set('redirect_uri', cfg.redirectUri);
  u.searchParams.set('state', state);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('prompt', 'consent');
  return res.redirect(u.toString());
});

app.get('/auth/jira/callback', async (req, res) => {
  const cfg = getJiraConfig();
  const code = String(req.query?.code || '');
  const state = String(req.query?.state || '');
  if (!cfg.clientId || !cfg.clientSecret || !cfg.redirectUri) {
    return res.status(501).send('Atlassian OAuth not configured on server.');
  }
  const fromState = consumeOauthState(state);
  if (!fromState) return res.status(400).send('Invalid or expired OAuth state.');
  try {
    const tok = await atlassianTokenExchange({
      grant_type: 'authorization_code',
      code,
      redirect_uri: cfg.redirectUri,
    });
    const resources = await atlassianAccessibleResources(tok.access_token);
    const jiraSite = resources.find((r) => Array.isArray(r.scopes) && r.scopes.some((s) => s.includes('jira')));
    if (!jiraSite?.id) throw new Error('No Jira site granted for this account.');
    writeJiraOAuth(fromState.domain, {
      domain: fromState.domain,
      cloudId: jiraSite.id,
      siteUrl: jiraSite.url || '',
      siteName: jiraSite.name || '',
      accessToken: tok.access_token,
      refreshToken: tok.refresh_token,
      expiresAt: Date.now() + Number(tok.expires_in || 3600) * 1000,
      connectedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    return res
      .status(200)
      .type('html')
      .send('<!doctype html><title>Jira connected</title><script>window.close();</script><p>Jira connected. You can close this window.</p>');
  } catch (err) {
    return res.status(500).send(`Jira OAuth failed: ${err?.message || err}`);
  }
});

app.get('/api/auth/status', (req, res) => {
  if (!AUTH_ENABLED) return res.json({ authEnabled: false, authenticated: true, role: 'staff' });
  const cookies = parseCookies(req);
  const authenticated = cookies[AUTH_COOKIE_NAME] === '1';
  return res.json({
    authEnabled: true,
    authenticated,
    role: authenticated ? 'staff' : 'guest',
  });
});

app.get('/api/config', (_req, res) => {
  res.json({
    authEnabled: AUTH_ENABLED,
    ...publicConfig(),
  });
});

app.post('/api/auth/login', (req, res) => {
  if (!AUTH_ENABLED) return res.json({ ok: true });
  const username = String(req.body?.username ?? '').trim();
  const password = String(req.body?.password ?? '');
  if (!credentialsValid(username, password)) {
    return res.status(401).json({ error: 'Invalid username or password.' });
  }
  setAuthCookie(res);
  return res.json({ ok: true });
});

app.post('/api/auth/logout', (req, res) => {
  if (!AUTH_ENABLED) return res.json({ ok: true });
  clearAuthCookie(res);
  return res.json({ ok: true });
});

app.post('/api/access-request', async (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  const company = String(req.body?.company ?? '').trim();
  const email = String(req.body?.email ?? '').trim();
  const message = String(req.body?.message ?? '').trim();
  if (!name || !email) {
    return res.status(400).json({ error: 'Name and email are required.' });
  }
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'Enter a valid email address.' });
  }
  try {
    const { emailed } = await sendAccessRequestEmail({ name, company, email, message });
    return res.json({ ok: true, emailed });
  } catch (err) {
    console.error('[access-request]', err?.message || err);
    return res.status(500).json({ error: 'Could not submit your request. Try again later.' });
  }
});

app.use((req, res, next) => {
  if (!AUTH_ENABLED) {
    req.access = { role: 'staff' };
    return next();
  }
  if (req.path === '/robots.txt') return next();
  if (req.path === '/auth/login') return next();
  if (req.path === '/auth/logout') return next();
  if (req.path.startsWith('/auth/jira/')) return next();
  if (req.path === '/api/config') return next();
  /** Public GETs: loading shell + static assets (styles/scripts while session cookie is set). */
  if (
    req.method === 'GET' &&
    (req.path === '/loading' ||
      req.path.startsWith('/assets/') ||
      req.path.startsWith('/styles/') ||
      req.path.startsWith('/_astro/'))
  ) {
    return next();
  }

  const cookies = parseCookies(req);
  const hasSession = cookies[AUTH_COOKIE_NAME] === '1';
  const creds = credentialsFromRequest(req);
  let authed = hasSession;
  if (!authed && creds && credentialsValid(creds.user, creds.pass)) {
    setAuthCookie(res);
    authed = true;
    if (
      !req.path.startsWith('/api/') &&
      (typeof req.query?.password === 'string' || typeof req.query?.username === 'string')
    ) {
      const cleanQuery = { ...req.query };
      delete cleanQuery.password;
      delete cleanQuery.username;
      const qs = new URLSearchParams(cleanQuery).toString();
      const target = `${req.path}${qs ? `?${qs}` : ''}`;
      return res.redirect(target);
    }
  }
  if (authed) {
    req.access = { role: 'staff' };
    return next();
  }

  if (isGuestOpenPath(req)) {
    req.access = { role: 'guest' };
    return next();
  }

  /** Main domain: serve glass login at `/` unless the Node host defers to an Astro shell (web/run-server.mjs). */
  if (req.method === 'GET' && req.path === '/') {
    if (parseBooleanEnv('DEFER_ROOT_LOGIN_TO_SHELL', false)) {
      req.access = { role: 'guest' };
      return next();
    }
    return res.status(200).send(loginPageHtml('/'));
  }

  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const nextPath = safeNextAfterLogin(req.originalUrl || '/');
  return res.redirect(`/auth/login?next=${encodeURIComponent(nextPath)}`);
});

app.post('/api/run', upload.single('file'), async (req, res) => {
  const staff = requestIsStaff(req);
  const ip = clientIp(req);
  let urls = [];

  if (!staff) {
    if (req.file) {
      return res.status(400).json({ error: 'File uploads are available after you sign in.' });
    }
    try {
      await verifyTurnstileIfConfigured(req.body?.turnstileToken || req.body?.['cf-turnstile-response'], ip);
      const rawUrl = String(req.body?.url || req.body?.urls || '').trim();
      const canonical = await assertPublicHttpUrl(rawUrl);
      urls = [canonical];
      checkGuestRateLimit(ip);
      if (guestIpHasRunningScan(ip)) {
        return res.status(409).json({ error: 'A free scan is already running from this network. Please wait for it to finish.' });
      }
    } catch (err) {
      const status = Number(err?.status) || 400;
      return res.status(status).json({ error: err.message || 'Could not start the scan.' });
    }
  } else {
    const urlText = req.body?.urls || '';
    if (urlText.trim()) {
      urls = extractUrlsFromText(urlText);
    }
  }

  const maxUrls = staff ? (process.env.MAX_URLS_PER_RUN ? parseInt(process.env.MAX_URLS_PER_RUN, 10) : 0) : 1;

  if (staff && req.file) {
    const buf = req.file.buffer;
    const name = (req.file.originalname || '').toLowerCase();
    if (name.endsWith('.csv')) {
      urls = [...urls, ...parseCsv(buf)];
    } else if (name.endsWith('.xml')) {
      try {
        const fromSitemap = await parseSitemapBuffer(buf, {
          maxUrls: maxUrls > 0 ? maxUrls * 2 : 5000,
        });
        urls = [...urls, ...fromSitemap];
      } catch (err) {
        return res.status(400).json({ error: `Could not parse sitemap: ${err?.message || err}` });
      }
    } else {
      urls = [...urls, ...extractUrlsFromText(buf.toString('utf8'))];
    }
  }

  urls = [...new Set(urls)].filter((u) => u.startsWith('http'));
  const requestedUrls = urls.length;

  if (urls.length === 0) {
    return res.status(400).json({
      error: staff
        ? 'No valid URLs provided. Add URLs in the text area or upload a CSV/XML file.'
        : 'Enter one public http(s) URL to scan.',
    });
  }

  if (maxUrls > 0 && urls.length > maxUrls) {
    urls = urls.slice(0, maxUrls);
  }
  const processedUrls = urls.length;
  const truncated = processedUrls < requestedUrls;

  const { notifyOnComplete, notifyEmail } = staff
    ? parseNotifyFields(req.body || {})
    : { notifyOnComplete: false, notifyEmail: '' };
  if (staff && notifyOnComplete && !isValidEmail(notifyEmail)) {
    return res.status(400).json({
      error:
        'Enter a valid e-mail address to receive a notification when tests finish (or uncheck that option).',
    });
  }

  if (scanPoolFull(runStatus)) {
    return res.status(429).json({ error: 'The scanner is busy. Try again in a few minutes.' });
  }

  const domainKey = getSingleDomainKey(urls);
  if (!domainKey) {
    return res.status(400).json({
      error: 'Please provide URLs from one domain per run. Mixed-domain runs are not supported.',
    });
  }

  const domain = domainKey;
  // Allow multiple runs per domain over time; only block if one is currently running.
  const concurrent = findRunningRun(runStatus, domain);
  if (concurrent) {
    return res.status(409).json({
      error: `A run for ${domain} is already in progress. Please wait for it to finish.`,
    });
  }
  const runId = newRunId();
  const key = runKey(domain, runId);
  const guestToken = staff ? null : newGuestToken();

  const reportDir = runDirOf(domain, runId);
  if (!existsSync(reportDir)) mkdirSync(reportDir, { recursive: true });

  const statementMeta = staff ? parseStatementMeta(req.body || {}) : {};
  try {
    writeFileSync(join(reportDir, 'statement-meta.json'), JSON.stringify(statementMeta, null, 2), 'utf8');
  } catch (err) {
    console.error('statement-meta write failed:', err.message);
  }

  const initialState = {
    domain,
    runId,
    status: 'running',
    urls: processedUrls,
    requestedUrls,
    processedUrls,
    truncated,
    error: null,
    notifyRequested: !!(notifyOnComplete && notifyEmail),
    notifyEmail: notifyOnComplete && notifyEmail ? notifyEmail : null,
    tier: staff ? 'staff' : 'guest',
    guestToken,
    guestIp: staff ? null : ip,
    guestUrl: staff ? null : urls[0],
  };
  notificationAttempted.delete(key);
  runStatus.set(key, initialState);
  if (!staff) {
    trackGuestRunStart(ip);
    persistGuestToken(guestToken, { domain, runId, url: urls[0], ip });
  }
  dbUpsertRun(domain, runId, { ...initialState, statementMeta }).catch((err) => {
    console.error(`[run ${domain}/${runId}] DB initial write failed:`, err.message);
  });

  const urlsArg = urls.join('\n');
  const child = spawn(
    process.execPath,
    [
      join(repoRoot, 'run-tests.js'),
      '--report',
      `--urls=${urlsArg}`,
      `--output-id=${domain}/${runId}`,
    ],
    {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );

  let stderr = '';
  child.stderr?.on('data', (d) => { stderr += d.toString(); });
  child.stdout?.on('data', () => {});

  child.on('close', (code) => {
    const cur = runStatus.get(key);
    if (cur?.tier === 'guest' && cur.guestIp) {
      trackGuestRunEnd(cur.guestIp);
      cur.guestIp = null;
    }
    const reportPath = join(reportDir, 'accessibility-report.html');
    const resultsPath = join(reportDir, 'accessibility-results.json');

    if (code === 0 && existsSync(reportPath)) {
      finalizeSuccessfulRun({ domain, runId, reportDir, processedUrls, requestedUrls, truncated })
        .then((ok) => {
          if (!ok) {
            runStatePatch(domain, runId, { status: 'error', urls: processedUrls, processedUrls, requestedUrls, truncated, error: 'Report generation failed.' });
          }
        })
        .catch((err) => {
          runStatePatch(domain, runId, { status: 'error', urls: processedUrls, processedUrls, requestedUrls, truncated, error: err.message });
        });
      return;
    }
    if (code === 0 && !existsSync(reportPath)) {
      const pollForReport = (attempts = 0) => {
        if (existsSync(reportPath)) {
          finalizeSuccessfulRun({ domain, runId, reportDir, processedUrls, requestedUrls, truncated })
            .then((ok) => {
              if (!ok) {
                runStatePatch(domain, runId, { status: 'error', urls: processedUrls, processedUrls, requestedUrls, truncated, error: 'Report generation failed.' });
              }
            })
            .catch((err) => {
              runStatePatch(domain, runId, { status: 'error', urls: processedUrls, processedUrls, requestedUrls, truncated, error: err.message });
            });
          return;
        }
        if (attempts < 5) {
          setTimeout(() => pollForReport(attempts + 1), 500);
        } else if (existsSync(resultsPath)) {
          (async () => {
            try {
              const { generateReport } = await import(GENERATE_REPORT_URL);
              generateReport(null, { outputDir: reportDir });
              if (existsSync(reportPath)) {
                const ok = await finalizeSuccessfulRun({ domain, runId, reportDir, processedUrls, requestedUrls, truncated });
                if (!ok) {
                  runStatePatch(domain, runId, { status: 'error', urls: processedUrls, processedUrls, requestedUrls, truncated, error: 'Report generation failed.' });
                }
              } else {
                runStatePatch(domain, runId, { status: 'error', urls: processedUrls, processedUrls, requestedUrls, truncated, error: 'Report generation failed.' });
              }
            } catch (err) {
              runStatePatch(domain, runId, { status: 'error', urls: processedUrls, processedUrls, requestedUrls, truncated, error: err.message });
            }
          })();
        } else {
          runStatePatch(domain, runId, {
            status: 'error',
            urls: processedUrls,
            processedUrls,
            requestedUrls,
            truncated,
            error: 'Report file was not created.',
          });
        }
      };
      pollForReport();
      return;
    }
    runStatePatch(domain, runId, {
      status: 'error',
      urls: processedUrls,
      processedUrls,
      requestedUrls,
      truncated,
      error: stderr || `Process exited with code ${code}`,
    });
  });

  child.on('error', (err) => {
    const cur = runStatus.get(key);
    if (cur?.tier === 'guest' && cur.guestIp) {
      trackGuestRunEnd(cur.guestIp);
      cur.guestIp = null;
    }
    runStatePatch(domain, runId, {
      status: 'error',
      urls: processedUrls,
      processedUrls,
      requestedUrls,
      truncated,
      error: err.message,
    });
  });

  res.json({
    domain,
    runId,
    id: domain,
    reportId: domain,
    urls: processedUrls,
    processedUrls,
    requestedUrls,
    truncated,
    maxUrls: maxUrls > 0 ? maxUrls : null,
    guestToken: guestToken || undefined,
    teaser: !staff,
  });
});

async function resolveStatus({ domain, runId }) {
  if (!isValidDomain(domain) || !isValidRunId(runId)) return { error: 'Invalid run id' };
  const key = runKey(domain, runId);
  let status = runStatus.get(key);
  if (!status && dbPool) {
    try {
      const dbStatus = await dbGetRun(domain, runId);
      if (dbStatus) {
        status = dbStatus;
        runStatus.set(key, dbStatus);
      }
    } catch (err) {
      console.error(`[run ${domain}/${runId}] DB status lookup failed:`, err.message);
    }
  }
  const reportPath = join(runDirOf(domain, runId), 'accessibility-report.html');
  if (!status) {
    if (existsSync(reportPath)) return { status: 'done', urls: 0 };
    const remote = await ftpDownload(FTP_CONFIG, `${domain}/${runId}/accessibility-report.html`);
    if (remote) return { status: 'done', urls: 0 };
    return null;
  }
  return {
    status: status.status,
    urls: status.urls,
    processedUrls: status.processedUrls ?? status.urls,
    requestedUrls: status.requestedUrls ?? status.urls,
    truncated: !!status.truncated,
    error: status.error,
  };
}

app.get('/api/status/:domain/:runId', async (req, res) => {
  const { domain, runId } = req.params;
  const out = await resolveStatus({ domain, runId });
  if (!out) return res.status(404).json({ error: 'Run not found' });
  if (out.error === 'Invalid run id') return res.status(400).json({ error: out.error });
  res.json(out);
});

/** Legacy: /api/status/:id resolves to the latest run for that domain. */
app.get('/api/status/:id', async (req, res) => {
  const domain = req.params.id;
  if (!isValidDomain(domain)) return res.status(400).json({ error: 'Invalid domain' });
  const running = findRunningRun(runStatus, domain);
  let runId = running?.runId || null;
  if (!runId) {
    if (dbPool) {
      try {
        const latest = await dbGetLatestRun(domain);
        if (latest) runId = latest.runId;
      } catch (err) {
        console.error(`[domain ${domain}] DB latest lookup failed:`, err.message);
      }
    }
  }
  if (!runId) runId = latestRunIdOnDisk(domain);
  if (!runId) return res.status(404).json({ error: 'Run not found' });
  const out = await resolveStatus({ domain, runId });
  if (!out) return res.status(404).json({ error: 'Run not found' });
  if (out.error === 'Invalid run id') return res.status(400).json({ error: out.error });
  res.json({ ...out, runId });
});

async function resolveGuestBinding(token) {
  if (!isValidGuestToken(token)) return null;
  const fromFile = readGuestTokenRecord(token);
  if (fromFile) return fromFile;
  if (dbPool) {
    try {
      const row = await dbGetRunByGuestToken(token);
      if (row) return { domain: row.domain, runId: row.runId, url: null };
    } catch (err) {
      console.error('[guest-token] DB lookup failed:', err.message);
    }
  }
  return null;
}

app.get('/api/guest/:token/status', async (req, res) => {
  const token = String(req.params.token || '');
  const binding = await resolveGuestBinding(token);
  if (!binding) return res.status(404).json({ error: 'Scan not found' });
  const out = await resolveStatus({ domain: binding.domain, runId: binding.runId });
  if (!out) return res.status(404).json({ error: 'Scan not found' });
  if (out.error === 'Invalid run id') return res.status(400).json({ error: out.error });
  return res.json({
    status: out.status,
    error: out.error || null,
    urls: 1,
    processedUrls: out.processedUrls ?? 1,
  });
});

app.get('/api/guest/:token/teaser', async (req, res) => {
  const token = String(req.params.token || '');
  const binding = await resolveGuestBinding(token);
  if (!binding) return res.status(404).json({ error: 'Scan not found' });
  const out = await resolveStatus({ domain: binding.domain, runId: binding.runId });
  if (!out) return res.status(404).json({ error: 'Scan not found' });
  if (out.status !== 'done') {
    return res.status(409).json({ error: 'Scan is not finished yet.', status: out.status });
  }
  const key = runKey(binding.domain, binding.runId);
  let resultJson = runStatus.get(key)?.resultJson || null;
  if (!resultJson && dbPool) {
    try {
      const row = await dbGetRun(binding.domain, binding.runId);
      resultJson = row?.resultJson || null;
    } catch (err) {
      console.error('[teaser] DB read failed:', err.message);
    }
  }
  if (!resultJson) {
    resultJson = readJsonIfExists(join(runDirOf(binding.domain, binding.runId), 'accessibility-results.json'));
  }
  if (!resultJson) return res.status(404).json({ error: 'Results are not available yet.' });
  const teaser = buildTeaserPayload(resultJson, {
    domain: binding.domain,
    url: binding.url,
  });
  return res.json(teaser);
});

app.post('/api/lead', async (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  const company = String(req.body?.company ?? '').trim();
  const email = String(req.body?.email ?? '').trim();
  const phone = String(req.body?.phone ?? '').trim().slice(0, 80);
  const message = String(req.body?.message ?? '').trim().slice(0, 4000);
  const token = String(req.body?.token ?? '').trim();
  if (!name || !email) {
    return res.status(400).json({ error: 'Name and email are required.' });
  }
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'Enter a valid email address.' });
  }
  let scannedUrl = '';
  let domain = '';
  let score = null;
  if (token) {
    const binding = await resolveGuestBinding(token);
    if (binding) {
      domain = binding.domain;
      scannedUrl = binding.url || '';
      try {
        const out = await resolveStatus({ domain: binding.domain, runId: binding.runId });
        if (out?.status === 'done') {
          const key = runKey(binding.domain, binding.runId);
          let resultJson = runStatus.get(key)?.resultJson || null;
          if (!resultJson && dbPool) {
            const row = await dbGetRun(binding.domain, binding.runId);
            resultJson = row?.resultJson || null;
          }
          if (!resultJson) {
            resultJson = readJsonIfExists(join(runDirOf(binding.domain, binding.runId), 'accessibility-results.json'));
          }
          if (resultJson) {
            const teaser = buildTeaserPayload(resultJson, { domain, url: scannedUrl });
            score = teaser.score;
            scannedUrl = teaser.url || scannedUrl;
          }
        }
      } catch (err) {
        console.error('[lead] teaser lookup failed:', err.message);
      }
    }
  }
  const row = {
    name,
    company,
    email,
    phone,
    message,
    scannedUrl,
    domain,
    runToken: token,
    score,
    source: 'scan-teaser',
    cta: 'wcag-services',
  };
  try {
    const { emailed } = await sendLeadEmail(row);
    row.emailed = emailed;
    if (dbPool) {
      try {
        await dbInsertLead(row);
      } catch (err) {
        console.error('[lead] DB insert failed:', err.message);
        appendLeadFile({ ...row, createdAt: new Date().toISOString() });
      }
    } else {
      appendLeadFile({ ...row, createdAt: new Date().toISOString() });
    }
    return res.json({ ok: true, emailed });
  } catch (err) {
    console.error('[lead]', err?.message || err);
    return res.status(500).json({ error: 'Could not submit your request. Try again later.' });
  }
});

app.get('/api/admin/leads', async (_req, res) => {
  try {
    if (dbPool) {
      const leads = await dbListLeads(200);
      return res.json({ leads, source: 'db' });
    }
    return res.json({ leads: readLeadFileRows(200), source: 'file' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.get('/api/health/db', async (req, res) => {
  if (!dbPool) {
    return res.json({ ok: true, db: 'disabled', message: 'DATABASE_URL not configured' });
  }
  try {
    await dbPool.query('SELECT 1');
    return res.json({ ok: true, db: 'up' });
  } catch (err) {
    return res.status(503).json({ ok: false, db: 'down', error: err.message });
  }
});

app.get('/api/jira/oauth/status', async (req, res) => {
  const domain = String(req.query?.domain || '').trim().toLowerCase();
  if (!isValidDomain(domain)) return res.status(400).json({ error: 'Invalid domain' });
  try {
    const token = await getValidJiraAccess(domain);
    if (!token) return res.json({ connected: false });
    return res.json({
      connected: true,
      domain,
      siteName: token.siteName || '',
      siteUrl: token.siteUrl || '',
      connectedAt: token.connectedAt || token.updatedAt || null,
    });
  } catch (err) {
    return res.status(500).json({ error: `Jira token error: ${err?.message || err}` });
  }
});

app.get('/api/jira/projects', async (req, res) => {
  const domain = String(req.query?.domain || '').trim().toLowerCase();
  if (!isValidDomain(domain)) return res.status(400).json({ error: 'Invalid domain' });
  try {
    const token = await getValidJiraAccess(domain);
    if (!token?.accessToken || !token?.cloudId) {
      return res.status(401).json({ error: 'Jira not connected for this domain' });
    }
    const r = await fetch(`https://api.atlassian.com/ex/jira/${token.cloudId}/rest/api/3/project/search?maxResults=100`, {
      headers: { Authorization: `Bearer ${token.accessToken}`, Accept: 'application/json' },
    });
    const out = await r.json().catch(() => ({}));
    if (!r.ok) {
      return res.status(502).json({ error: out?.errorMessages?.join('; ') || `Failed to load Jira projects (${r.status})` });
    }
    const projects = Array.isArray(out?.values)
      ? out.values.map((p) => ({ key: p.key, name: p.name })).filter((p) => p.key && p.name)
      : [];
    return res.json({ projects });
  } catch (err) {
    return res.status(502).json({ error: `Failed to load Jira projects: ${err?.message || err}` });
  }
});

app.post('/api/jira/sprint', async (req, res) => {
  const projectKey = String(req.body?.projectKey || '').trim().toUpperCase();
  const tickets = Array.isArray(req.body?.tickets) ? req.body.tickets : [];
  const domain = String(req.body?.domain || '').trim().toLowerCase();
  const runId = String(req.body?.runId || '').trim();

  if (!isValidDomain(domain)) {
    return res.status(400).json({ error: 'Invalid domain.' });
  }
  if (!/^[A-Z][A-Z0-9_]{1,20}$/.test(projectKey)) {
    return res.status(400).json({ error: 'Invalid Jira project key.' });
  }
  if (!tickets.length) {
    return res.status(400).json({ error: 'No tickets provided.' });
  }

  let token;
  try {
    token = await getValidJiraAccess(domain);
  } catch (err) {
    return res.status(502).json({ error: `Jira token refresh failed: ${err?.message || err}` });
  }
  if (!token?.accessToken || !token?.cloudId) {
    return res.status(401).json({ error: 'Jira is not connected for this domain. Connect first.' });
  }

  const created = [];
  for (const t of tickets) {
    const summary = String(t?.rule || t?.title || '').trim();
    if (!summary) continue;
    const points = Number.isFinite(Number(t?.points)) ? Number(t.points) : null;
    const severity = String(t?.severity || '').toLowerCase();
    const ticketId = String(t?.id || '').trim();
    const labels = ['accessibility', 'auto-generated'];
    if (domain) labels.push(`domain-${domain.replace(/[^a-z0-9-]/gi, '-').toLowerCase()}`);
    const body = {
      fields: {
        project: { key: projectKey },
        issuetype: { name: 'Task' },
        summary: `[A11y] ${summary}`.slice(0, 255),
        description: {
          type: 'doc',
          version: 1,
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: `Generated from accessibility run ${domain}/${runId}.` }],
            },
            {
              type: 'paragraph',
              content: [
                { type: 'text', text: `Source ticket: ${ticketId || 'n/a'} · Severity: ${severity || 'unknown'}` },
              ],
            },
            ...(points != null
              ? [{ type: 'paragraph', content: [{ type: 'text', text: `Estimated effort: ${points} points` }] }]
              : []),
          ],
        },
        labels,
      },
    };
    try {
      const jiraRes = await fetch(`https://api.atlassian.com/ex/jira/${token.cloudId}/rest/api/3/issue`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token.accessToken}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      const out = await jiraRes.json().catch(() => ({}));
      if (!jiraRes.ok) {
        return res.status(502).json({
          error: out?.errorMessages?.join('; ') || out?.errors?.summary || `Jira API error (${jiraRes.status})`,
        });
      }
      created.push({ key: out.key, id: out.id });
    } catch (err) {
      return res.status(502).json({ error: `Failed to reach Jira: ${err?.message || err}` });
    }
  }

  return res.json({ ok: true, createdCount: created.length, issues: created });
});

app.get('/api/audits', async (_req, res) => {
  try {
    const audits = await listAuditEntries(dbPool, REPORTS_BASE);
    return res.json({ audits });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.get('/api/audits/:domain/runs', async (req, res) => {
  const domain = req.params.domain;
  if (!isValidDomain(domain)) return res.status(400).json({ error: 'Invalid domain' });
  try {
    const runs = await listRunsForDomain(dbPool, REPORTS_BASE, domain);
    return res.json({ domain, runs });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

async function finalizeSuccessfulRun({
  domain,
  runId,
  reportDir,
  processedUrls,
  requestedUrls,
  truncated,
}) {
  const resultsPath = join(reportDir, 'accessibility-results.json');
  const reportPath = join(reportDir, 'accessibility-report.html');
  let resultJson = readJsonIfExists(resultsPath);
  if (resultJson && dbPool) {
    try {
      const previous = await dbGetRun(domain, runId);
      resultJson = mergeReportData(previous?.resultJson || null, resultJson);
      writeFileSync(resultsPath, JSON.stringify(resultJson, null, 2), 'utf8');
    } catch (err) {
      console.error(`[run ${domain}/${runId}] DB merge failed:`, err.message);
    }
  }
  if (resultJson) {
    try {
      const { generateReport } = await import(GENERATE_REPORT_URL);
      generateReport(resultJson, { outputDir: reportDir });
    } catch (err) {
      console.error(`[run ${domain}/${runId}] Report regeneration failed:`, err.message);
    }
  }
  if (existsSync(reportPath)) {
    persistReportArtifactsToFtp(domain, runId, FTP_CONFIG).catch((err) => {
      console.error(`[run ${domain}/${runId}] FTP persistence failed:`, err.message);
    });
    runStatePatch(domain, runId, { status: 'done', urls: processedUrls, processedUrls, requestedUrls, truncated, error: null, resultJson });
    return true;
  }
  return false;
}

async function resolveLatestRunIdForDomain(domain) {
  if (!isValidDomain(domain)) return null;
  if (dbPool) {
    try {
      const latest = await dbGetLatestRun(domain);
      if (latest?.runId) return latest.runId;
    } catch {}
  }
  return latestRunIdOnDisk(domain);
}

async function readManualProgress(domain, runId) {
  if (dbPool) {
    try {
      const dbRun = await dbGetRun(domain, runId);
      if (dbRun && dbRun.manualProgress && Array.isArray(dbRun.manualProgress.checked)) {
        return { checked: normalizeManualProgress(dbRun.manualProgress.checked) };
      }
    } catch (err) {
      console.error(`[run ${domain}/${runId}] DB manual-progress lookup failed:`, err.message);
    }
  }
  const filePath = join(runDirOf(domain, runId), 'manual-progress.json');
  let raw = null;
  try {
    raw = await ftpDownload(FTP_CONFIG, `${domain}/${runId}/manual-progress.json`);
  } catch {}
  if (!raw && existsSync(filePath)) raw = readFileSync(filePath, 'utf8');
  if (!raw) return { checked: [] };
  try {
    const data = JSON.parse(raw);
    return { checked: normalizeManualProgress(data.checked) };
  } catch {
    return { checked: [] };
  }
}

app.get('/api/report/:domain/:runId/manual-progress', async (req, res) => {
  const { domain, runId } = req.params;
  if (!isValidDomain(domain) || !isValidRunId(runId)) return res.status(400).json({ error: 'Invalid run id' });
  res.json(await readManualProgress(domain, runId));
});

app.get('/api/report/:id/manual-progress', async (req, res) => {
  const domain = req.params.id;
  if (!isValidDomain(domain)) return res.status(400).json({ error: 'Invalid domain' });
  const runId = await resolveLatestRunIdForDomain(domain);
  if (!runId) return res.json({ checked: [] });
  res.json(await readManualProgress(domain, runId));
});

async function readUrlsForRun(domain, runId) {
  if (dbPool) {
    try {
      const dbRun = await dbGetRun(domain, runId);
      if (dbRun && dbRun.resultJson) {
        const urls = Array.isArray(dbRun.resultJson.urls)
          ? [...new Set(dbRun.resultJson.urls.map((u) => String(u)).filter(Boolean))]
          : [];
        return { urls, source: 'db' };
      }
    } catch (err) {
      console.error(`[run ${domain}/${runId}] DB urls lookup failed:`, err.message);
    }
  }
  const filePath = join(runDirOf(domain, runId), 'accessibility-results.json');
  let raw = null;
  if (existsSync(filePath)) {
    raw = readFileSync(filePath, 'utf8');
  } else {
    raw = await ftpDownload(FTP_CONFIG, `${domain}/${runId}/accessibility-results.json`);
  }
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    const urls = Array.isArray(data.urls)
      ? [...new Set(data.urls.map((u) => String(u)).filter(Boolean))]
      : [];
    return { urls, source: existsSync(filePath) ? 'file' : 'ftp' };
  } catch (err) {
    return { error: `Invalid report data: ${err.message}` };
  }
}

app.get('/api/report/:domain/:runId/urls', async (req, res) => {
  const { domain, runId } = req.params;
  if (!isValidDomain(domain) || !isValidRunId(runId)) return res.status(400).json({ error: 'Invalid run id' });
  const out = await readUrlsForRun(domain, runId);
  if (!out) return res.status(404).json({ error: 'Report not found' });
  if (out.error) return res.status(500).json({ error: out.error });
  return res.json({ id: domain, domain, runId, urls: out.urls, count: out.urls.length, source: out.source });
});

app.get('/api/report/:id/urls', async (req, res) => {
  const domain = req.params.id;
  if (!isValidDomain(domain)) return res.status(400).json({ error: 'Invalid domain' });
  const runId = await resolveLatestRunIdForDomain(domain);
  if (!runId) return res.status(404).json({ error: 'Report not found' });
  const out = await readUrlsForRun(domain, runId);
  if (!out) return res.status(404).json({ error: 'Report not found' });
  if (out.error) return res.status(500).json({ error: out.error });
  return res.json({ id: domain, domain, runId, urls: out.urls, count: out.urls.length, source: out.source });
});

async function writeManualProgress(domain, runId, checked) {
  const reportDir = runDirOf(domain, runId);
  if (!existsSync(reportDir)) {
    try {
      const dbRun = dbPool ? await dbGetRun(domain, runId) : null;
      if (!dbRun) return { status: 404, error: 'Report not found' };
    } catch (err) {
      console.error(`[run ${domain}/${runId}] DB report lookup failed:`, err.message);
      return { status: 500, error: 'Failed to verify report' };
    }
  }
  const filePath = join(reportDir, 'manual-progress.json');
  try {
    const normalized = normalizeManualProgress(checked);
    if (dbPool) {
      await dbUpsertRun(domain, runId, {
        status: (runStatus.get(runKey(domain, runId))?.status || 'done'),
        manualProgress: { checked: normalized },
      });
    }
    if (!existsSync(reportDir)) mkdirSync(reportDir, { recursive: true });
    writeFileSync(filePath, JSON.stringify({ checked: normalized }), 'utf8');
    ftpUpload(FTP_CONFIG, filePath, `${domain}/${runId}/manual-progress.json`).catch(() => {});
    return { status: 200, ok: true, checked: normalized };
  } catch (err) {
    return { status: 500, error: err.message };
  }
}

app.put('/api/report/:domain/:runId/manual-progress', async (req, res) => {
  const { domain, runId } = req.params;
  if (!isValidDomain(domain) || !isValidRunId(runId)) return res.status(400).json({ error: 'Invalid run id' });
  const checked = req.body?.checked;
  if (!Array.isArray(checked)) return res.status(400).json({ error: 'Body must include checked array' });
  const out = await writeManualProgress(domain, runId, checked);
  if (out.error) return res.status(out.status).json({ error: out.error });
  res.json({ ok: true, checked: out.checked });
});

app.put('/api/report/:id/manual-progress', async (req, res) => {
  const domain = req.params.id;
  if (!isValidDomain(domain)) return res.status(400).json({ error: 'Invalid domain' });
  const runId = await resolveLatestRunIdForDomain(domain);
  if (!runId) return res.status(404).json({ error: 'Report not found' });
  const checked = req.body?.checked;
  if (!Array.isArray(checked)) return res.status(400).json({ error: 'Body must include checked array' });
  const out = await writeManualProgress(domain, runId, checked);
  if (out.error) return res.status(out.status).json({ error: out.error });
  res.json({ ok: true, checked: out.checked });
});

function serveReportFile(domain, runId, filename) {
  const filePath = join(runDirOf(domain, runId), filename);
  if (existsSync(filePath)) {
    return readFileSync(filePath, 'utf8');
  }
  return null;
}

async function ensureReportFilesFromDb(domain, runId) {
  if (!dbPool) return false;
  try {
    const dbRun = await dbGetRun(domain, runId);
    if (!dbRun || !dbRun.resultJson) return false;
    const reportDir = runDirOf(domain, runId);
    if (!existsSync(reportDir)) mkdirSync(reportDir, { recursive: true });
    const resultsPath = join(reportDir, 'accessibility-results.json');
    writeFileSync(resultsPath, JSON.stringify(dbRun.resultJson, null, 2), 'utf8');
    if (dbRun.manualProgress && Array.isArray(dbRun.manualProgress.checked)) {
      writeFileSync(join(reportDir, 'manual-progress.json'), JSON.stringify(dbRun.manualProgress, null, 2), 'utf8');
    }
    const { generateReport } = await import(GENERATE_REPORT_URL);
    generateReport(dbRun.resultJson, { outputDir: reportDir, verbose: true, throwOnDeliverableError: true });
    return existsSync(join(reportDir, 'accessibility-report.html'));
  } catch (err) {
    console.error(`[run ${domain}/${runId}] Failed to hydrate report from DB:`, err.message);
    return false;
  }
}

async function ensureDeliverableFromResults(domain, runId, filename, debugInfo = null) {
  const reportDir = runDirOf(domain, runId);
  const resultsPath = join(reportDir, 'accessibility-results.json');
  if (!existsSync(resultsPath)) {
    if (!existsSync(reportDir)) mkdirSync(reportDir, { recursive: true });
    const ftpResults = await ftpDownload(FTP_CONFIG, `${domain}/${runId}/accessibility-results.json`);
    if (!ftpResults) {
      const dbRun = dbPool ? await dbGetRun(domain, runId) : null;
      if (dbRun && dbRun.resultJson) {
        writeFileSync(resultsPath, JSON.stringify(dbRun.resultJson, null, 2), 'utf8');
      } else {
        if (debugInfo) debugInfo.error = 'results missing in local/ftp/db';
        return false;
      }
    }
  }
  try {
    const reportData = readJsonIfExists(resultsPath);
    if (!reportData) {
      if (debugInfo) debugInfo.error = 'results json unreadable';
      return false;
    }
    const { generateReport } = await import(GENERATE_REPORT_URL);
    generateReport(reportData, { outputDir: reportDir, verbose: true, throwOnDeliverableError: true, noExit: true });
    return existsSync(join(reportDir, filename));
  } catch (err) {
    if (debugInfo) debugInfo.error = err.message;
    console.error(`[run ${domain}/${runId}] Failed to regenerate deliverables:`, err.message);
    return false;
  }
}

app.get('/api/debug/deliverable/:domain/:runId/:file', async (req, res) => {
  const { domain, runId, file } = req.params;
  if (!isValidDomain(domain) || !isValidRunId(runId)) return res.status(400).json({ error: 'Invalid run id' });
  if (!DELIVERABLE_FILES.includes(file)) return res.status(400).json({ error: 'Unsupported deliverable file' });

  const reportDir = runDirOf(domain, runId);
  const reportHtmlPath = join(reportDir, 'accessibility-report.html');
  const deliverablePath = join(reportDir, file);
  const resultsPath = join(reportDir, 'accessibility-results.json');
  const diagnostics = {
    domain,
    runId,
    file,
    local: {
      reportHtmlExists: existsSync(reportHtmlPath),
      deliverableExists: existsSync(deliverablePath),
      resultsExists: existsSync(resultsPath),
    },
    db: { hasRun: false, hasResultJson: false },
    ftp: { reportHtml: false, deliverable: false, results: false },
    actions: [],
    finalExists: false,
  };

  try {
    const dbRun = dbPool ? await dbGetRun(domain, runId) : null;
    diagnostics.db.hasRun = !!dbRun;
    diagnostics.db.hasResultJson = !!dbRun?.resultJson;
  } catch (err) {
    diagnostics.actions.push(`dbGetRun error: ${err.message}`);
  }

  try { diagnostics.ftp.reportHtml = !!(await ftpDownload(FTP_CONFIG, `${domain}/${runId}/accessibility-report.html`)); } catch (err) { diagnostics.actions.push(`ftp report error: ${err.message}`); }
  try { diagnostics.ftp.deliverable = !!(await ftpDownload(FTP_CONFIG, `${domain}/${runId}/${file}`)); } catch (err) { diagnostics.actions.push(`ftp deliverable error: ${err.message}`); }
  try { diagnostics.ftp.results = !!(await ftpDownload(FTP_CONFIG, `${domain}/${runId}/accessibility-results.json`)); } catch (err) { diagnostics.actions.push(`ftp results error: ${err.message}`); }

  if (String(req.query.rebuild || '') === '1') {
    const regen = {};
    try {
      const rebuilt = await ensureDeliverableFromResults(domain, runId, file, regen);
      diagnostics.actions.push(`ensureDeliverableFromResults: ${rebuilt ? 'ok' : 'failed'}`);
      if (regen.error) diagnostics.actions.push(`regenError: ${regen.error}`);
    } catch (err) {
      diagnostics.actions.push(`ensureDeliverableFromResults error: ${err.message}`);
    }
  }

  diagnostics.finalExists = existsSync(deliverablePath);
  return res.json(diagnostics);
});

app.get('/report/:domain/:runId/screenshots/:file', async (req, res) => {
  const { domain, runId, file } = req.params;
  if (!isValidDomain(domain) || !isValidRunId(runId)) return res.status(400).send('Invalid run id');
  const safeName = file.replace(/[^a-zA-Z0-9._-]/g, '');
  const filePath = join(runDirOf(domain, runId), 'screenshots', safeName);
  if (existsSync(filePath)) {
    res.sendFile(filePath);
    return;
  }
  await ftpDownload(FTP_CONFIG, `${domain}/${runId}/screenshots/${safeName}`);
  if (existsSync(filePath)) {
    res.sendFile(filePath);
    return;
  }
  res.status(404).send('Not found');
});

/** Serve deliverable HTML files (developer guide, client deck, statement). */
app.get('/report/:domain/:runId/:file', async (req, res, next) => {
  const { domain, runId, file } = req.params;
  if (!isValidDomain(domain) || !isValidRunId(runId)) return next();
  if (!DELIVERABLE_FILES.includes(file)) return next();

  const reportDir = runDirOf(domain, runId);
  let html = serveReportFile(domain, runId, file);
  if (!html) {
    html = await ftpDownload(FTP_CONFIG, `${domain}/${runId}/${file}`);
  }
  if (!html) {
    const hydrated = await ensureReportFilesFromDb(domain, runId);
    if (hydrated) html = serveReportFile(domain, runId, file);
  }
  if (!html) {
    const rebuilt = await ensureDeliverableFromResults(domain, runId, file);
    if (rebuilt) html = serveReportFile(domain, runId, file);
  }
  if (html) {
    res.setHeader('Content-Type', 'text/html');
    return res.send(html);
  }
  if (existsSync(join(reportDir, 'accessibility-report.html'))) {
    return res.status(404).send('Deliverable is not available yet. Please refresh in a moment.');
  }
  return res.status(404).send('Deliverable not found');
});

/**
 * Send users to the prototype-styled report under `/report/:domain/:runId/`.
 * The literal `/report/:domain/history` route below is registered first so it wins,
 * and reaches the Astro shell unmodified.
 */
app.get('/report/:domain/history', (req, res, next) => next());
app.get('/report/:domain/history/', (req, res, next) => next());

app.get('/report/:domain', async (req, res) => {
  const domain = req.params.domain;
  if (!isValidDomain(domain)) return res.status(400).send('Invalid domain');
  const running = findRunningRun(runStatus, domain);
  if (running) {
    return res.redirect(`${loadingPath}?domain=${encodeURIComponent(domain)}&runId=${encodeURIComponent(running.runId)}`);
  }
  const runId = await resolveLatestRunIdForDomain(domain);
  if (!runId) return res.status(404).send('Report not found');
  const target = `/report/${encodeURIComponent(domain)}/${encodeURIComponent(runId)}/`;
  return res.redirect(req.path.endsWith('/') ? 302 : 301, target);
});

app.get('/report/:domain/', async (req, res) => {
  const domain = req.params.domain;
  if (!isValidDomain(domain)) return res.status(400).send('Invalid domain');
  const running = findRunningRun(runStatus, domain);
  if (running) {
    return res.redirect(`${loadingPath}?domain=${encodeURIComponent(domain)}&runId=${encodeURIComponent(running.runId)}`);
  }
  const runId = await resolveLatestRunIdForDomain(domain);
  if (!runId) return res.status(404).send('Report not found');
  return res.redirect(302, `/report/${encodeURIComponent(domain)}/${encodeURIComponent(runId)}/`);
});

// Path segments under /report/:domain/ that are NOT runIds (handled by Astro).
const RESERVED_DOMAIN_SUBPATHS = new Set(['history']);

app.get('/report/:domain/:runId', (req, res, next) => {
  const { domain, runId } = req.params;
  if (RESERVED_DOMAIN_SUBPATHS.has(runId)) return next();
  if (!isValidDomain(domain) || !isValidRunId(runId)) return next();
  const key = runKey(domain, runId);
  if (runStatus.get(key)?.status === 'running') {
    return res.redirect(`${loadingPath}?domain=${encodeURIComponent(domain)}&runId=${encodeURIComponent(runId)}`);
  }
  if (req.path.endsWith('/')) return next();
  return res.redirect(301, `/report/${encodeURIComponent(domain)}/${encodeURIComponent(runId)}/`);
});

app.get('/report/:domain/:runId/', (req, res, next) => {
  const { domain, runId } = req.params;
  if (RESERVED_DOMAIN_SUBPATHS.has(runId)) return next();
  if (!isValidDomain(domain) || !isValidRunId(runId)) return next();
  const key = runKey(domain, runId);
  if (runStatus.get(key)?.status === 'running') {
    return res.redirect(`${loadingPath}?domain=${encodeURIComponent(domain)}&runId=${encodeURIComponent(runId)}`);
  }
  return next();
});

app.get('/report/:domain/:runId/sales', (req, res, next) => next());
app.get('/report/:domain/:runId/sales/', (req, res, next) => next());
app.get('/report/:domain/:runId/statement', (req, res, next) => next());
app.get('/report/:domain/:runId/statement/', (req, res, next) => next());

  /**
   * Home: when this app is mounted under a parent (Astro shell), continue to the parent.
   * When using `node server.js` alone, `server.js` registers a second handler to redirect to /audits.
   */
  app.get('/', (req, res, next) => next());

  return app;
}
