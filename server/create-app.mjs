/**
 * Express app factory: API routes, auth, report file serving.
 * Designed for the Astro shell (web/) — Astro serves the UI, this app serves /api/* and /report/* artifacts.
 * @param {string} repoRoot - Repository root (directory containing run-tests.js, generate-report.js, reports/).
 */
import express from 'express';
import multer from 'multer';
import { spawn } from 'child_process';
import { createHash, timingSafeEqual } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { sendRunNotificationEmail, createSmtpTransport, sendAccessRequestEmail, sendLeadEmail, assertProductionMailFrom } from '../server-email.js';
import { REPORTS_BASE } from './paths.js';
import { dbPool, dbUpsertRun, dbGetRun, dbGetLatestRun, dbGetRunByGuestToken, dbInsertLead, dbListLeads } from './db.js';
import { mergeReportData } from './report-data.js';
import { readJsonIfExists, isValidReportId } from './fs-utils.js';
import { listAuditEntries, listRunsForDomain, filterRunsForViewer } from './audit-list.js';
import { getFtpConfig, ftpDownload, ftpUpload, persistReportArtifactsToFtp, assertProductionFtpSecure } from './ftp.js';
import { normalizeManualProgress, resolvePersistedManualChecked } from '../manual-checklist.js';
import { analysisCacheBody, anthropicConfigured, buildWcagAnalysisPayload } from '../anthropic-wcag-analysis.js';
import {
  newRunId,
  isValidRunId,
  isValidDomain,
  runDir as runDirOf,
  latestRunIdOnDisk,
} from './run-ids.js';
import {
  checkGuestFreeScan,
  markGuestFreeScan,
  guestFreebieClaimed,
  clientIp,
  guestIpHasRunningScan,
  isValidGuestToken,
  newGuestToken,
  persistGuestToken,
  publicConfig,
  runRequestIsStaff,
  readGuestTokenRecord,
  trackGuestRunEnd,
  trackGuestRunStart,
  verifyTurnstileIfConfigured,
  appendLeadFile,
  readLeadFileRows,
} from './guest.mjs';
import {
  assertPublicHttpUrl,
  buildScanProcessEnv,
  collectUrlCandidates,
  fetchSitemapDocument,
  filterPublicHttpUrls,
  hostResolverRulesFromTargets,
  looksLikeUrlCandidate,
  setUrlGuardLookup,
} from './url-guard.mjs';
import { buildTeaserPayload } from './teaser-payload.mjs';
import {
  clearSessionCookies,
  csrfOk,
  isHtmlFormPost,
  readAccessFromCookies,
  sessionSecret,
  setSessionCookies,
  staffSessionVersion,
} from './session.mjs';
import { authenticateUser, getUserById, GENERIC_CREDENTIALS_ERROR } from './users.mjs';
import { attachRunToUser, canAccessDomain, canAccessRun, findProjectByDomain, listProjectsForUser, parseTenantPath } from './projects.mjs';
import { registerAccountRoutes } from './account-routes.mjs';
import { registerStripeRoutes, registerStripeWebhook } from './stripe-routes.mjs';
import { registerRetentionRoutes } from './retention.mjs';
import { warnStripeTaxCodeIfUnset } from './stripe.mjs';
import { assertCompanyIdentityForProduction } from './company.mjs';
import { assertProductionPublicBaseUrl, publicBaseUrl } from './config.mjs';
import { registerSeoRoutes } from './seo-routes.mjs';
import { recordConsent } from './consents.mjs';
import { LEGAL_PRIVACY_VERSION } from './legal-versions.mjs';
import { consumeAndQueueCustomerScan, refundScanEntitlement, rememberRunEntitlement } from './billing.mjs';
import { MAX_PAGES_PER_CUSTOMER_RUN } from './plan-catalog.mjs';
import {
  customerHasActiveScan,
  enqueueScanJob,
  findRunningRun,
  kickQueue,
  listJobs,
  recoverInterruptedJobs,
  setQueueExecutor,
  setQueueJobErrorHandler,
} from './queue.mjs';
import {
  errorMiddleware,
  patchAppAsyncHandlers,
  requestIdMiddleware,
  requireDebugEndpoints,
  requireStaff,
  securityHeadersMiddleware,
} from './http-utils.mjs';
import {
  consumeOauthState,
  newOauthState,
  readJiraOAuth,
  writeJiraOAuth,
} from './jira-oauth.mjs';
import { clientKey, rateLimit } from './rate-limit.mjs';

const DELIVERABLE_FILES = [
  'accessibility-developers.html',
  'accessibility-client.html',
  'accessibility-statement.html',
];

function runKey(domain, runId) {
  return `${domain}:${runId}`;
}

function ownerForAccess(access, { guestToken } = {}) {
  if (access?.role === 'staff' || access?.userId === 'staff') return { userId: 'staff' };
  if (access?.role === 'customer' && access.userId) return { userId: access.userId };
  return { guestToken: guestToken || null };
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
let APP_USERNAME = '';
let APP_PASSWORD = '';
let AUTH_COOKIE_SAMESITE = 'Lax';

// In-memory run status (running, queued, done, error). `resultJson` lives on disk/DB, not here.
const runStatus = new Map();
const wcagAnalysisInflight = new Map();
/** Run keys we already attempted to notify (success or skip) → attempted-at ms */
const notificationAttempted = new Map();
const RUN_STATUS_TTL_MS = 60 * 60 * 1000;

function evictTerminalRunState(now = Date.now()) {
  for (const [key, value] of runStatus.entries()) {
    if (value?.status !== 'done' && value?.status !== 'error') continue;
    const finishedAt = Number(value.finishedAt || 0);
    if (finishedAt && now - finishedAt >= RUN_STATUS_TTL_MS) runStatus.delete(key);
  }
  for (const [key, attemptedAt] of notificationAttempted.entries()) {
    if (now - Number(attemptedAt || 0) >= RUN_STATUS_TTL_MS) notificationAttempted.delete(key);
  }
}

function rememberRunStatus(key, state) {
  const next = { ...(state || {}) };
  delete next.resultJson;
  if (next.status === 'done' || next.status === 'error') {
    next.finishedAt = next.finishedAt || Date.now();
  } else {
    delete next.finishedAt;
  }
  runStatus.set(key, next);
  evictTerminalRunState();
  return next;
}

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

const PUBLIC_GET_PREFIXES = ['/assets/', '/styles/', '/fonts/', '/_astro/', '/teaser/', '/api/guest/', '/api/auth/verify'];
const PUBLIC_GET_PATHS = new Set([
  '/',
  '/loading',
  '/limitations',
  '/pricing',
  '/terms',
  '/privacy',
  '/cookies',
  '/legal/subprocessors',
  '/accessibility',
  '/signup',
  '/verify',
  '/forgot',
  '/reset',
  '/teaser',
  '/api/config',
  '/api/billing/config',
  '/api/health/db',
  '/robots.txt',
  '/sitemap.xml',
  '/favicon.ico',
  '/api/__test/throw',
]);

function canonicalPublicPath(req) {
  const raw = String(req.path || '').split('#')[0].split('?')[0];
  if (!raw || raw === '/') return '/';
  const trimmed = raw.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function isReadHttpMethod(method) {
  return method === 'GET' || method === 'HEAD';
}

function isGuestOpenPath(req) {
  const p = canonicalPublicPath(req);
  if (isReadHttpMethod(req.method)) {
    if (PUBLIC_GET_PATHS.has(p)) return true;
    if (PUBLIC_GET_PREFIXES.some((prefix) => p.startsWith(prefix))) return true;
  }
  if (req.method === 'POST') {
    if (p === '/api/run' || p === '/api/lead' || p === '/api/access-request' || p === '/api/stripe/webhook') {
      return true;
    }
    if (p.startsWith('/api/auth/')) return true;
  }
  return false;
}

function requestIsStaff(req) {
  return runRequestIsStaff({
    authEnabled: AUTH_ENABLED,
    accessRole: req.access?.role,
    body: req.body,
    file: req.file,
  });
}

function getJiraConfig() {
  return {
    // Atlassian OAuth (3LO)
    clientId: String(process.env.ATLASSIAN_CLIENT_ID || '').trim(),
    clientSecret: String(process.env.ATLASSIAN_CLIENT_SECRET || '').trim(),
    redirectUri: String(process.env.ATLASSIAN_REDIRECT_URI || '').trim(),
  };
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
  rememberRunStatus(key, next);
  dbUpsertRun(domain, runId, next).catch((err) => {
    console.error(`[run ${domain}/${runId}] DB state update failed:`, err.message);
  });
  if (patch.status === 'error' && next.userId && next.userId !== 'staff') {
    void refundScanEntitlement(runId).catch((err) => {
      console.error(`[run ${domain}/${runId}] entitlement refund failed:`, err.message);
    });
  }
  void maybeSendRunEmail(domain, runId);
}

async function maybeSendRunEmail(domain, runId) {
  const key = runKey(domain, runId);
  evictTerminalRunState();
  if (notificationAttempted.has(key)) return;
  const cur = runStatus.get(key);
  if (!cur?.notifyRequested || !cur.notifyEmail) return;
  if (cur.status !== 'done' && cur.status !== 'error') return;
  notificationAttempted.set(key, Date.now());
  const base = publicBaseUrl();
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
      if (looksLikeUrlCandidate(p)) urls.push(p);
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
  const urlGuard = opts.urlGuard || {};
  /** @type {{ url: string, reason: string }[]} */
  const rejected = Array.isArray(opts.rejected) ? opts.rejected : [];

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
        if (loc.toLowerCase().endsWith('.gz')) {
          console.warn(`[sitemap] skipping gzip child sitemap (not supported): ${loc}`);
          rejected.push({ url: loc, reason: 'Gzip child sitemaps are not supported.' });
          continue;
        }
        if (seenSitemaps.has(loc)) continue;
        seenSitemaps.add(loc);
        try {
          await assertPublicHttpUrl(loc, urlGuard);
        } catch (err) {
          rejected.push({ url: loc, reason: err?.message || 'That host cannot be scanned.' });
          continue;
        }
        const childText = await fetchSitemapDocument(loc, urlGuard);
        if (childText == null) {
          rejected.push({ url: loc, reason: 'Sitemap fetch was skipped (blocked, redirect, timeout, or too large).' });
          continue;
        }
        await walk(childText, depth + 1, loc);
      }
    } else {
      for (const loc of locs) {
        if (pageUrls.size >= maxUrls) break;
        try {
          pageUrls.add(await assertPublicHttpUrl(loc, urlGuard));
        } catch (err) {
          rejected.push({ url: loc, reason: err?.message || 'That host cannot be scanned.' });
        }
      }
    }
  }

  await walk(buffer.toString('utf8'), 0, null);
  return { urls: [...pageUrls], rejected };
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

export function createAccessibilityApp(repoRoot, options = {}) {
  if (typeof repoRoot !== 'string' || !repoRoot) {
    throw new Error('createAccessibilityApp(repoRoot): repoRoot must be a non-empty path string');
  }
  const urlGuard = {
    lookup: options.lookup,
    fetch: options.sitemapFetch,
  };
  const spawnImpl = typeof options.spawn === 'function' ? options.spawn : spawn;
  AUTH_ENABLED = parseBooleanEnv('AUTH_ENABLED', true);
  APP_USERNAME = String(process.env.APP_USERNAME || '').trim();
  APP_PASSWORD = String(process.env.APP_PASSWORD || '').trim();
  if (AUTH_ENABLED && (!APP_PASSWORD || APP_PASSWORD.length < 12)) {
    throw new Error('APP_PASSWORD (>=12 chars) is required when AUTH_ENABLED=true');
  }
  sessionSecret();
  assertCompanyIdentityForProduction();
  assertProductionMailFrom();
  assertProductionPublicBaseUrl();
  assertProductionFtpSecure();
  warnStripeTaxCodeIfUnset();
  const sameSiteRaw = String(process.env.AUTH_COOKIE_SAMESITE || 'Lax').trim();
  AUTH_COOKIE_SAMESITE = ['Lax', 'Strict', 'None'].includes(sameSiteRaw) ? sameSiteRaw : 'Lax';
  const loadingPath = '/loading';

  const app = express();
  app.disable('x-powered-by');
  const trustHops = Number(process.env.TRUST_PROXY_HOPS || 1);
  app.set('trust proxy', Number.isFinite(trustHops) && trustHops >= 0 ? trustHops : 1);
  patchAppAsyncHandlers(app);
  app.use(requestIdMiddleware);
  app.use(securityHeadersMiddleware);

  const loginIpLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, keyFn: clientKey, countFailures: true });
  const loginUserLimit = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 20,
    keyFn: (req) => String(req.body?.username || req.body?.email || '').trim().toLowerCase() || 'anon',
    countFailures: true,
  });
  const leadIpLimit = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, keyFn: clientKey });

  function launchScanProcess(job) {
    const {
      domain,
      runId,
      urls,
      processedUrls,
      requestedUrls,
      truncated,
      reportDir,
    } = job;
    const key = runKey(domain, runId);
    runStatePatch(domain, runId, {
      status: 'running',
      urls: processedUrls,
      processedUrls,
      requestedUrls,
      truncated,
      userId: job.userId || null,
      tier: job.tier || null,
    });
    const urlsArg = (Array.isArray(urls) ? urls : []).join('\n');
    return new Promise((resolve) => {
      const child = spawnImpl(
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
          env: {
            ...buildScanProcessEnv(process.env),
            ...(job.hostResolverRules ? { SCANNER_HOST_RESOLVER_RULES: job.hostResolverRules } : {}),
          },
        }
      );

      let stderr = '';
      let stdoutBuf = '';
      child.stderr?.on('data', (d) => {
        stderr += d.toString();
      });
      child.stdout?.on('data', (d) => {
        stdoutBuf += d.toString();
        const lines = stdoutBuf.split('\n');
        stdoutBuf = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('{')) continue;
          try {
            const msg = JSON.parse(trimmed);
            if (msg && msg.type === 'progress') {
              runStatePatch(domain, runId, {
                scannedPages: Number(msg.done) || 0,
                currentUrl: msg.url || null,
              });
            }
          } catch {
            /* ignore non-JSON log lines */
          }
        }
      });

      const finish = () => resolve();

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
                runStatePatch(domain, runId, {
                  status: 'error',
                  urls: processedUrls,
                  processedUrls,
                  requestedUrls,
                  truncated,
                  error: 'Report generation failed.',
                });
              }
            })
            .catch((err) => {
              runStatePatch(domain, runId, {
                status: 'error',
                urls: processedUrls,
                processedUrls,
                requestedUrls,
                truncated,
                error: err.message,
              });
            })
            .finally(finish);
          return;
        }
        if (code === 0 && !existsSync(reportPath)) {
          const pollForReport = (attempts = 0) => {
            if (existsSync(reportPath)) {
              finalizeSuccessfulRun({ domain, runId, reportDir, processedUrls, requestedUrls, truncated })
                .then((ok) => {
                  if (!ok) {
                    runStatePatch(domain, runId, {
                      status: 'error',
                      urls: processedUrls,
                      processedUrls,
                      requestedUrls,
                      truncated,
                      error: 'Report generation failed.',
                    });
                  }
                })
                .catch((err) => {
                  runStatePatch(domain, runId, {
                    status: 'error',
                    urls: processedUrls,
                    processedUrls,
                    requestedUrls,
                    truncated,
                    error: err.message,
                  });
                })
                .finally(finish);
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
                    const ok = await finalizeSuccessfulRun({
                      domain,
                      runId,
                      reportDir,
                      processedUrls,
                      requestedUrls,
                      truncated,
                    });
                    if (!ok) {
                      runStatePatch(domain, runId, {
                        status: 'error',
                        urls: processedUrls,
                        processedUrls,
                        requestedUrls,
                        truncated,
                        error: 'Report generation failed.',
                      });
                    }
                  } else {
                    runStatePatch(domain, runId, {
                      status: 'error',
                      urls: processedUrls,
                      processedUrls,
                      requestedUrls,
                      truncated,
                      error: 'Report generation failed.',
                    });
                  }
                } catch (err) {
                  runStatePatch(domain, runId, {
                    status: 'error',
                    urls: processedUrls,
                    processedUrls,
                    requestedUrls,
                    truncated,
                    error: err.message,
                  });
                } finally {
                  finish();
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
              finish();
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
        finish();
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
        finish();
      });
    });
  }

  recoverInterruptedJobs();
  if (typeof options.lookup === 'function') {
    setUrlGuardLookup(options.lookup);
  }
  setQueueExecutor((job) => launchScanProcess(job));
  setQueueJobErrorHandler((job) => {
    if (!job?.domain || !job?.runId) return;
    runStatePatch(job.domain, job.runId, {
      status: 'error',
      error: job.error || 'blocked_target',
      userId: job.userId || undefined,
    });
  });
  for (const job of listJobs()) {
    if (!job?.domain || !job?.runId) continue;
    const existing = runStatus.get(runKey(job.domain, job.runId));
    if (!existing) {
      rememberRunStatus(runKey(job.domain, job.runId), {
        domain: job.domain,
        runId: job.runId,
        status: 'queued',
        urls: job.processedUrls,
        processedUrls: job.processedUrls,
        requestedUrls: job.requestedUrls,
        truncated: job.truncated,
        error: null,
        userId: job.userId || null,
        tier: job.tier || null,
        guestIp: job.guestIp || null,
      });
      if (job.tier === 'guest' && job.guestIp) trackGuestRunStart(job.guestIp);
    }
  }
  kickQueue();


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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-CSRF-Token'
  );
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

registerStripeWebhook(app);

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

function digest(value) {
  return createHash('sha256').update(String(value ?? '')).digest();
}

function credentialsValid(user, pass) {
  const userOk = timingSafeEqual(digest(user), digest(APP_USERNAME));
  const passOk = timingSafeEqual(digest(pass), digest(APP_PASSWORD));
  return userOk && passOk;
}

function setAuthCookie(res, session = { userId: 'staff', role: 'staff', email: '' }) {
  setSessionCookies(res, session, AUTH_COOKIE_SAMESITE);
}

function clearAuthCookie(res) {
  clearSessionCookies(res, AUTH_COOKIE_SAMESITE);
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
  <link rel="stylesheet" href="/styles/tokens.css">
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

registerSeoRoutes(app);

async function loadResultJson(domain, runId) {
  if (dbPool) {
    try {
      const row = await dbGetRun(domain, runId);
      if (row?.resultJson) return row.resultJson;
    } catch (err) {
      console.error(`[run ${domain}/${runId}] DB result read failed:`, err.message);
    }
  }
  return readJsonIfExists(join(runDirOf(domain, runId), 'accessibility-results.json'));
}

app.get('/auth/login', (req, res) => {
  if (!AUTH_ENABLED) return res.redirect('/');
  const nextPath = safeNextAfterLogin(typeof req.query.next === 'string' ? req.query.next : '/');
  return res.status(200).send(loginPageHtml(nextPath));
});

app.post('/auth/login', loginIpLimit, loginUserLimit, async (req, res) => {
  if (!AUTH_ENABLED) return res.redirect('/');
  const nextPath = safeNextAfterLogin(typeof req.body?.next === 'string' ? req.body.next : '/');
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  if (credentialsValid(username, password)) {
    setAuthCookie(res, { userId: 'staff', role: 'staff', email: username, ver: staffSessionVersion() });
    return res.redirect(nextPath);
  }
  const user = await authenticateUser(username, password);
  if (!user || !user.emailVerified) {
    if (typeof req.recordRateLimitFailure === 'function') req.recordRateLimitFailure();
    return res.status(401).send(loginPageHtml(nextPath, GENERIC_CREDENTIALS_ERROR));
  }
  setAuthCookie(res, {
    userId: user.id,
    role: user.role,
    email: user.email,
    ver: user.sessionVersion || 1,
  });
  return res.redirect(nextPath);
});

app.get('/auth/logout', (_req, res) => {
  res.setHeader('Allow', 'POST');
  return res.status(405).type('txt').send('Method Not Allowed');
});

app.post('/auth/logout', (req, res) => {
  if (!AUTH_ENABLED) return res.redirect('/');
  clearAuthCookie(res);
  const nextPath = typeof req.body?.next === 'string' ? safeNextAfterLogin(req.body.next) : '/auth/login';
  return res.redirect(302, nextPath);
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

app.get('/api/auth/status', async (req, res) => {
  if (!AUTH_ENABLED) {
    return res.json({
      authEnabled: false,
      authenticated: true,
      role: 'staff',
      csrf: '',
    });
  }
  const access = await readAccessFromCookies(req);
  if (access) {
    const user = access.role === 'customer' ? await getUserById(access.userId) : { role: 'staff' };
    return res.json({
      authEnabled: true,
      authenticated: true,
      role: access.role,
      email: access.email || user?.email || '',
      csrf: access.csrf || '',
    });
  }
  return res.json({
    authEnabled: true,
    authenticated: false,
    role: 'guest',
    csrf: '',
  });
});

app.get('/api/config', (_req, res) => {
  res.json({
    authEnabled: AUTH_ENABLED,
    ...publicConfig(),
  });
});

function loginFormRedirect(req, res, path, jsonStatus, jsonBody) {
  if (isHtmlFormPost(req)) {
    return res.redirect(303, path);
  }
  if (jsonStatus && jsonStatus !== 200) {
    return res.status(jsonStatus).json(jsonBody);
  }
  return res.json(jsonBody);
}

/** Browser GET of a form action (Astro ClientRouter / address bar) should never dump JSON. */
app.get('/api/auth/login', (_req, res) => res.redirect(303, '/'));
app.get('/api/auth/signup', (_req, res) => res.redirect(303, '/signup'));
app.get('/api/auth/logout', (_req, res) => res.redirect(303, '/'));
app.get('/api/auth/forgot', (_req, res) => res.redirect(303, '/forgot'));
app.get('/api/auth/reset', (_req, res) => res.redirect(303, '/reset'));
app.get('/api/account/delete', (_req, res) => res.redirect(303, '/account'));

app.post('/api/auth/login', loginIpLimit, loginUserLimit, async (req, res) => {
  if (!AUTH_ENABLED) return loginFormRedirect(req, res, '/', 200, { ok: true, role: 'staff' });
  const username = String(req.body?.username ?? req.body?.email ?? '').trim();
  const password = String(req.body?.password ?? '');
  if (credentialsValid(username, password)) {
    setAuthCookie(res, { userId: 'staff', role: 'staff', email: username, ver: staffSessionVersion() });
    return loginFormRedirect(req, res, '/', 200, { ok: true, role: 'staff' });
  }
  const user = await authenticateUser(username, password);
  if (!user || !user.emailVerified) {
    if (typeof req.recordRateLimitFailure === 'function') req.recordRateLimitFailure();
    const status = user && !user.emailVerified ? 403 : 401;
    return loginFormRedirect(req, res, '/?signin=failed', status, {
      error: GENERIC_CREDENTIALS_ERROR,
    });
  }
  setAuthCookie(res, {
    userId: user.id,
    role: user.role,
    email: user.email,
    ver: user.sessionVersion || 1,
  });
  const next = user.role === 'staff' ? '/' : '/account';
  return loginFormRedirect(req, res, next, 200, { ok: true, role: user.role });
});

app.post('/api/auth/logout', (req, res) => {
  if (!AUTH_ENABLED) return res.json({ ok: true });
  clearAuthCookie(res);
  return res.json({ ok: true });
});

app.post('/api/access-request', leadIpLimit, async (req, res) => {
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

app.use(async (req, res, next) => {
  if (!AUTH_ENABLED) {
    req.access = { role: 'staff', userId: 'staff', email: '', csrf: '' };
    return next();
  }
  if (req.path === '/robots.txt' || req.path === '/sitemap.xml') return next();
  if (req.path === '/auth/login' || req.path === '/auth/logout') return next();
  if (req.path === '/auth/jira/callback') return next();
  if (req.path === '/api/config') return next();
  if (
    isReadHttpMethod(req.method) &&
    (canonicalPublicPath(req) === '/loading' ||
      req.path.startsWith('/assets/') ||
      req.path.startsWith('/styles/') ||
      req.path.startsWith('/fonts/') ||
      req.path.startsWith('/_astro/'))
  ) {
    return next();
  }

  const cookieAccess = await readAccessFromCookies(req);
  if (cookieAccess) {
    req.access = cookieAccess;
    if (!csrfOk(req) && req.path.startsWith('/api/')) {
      if (isHtmlFormPost(req)) {
        const next = req.path.startsWith('/api/account') ? '/account?error=csrf' : '/?error=csrf';
        return res.redirect(303, next);
      }
      return res.status(403).json({ error: 'Missing or invalid CSRF token.' });
    }
    return next();
  }

  if (isGuestOpenPath(req)) {
    req.access = { role: 'guest' };
    return next();
  }

  /** Main domain: serve glass login at `/` unless the Node host defers to an Astro shell (web/run-server.mjs). */
  if (isReadHttpMethod(req.method) && canonicalPublicPath(req) === '/') {
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

registerAccountRoutes(app, {
  readGuestTokenRecord,
  patchMemoryRunOwner(domain, runId, userId) {
    if (!domain || !runId || !userId) return;
    const key = runKey(domain, runId);
    const cur = runStatus.get(key);
    if (!cur) return;
    rememberRunStatus(key, { ...cur, userId, tier: 'customer', guestToken: null });
  },
});
registerStripeRoutes(app);
registerRetentionRoutes(app);

app.get('/auth/jira/connect', requireStaff, (req, res) => {
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

app.use('/api/debug', requireStaff, requireDebugEndpoints);

app.post('/api/run', upload.single('file'), async (req, res) => {
  const staff = requestIsStaff(req);
  const customer = req.access?.role === 'customer';
  const customerUser = customer ? await getUserById(req.access.userId) : null;
  const fullReport = staff || Boolean(customerUser);
  const ip = clientIp(req);
  /** @type {string[]} */
  const candidates = [];
  /** @type {{ url: string, reason: string }[]} */
  let rejected = [];

  if (staff) {
    const urlText = req.body?.urls || '';
    if (urlText.trim()) {
      candidates.push(...collectUrlCandidates(urlText));
    }
  } else if (customerUser) {
    if (req.file) {
      return res.status(400).json({
        error: 'Sitemap uploads stay on staff scans for now. Paste public URLs from one domain.',
      });
    }
    const raw = String(req.body?.urls || req.body?.url || '').trim();
    const extracted = collectUrlCandidates(raw);
    candidates.push(...(extracted.length ? extracted : raw ? [raw] : []));
  } else {
    if (req.file) {
      return res.status(400).json({ error: 'File uploads are available after you sign in.' });
    }
    try {
      await verifyTurnstileIfConfigured(req.body?.turnstileToken || req.body?.['cf-turnstile-response'], ip);
    } catch (err) {
      const status = Number(err?.status) || 400;
      return res.status(status).json({
        error: err.message || 'Could not start the scan.',
        code: err.code || undefined,
        ctas: err.ctas,
      });
    }
    const rawUrl = String(req.body?.url || req.body?.urls || '').trim();
    candidates.push(rawUrl);
  }

  const maxUrls = staff
    ? process.env.MAX_URLS_PER_RUN
      ? parseInt(process.env.MAX_URLS_PER_RUN, 10)
      : 0
    : customerUser
      ? MAX_PAGES_PER_CUSTOMER_RUN
      : 1;

  if (staff && req.file) {
    const buf = req.file.buffer;
    const name = (req.file.originalname || '').toLowerCase();
    if (name.endsWith('.csv')) {
      candidates.push(...parseCsv(buf));
    } else if (name.endsWith('.xml')) {
      try {
        const fromSitemap = await parseSitemapBuffer(buf, {
          maxUrls: maxUrls > 0 ? maxUrls * 2 : 5000,
          urlGuard,
          rejected,
        });
        candidates.push(...fromSitemap.urls);
      } catch (err) {
        return res.status(400).json({ error: `Could not parse sitemap: ${err?.message || err}` });
      }
    } else {
      candidates.push(...collectUrlCandidates(buf.toString('utf8')));
    }
  }

  const filtered = await filterPublicHttpUrls(candidates, urlGuard);
  rejected = [...rejected, ...filtered.rejected];
  let urls = filtered.accepted;
  const requestedUrls = urls.length;

  if (urls.length === 0) {
    const firstReason = rejected[0]?.reason;
    return res.status(400).json({
      error: firstReason
        || (staff
          ? 'No valid URLs provided. Add URLs in the text area or upload a CSV/XML file.'
          : 'Enter one public http(s) URL to scan.'),
      rejected,
    });
  }

  if (!staff && !customerUser) {
    try {
      checkGuestFreeScan(req);
      if (guestIpHasRunningScan(ip)) {
        return res.status(409).json({ error: 'A free scan is already running from this network. Please wait for it to finish.' });
      }
    } catch (err) {
      const status = Number(err?.status) || 400;
      return res.status(status).json({
        error: err.message || 'Could not start the scan.',
        code: err.code || undefined,
        ctas: err.ctas,
      });
    }
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

  const domainKey = getSingleDomainKey(urls);
  if (!domainKey) {
    return res.status(400).json({
      error: 'Please provide URLs from one domain per run. Mixed-domain runs are not supported.',
    });
  }

  const domain = domainKey;
  // 409 only when this owner already has a run in progress — shared domains do not block others.
  if (!customerUser) {
    const concurrent = findRunningRun(runStatus, domain, ownerForAccess(req.access));
    if (concurrent) {
      return res.status(409).json({
        error: `A run for ${domain} is already in progress. Please wait for it to finish.`,
      });
    }
  }

  const runId = newRunId();
  const key = runKey(domain, runId);
  const guestToken = fullReport ? null : newGuestToken();
  let scanEntitlement = null;

  if (customerUser) {
    try {
      const reserved = await consumeAndQueueCustomerScan(
        customerUser.id,
        {
          pages: processedUrls,
          domain,
          guestFreebieUsed: guestFreebieClaimed(req),
          isActive: () =>
            Boolean(findRunningRun(runStatus, domain, ownerForAccess(req.access))) ||
            customerHasActiveScan(runStatus, customerUser.id),
        },
        async ({ entitlement }) => {
          scanEntitlement = entitlement;
          rememberRunEntitlement(runId, { ...entitlement, userId: customerUser.id });
          await attachRunToUser(customerUser.id, domain, runId);
          const queuedState = {
            domain,
            runId,
            status: 'queued',
            urls: processedUrls,
            requestedUrls,
            processedUrls,
            truncated,
            error: null,
            notifyRequested: false,
            notifyEmail: null,
            tier: 'customer',
            userId: customerUser.id,
            guestToken: null,
            entitlement,
          };
          await dbUpsertRun(domain, runId, {
            ...queuedState,
            statementMeta: {},
          });
          rememberRunStatus(key, queuedState);
        }
      );
      scanEntitlement = reserved.entitlement;
    } catch (err) {
      const status = Number(err?.status) || 400;
      return res.status(status).json({
        error: err.message || 'Scan is not allowed on this plan.',
        code: err.code || undefined,
        ctas: err.ctas,
      });
    }
  }

  const reportDir = runDirOf(domain, runId);
  try {
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
      status: 'queued',
      urls: processedUrls,
      requestedUrls,
      processedUrls,
      truncated,
      error: null,
      notifyRequested: !!(notifyOnComplete && notifyEmail),
      notifyEmail: notifyOnComplete && notifyEmail ? notifyEmail : null,
      tier: staff ? 'staff' : customerUser ? 'customer' : 'guest',
      userId: customerUser?.id || (staff ? 'staff' : null),
      guestToken,
      guestIp: fullReport ? null : ip,
      guestUrl: fullReport ? null : urls[0],
      entitlement: scanEntitlement,
    };
    notificationAttempted.delete(key);
    rememberRunStatus(key, initialState);
    if (!fullReport) {
      trackGuestRunStart(ip);
      persistGuestToken(guestToken, { domain, runId, url: urls[0], ip });
      markGuestFreeScan(req, res);
    }
    if (!customerUser) {
      dbUpsertRun(domain, runId, { ...initialState, statementMeta }).catch((err) => {
        console.error(`[run ${domain}/${runId}] DB initial write failed:`, err.message);
      });
    }

    enqueueScanJob({
      id: key,
      domain,
      runId,
      urls,
      processedUrls,
      requestedUrls,
      truncated,
      reportDir,
      userId: initialState.userId,
      tier: initialState.tier,
      guestIp: initialState.guestIp,
      hostResolverRules: hostResolverRulesFromTargets(filtered.targets),
    });
  } catch (err) {
    if (customerUser) {
      runStatePatch(domain, runId, {
        status: 'error',
        error: err?.message || String(err),
        userId: customerUser.id,
      });
    }
    throw err;
  }

  res.json({
    domain,
    runId,
    id: domain,
    reportId: domain,
    status: 'queued',
    urls: processedUrls,
    processedUrls,
    requestedUrls,
    truncated,
    maxUrls: maxUrls > 0 ? maxUrls : null,
    guestToken: guestToken || undefined,
    teaser: !fullReport,
    rejected: rejected.length ? rejected : undefined,
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
        status = rememberRunStatus(key, dbStatus);
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
    scannedPages: status.scannedPages ?? (status.status === 'done' ? status.processedUrls ?? status.urls : 0),
    currentUrl: status.currentUrl || null,
    truncated: !!status.truncated,
    error: status.error,
  };
}

app.use(async (req, res, next) => {
  const parsed = parseTenantPath(req.path);
  if (!parsed) return next();
  const { domain, runId, scoped } = parsed;
  if (domain === 'leads' || !isValidDomain(domain)) return next();
  let allowed = false;
  if (scoped === 'run') {
    const memoryRun = runStatus.get(runKey(domain, runId)) || null;
    allowed = await canAccessRun(req.access, domain, runId, { memoryRun });
  } else {
    allowed = await canAccessDomain(req.access, domain);
  }
  if (allowed) return next();
  if (req.path.startsWith('/api/')) {
    return res.status(403).json({ error: 'You do not have access to this project.' });
  }
  return res.status(403).send('You do not have access to this project.');
});

app.get('/api/status/:domain/:runId', async (req, res) => {
  const { domain, runId } = req.params;
  const out = await resolveStatus({ domain, runId });
  if (!out) return res.status(404).json({ error: 'Run not found' });
  if (out.error === 'Invalid run id') return res.status(400).json({ error: out.error });
  res.json(out);
});

/** Legacy: /api/status/:id resolves to the latest run the viewer may see. */
app.get('/api/status/:id', async (req, res) => {
  const domain = req.params.id;
  if (!isValidDomain(domain)) return res.status(400).json({ error: 'Invalid domain' });
  const runId = await resolveLatestRunIdForAccess(domain, req.access);
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
    scannedPages: out.scannedPages ?? 0,
    currentUrl: out.currentUrl || null,
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
  const resultJson = await loadResultJson(binding.domain, binding.runId);
  if (!resultJson) return res.status(404).json({ error: 'Results are not available yet.' });
  const teaser = buildTeaserPayload(resultJson, {
    domain: binding.domain,
    url: binding.url,
  });
  return res.json(teaser);
});

app.post('/api/lead', leadIpLimit, async (req, res) => {
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
          const resultJson = await loadResultJson(binding.domain, binding.runId);
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
    try {
      await recordConsent({
        userId: null,
        email,
        kind: 'lead_privacy',
        version: LEGAL_PRIVACY_VERSION,
        ip: clientIp(req),
        userAgent: req.headers['user-agent'],
        context: { source: 'scan-teaser', domain, runToken: token },
      });
    } catch (err) {
      console.error('[lead] consent failed:', err?.message || err);
    }
    return res.json({ ok: true, emailed });
  } catch (err) {
    console.error('[lead]', err?.message || err);
    return res.status(500).json({ error: 'Could not submit your request. Try again later.' });
  }
});

app.get('/api/admin/leads', async (req, res) => {
  if (req.access?.role !== 'staff') {
    return res.status(403).json({ error: 'Staff only.' });
  }
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

app.get('/api/jira/oauth/status', requireStaff, async (req, res) => {
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

app.get('/api/jira/projects', requireStaff, async (req, res) => {
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

app.post('/api/jira/sprint', requireStaff, async (req, res) => {
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

app.get('/api/audits', async (req, res) => {
  try {
    const viewer =
      req.access?.role === 'customer'
        ? {
            role: 'customer',
            userId: req.access.userId,
            projects: await listProjectsForUser(req.access.userId),
          }
        : { role: req.access?.role };
    const audits = await listAuditEntries(dbPool, REPORTS_BASE, viewer);
    return res.json({ audits });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.get('/api/audits/:domain/runs', async (req, res) => {
  const domain = req.params.domain;
  if (!isValidDomain(domain)) return res.status(400).json({ error: 'Invalid domain' });
  if (!(await canAccessDomain(req.access, domain))) {
    return res.status(403).json({ error: 'You do not have access to this project.' });
  }
  try {
    const project =
      req.access?.role === 'customer' ? await findProjectByDomain(req.access.userId, domain) : null;
    const runs = filterRunsForViewer(await listRunsForDomain(dbPool, REPORTS_BASE, domain), {
      role: req.access?.role,
      userId: req.access?.userId,
      allowedRunIds: project?.runIds,
    });
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

/** Customers: latest run they own (including an in-flight one). Staff: domain-wide latest. */
async function resolveLatestRunIdForAccess(domain, access) {
  if (!isValidDomain(domain)) return null;
  if (access?.role === 'customer' && access.userId) {
    const running = findRunningRun(runStatus, domain, { userId: access.userId });
    if (running?.runId) return running.runId;
    const project = await findProjectByDomain(access.userId, domain);
    const runs = filterRunsForViewer(await listRunsForDomain(dbPool, REPORTS_BASE, domain), {
      role: 'customer',
      userId: access.userId,
      allowedRunIds: project?.runIds,
    });
    return runs[0]?.runId || null;
  }
  const running = findRunningRun(runStatus, domain);
  if (running?.runId) return running.runId;
  return resolveLatestRunIdForDomain(domain);
}

function parseManualProgressRaw(raw) {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    return { checked: normalizeManualProgress(data.checked) };
  } catch {
    return null;
  }
}

async function readManualProgressRaw(localPath, remotePath) {
  let raw = null;
  try {
    raw = await ftpDownload(FTP_CONFIG, remotePath);
  } catch {}
  if (!raw && existsSync(localPath)) raw = readFileSync(localPath, 'utf8');
  return { raw, exists: !!raw || existsSync(localPath) };
}

async function readManualProgress(domain, runId) {
  const runPath = join(runDirOf(domain, runId), 'manual-progress.json');

  const runSnap = await readManualProgressRaw(runPath, `${domain}/${runId}/manual-progress.json`);
  const runParsed = parseManualProgressRaw(runSnap.raw);

  let dbChecked = null;
  if (!runSnap.exists && dbPool) {
    try {
      const dbRun = await dbGetRun(domain, runId);
      if (dbRun && dbRun.manualProgress && Array.isArray(dbRun.manualProgress.checked)) {
        dbChecked = dbRun.manualProgress.checked;
      }
    } catch (err) {
      console.error(`[run ${domain}/${runId}] DB manual-progress lookup failed:`, err.message);
    }
  }

  return {
    checked: resolvePersistedManualChecked({
      runFileExists: runSnap.exists,
      runChecked: runParsed?.checked,
      dbChecked,
    }),
  };
}

app.get('/api/report/:domain/:runId/manual-progress', async (req, res) => {
  const { domain, runId } = req.params;
  if (!isValidDomain(domain) || !isValidRunId(runId)) return res.status(400).json({ error: 'Invalid run id' });
  res.json(await readManualProgress(domain, runId));
});

app.get('/api/report/:id/manual-progress', async (req, res) => {
  const domain = req.params.id;
  if (!isValidDomain(domain)) return res.status(400).json({ error: 'Invalid domain' });
  const runId = await resolveLatestRunIdForAccess(domain, req.access);
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
  const runId = await resolveLatestRunIdForAccess(domain, req.access);
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
  const runId = await resolveLatestRunIdForAccess(domain, req.access);
  if (!runId) return res.status(404).json({ error: 'Report not found' });
  const checked = req.body?.checked;
  if (!Array.isArray(checked)) return res.status(400).json({ error: 'Body must include checked array' });
  const out = await writeManualProgress(domain, runId, checked);
  if (out.error) return res.status(out.status).json({ error: out.error });
  res.json({ ok: true, checked: out.checked });
});

function wcagAnalysisCachePath(domain, runId) {
  return join(runDirOf(domain, runId), 'wcag-analysis.json');
}

function readWcagAnalysisCache(domain, runId) {
  const p = wcagAnalysisCachePath(domain, runId);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function writeWcagAnalysisCache(domain, runId, body) {
  const dir = runDirOf(domain, runId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const p = wcagAnalysisCachePath(domain, runId);
  writeFileSync(p, JSON.stringify(body, null, 2), 'utf8');
  if (FTP_CONFIG) {
    ftpUpload(FTP_CONFIG, p, `${domain}/${runId}/wcag-analysis.json`).catch(() => {});
  }
}

async function readRunReportData(domain, runId) {
  if (dbPool) {
    try {
      const dbRun = await dbGetRun(domain, runId);
      if (dbRun?.resultJson) return dbRun.resultJson;
    } catch (err) {
      console.error(`[run ${domain}/${runId}] report JSON lookup failed:`, err.message);
    }
  }
  const filePath = join(runDirOf(domain, runId), 'accessibility-results.json');
  let raw = existsSync(filePath) ? readFileSync(filePath, 'utf8') : null;
  if (!raw) {
    try {
      raw = await ftpDownload(FTP_CONFIG, `${domain}/${runId}/accessibility-results.json`);
    } catch {
      raw = null;
    }
  }
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function publicWcagAnalysis(payload) {
  return {
    standard: payload.coverage.standard,
    total: payload.coverage.total,
    pages: payload.coverage.pages,
    counts: payload.coverage.counts,
    buckets: payload.coverage.buckets,
    criteria: payload.coverage.criteria,
    narrative: payload.narrative,
    source: payload.source,
    model: payload.model,
    hash: payload.hash,
    llmAvailable: payload.llmAvailable,
    llmError: payload.llmError || null,
  };
}

async function handleWcagAnalysis(domain, runId, { forceLlm }) {
  const reportData = await readRunReportData(domain, runId);
  if (!reportData) return { status: 404, error: 'Report not found' };
  const progress = await readManualProgress(domain, runId);
  const key = `${runKey(domain, runId)}:${forceLlm ? 'llm' : 'read'}`;
  if (wcagAnalysisInflight.has(key)) {
    return wcagAnalysisInflight.get(key);
  }
  const job = (async () => {
    const cached = readWcagAnalysisCache(domain, runId);
    const payload = await buildWcagAnalysisPayload(reportData, progress.checked, {
      forceLlm: Boolean(forceLlm) && anthropicConfigured(),
      cached,
    });
    if (!cached || cached.hash !== payload.hash || cached.source !== payload.source) {
      writeWcagAnalysisCache(domain, runId, analysisCacheBody(payload));
    }
    return { status: 200, body: publicWcagAnalysis(payload) };
  })();
  wcagAnalysisInflight.set(key, job);
  try {
    return await job;
  } finally {
    wcagAnalysisInflight.delete(key);
  }
}

app.get('/api/report/:domain/:runId/wcag-analysis', async (req, res) => {
  const { domain, runId } = req.params;
  if (!isValidDomain(domain) || !isValidRunId(runId)) return res.status(400).json({ error: 'Invalid run id' });
  const out = await handleWcagAnalysis(domain, runId, { forceLlm: false });
  if (out.error) return res.status(out.status).json({ error: out.error });
  res.json(out.body);
});

app.post('/api/report/:domain/:runId/wcag-analysis', async (req, res) => {
  const { domain, runId } = req.params;
  if (!isValidDomain(domain) || !isValidRunId(runId)) return res.status(400).json({ error: 'Invalid run id' });
  const out = await handleWcagAnalysis(domain, runId, { forceLlm: true });
  if (out.error) return res.status(out.status).json({ error: out.error });
  res.json(out.body);
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
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
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
  const owner = req.access?.role === 'customer' ? { userId: req.access.userId } : null;
  const running = findRunningRun(runStatus, domain, owner);
  if (running) {
    return res.redirect(`${loadingPath}?domain=${encodeURIComponent(domain)}&runId=${encodeURIComponent(running.runId)}`);
  }
  const runId = await resolveLatestRunIdForAccess(domain, req.access);
  if (!runId) return res.status(404).send('Report not found');
  const target = `/report/${encodeURIComponent(domain)}/${encodeURIComponent(runId)}/`;
  return res.redirect(req.path.endsWith('/') ? 302 : 301, target);
});

app.get('/report/:domain/', async (req, res) => {
  const domain = req.params.domain;
  if (!isValidDomain(domain)) return res.status(400).send('Invalid domain');
  const owner = req.access?.role === 'customer' ? { userId: req.access.userId } : null;
  const running = findRunningRun(runStatus, domain, owner);
  if (running) {
    return res.redirect(`${loadingPath}?domain=${encodeURIComponent(domain)}&runId=${encodeURIComponent(running.runId)}`);
  }
  const runId = await resolveLatestRunIdForAccess(domain, req.access);
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

  if (process.env.NODE_ENV !== 'production') {
    app.get('/api/__test/throw', async () => {
      throw new Error('test-throw');
    });
  }

  app.use(errorMiddleware);

  return app;
}
