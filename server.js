#!/usr/bin/env node
/**
 * Web server for accessibility testing UI.
 * Provides form to add URLs or upload CSV/XML, runs tests, and serves reports by unique ID.
 */

import express from 'express';
import multer from 'multer';
import { spawn } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Client } from 'basic-ftp';
import pg from 'pg';
import { sendRunNotificationEmail, createSmtpTransport } from './server-email.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPORTS_BASE = join(__dirname, 'reports');
const PORT = process.env.PORT || 3456;
const { Pool } = pg;
const APP_PASSWORD = process.env.APP_PASSWORD || 'WCAG@Us2.0';
const AUTH_ENABLED = parseBooleanEnv('AUTH_ENABLED', true);
const AUTH_COOKIE_NAME = 'wcag_access';
const AUTH_COOKIE_SECURE = parseBooleanEnv('AUTH_COOKIE_SECURE', false);

function parseBooleanEnv(name, defaultValue = false) {
  const raw = process.env[name];
  if (raw == null) return defaultValue;
  const value = String(raw).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(value)) return true;
  if (['0', 'false', 'no', 'off'].includes(value)) return false;
  return defaultValue;
}

const DATABASE_URL = process.env.DATABASE_URL || '';
const DB_ENABLED = !!DATABASE_URL;
const DB_SSL = parseBooleanEnv('DATABASE_SSL', false);
const dbPool = DB_ENABLED
  ? new Pool({
      connectionString: DATABASE_URL,
      ssl: DB_SSL ? { rejectUnauthorized: false } : undefined,
    })
  : null;

async function initDb() {
  if (!dbPool) return;
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      urls INTEGER,
      processed_urls INTEGER,
      requested_urls INTEGER,
      truncated BOOLEAN DEFAULT FALSE,
      error TEXT,
      notify_requested BOOLEAN DEFAULT FALSE,
      notify_email TEXT,
      statement_meta_json JSONB,
      result_json JSONB,
      manual_progress_json JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function dbUpsertRun(id, patch = {}) {
  if (!dbPool || !id) return;
  const status = patch.status || 'running';
  await dbPool.query(
    `
      INSERT INTO runs (
        id, status, urls, processed_urls, requested_urls, truncated, error,
        notify_requested, notify_email, statement_meta_json, result_json, manual_progress_json
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10::jsonb, $11::jsonb, $12::jsonb
      )
      ON CONFLICT (id) DO UPDATE SET
        status = COALESCE(EXCLUDED.status, runs.status),
        urls = COALESCE(EXCLUDED.urls, runs.urls),
        processed_urls = COALESCE(EXCLUDED.processed_urls, runs.processed_urls),
        requested_urls = COALESCE(EXCLUDED.requested_urls, runs.requested_urls),
        truncated = COALESCE(EXCLUDED.truncated, runs.truncated),
        error = COALESCE(EXCLUDED.error, runs.error),
        notify_requested = COALESCE(EXCLUDED.notify_requested, runs.notify_requested),
        notify_email = COALESCE(EXCLUDED.notify_email, runs.notify_email),
        statement_meta_json = COALESCE(EXCLUDED.statement_meta_json, runs.statement_meta_json),
        result_json = COALESCE(EXCLUDED.result_json, runs.result_json),
        manual_progress_json = COALESCE(EXCLUDED.manual_progress_json, runs.manual_progress_json),
        updated_at = NOW()
    `,
    [
      id,
      status,
      patch.urls ?? null,
      patch.processedUrls ?? null,
      patch.requestedUrls ?? null,
      patch.truncated ?? null,
      patch.error ?? null,
      patch.notifyRequested ?? null,
      patch.notifyEmail ?? null,
      patch.statementMeta ? JSON.stringify(patch.statementMeta) : null,
      patch.resultJson ? JSON.stringify(patch.resultJson) : null,
      patch.manualProgress ? JSON.stringify(patch.manualProgress) : null,
    ]
  );
}

async function dbGetRun(id) {
  if (!dbPool || !id) return null;
  const { rows } = await dbPool.query(
    `SELECT id, status, urls, processed_urls, requested_urls, truncated, error, notify_requested, notify_email, result_json, manual_progress_json
     FROM runs WHERE id = $1 LIMIT 1`,
    [id]
  );
  if (!rows.length) return null;
  const row = rows[0];
  return {
    id: row.id,
    status: row.status,
    urls: row.urls ?? 0,
    processedUrls: row.processed_urls ?? row.urls ?? 0,
    requestedUrls: row.requested_urls ?? row.urls ?? 0,
    truncated: !!row.truncated,
    error: row.error || null,
    notifyRequested: !!row.notify_requested,
    notifyEmail: row.notify_email || null,
    resultJson: row.result_json || null,
    manualProgress: row.manual_progress_json || null,
  };
}

function computeIssueCountFromResult(resultJson) {
  if (!resultJson || typeof resultJson !== 'object') return 0;
  const summary = resultJson.summary || {};
  const fail = Number(summary.fail || 0);
  const warn = Number(summary.warn || 0);
  const axe = Object.values(resultJson.axeResults || {}).reduce(
    (sum, r) => sum + Number((r && r.violations && r.violations.length) || 0),
    0
  );
  return fail + warn + axe;
}

async function listAuditEntries() {
  const byId = new Map();

  if (dbPool) {
    try {
      const { rows } = await dbPool.query(
        `SELECT id, status, updated_at, created_at, processed_urls, requested_urls, result_json
         FROM runs
         ORDER BY updated_at DESC
         LIMIT 1000`
      );
      rows.forEach((row) => {
        const resultJson = row.result_json || null;
        const urls = Array.isArray(resultJson?.urls) ? resultJson.urls : [];
        byId.set(row.id, {
          id: row.id,
          status: row.status || 'unknown',
          updatedAt: row.updated_at || row.created_at || null,
          pages: urls.length || Number(row.processed_urls || row.requested_urls || 0),
          issues: computeIssueCountFromResult(resultJson),
          source: 'db',
        });
      });
    } catch (err) {
      console.error('Failed to list audits from DB:', err.message);
    }
  }

  try {
    if (existsSync(REPORTS_BASE)) {
      const entries = readdirSync(REPORTS_BASE);
      entries.forEach((name) => {
        const dir = join(REPORTS_BASE, name);
        let isDir = false;
        try { isDir = statSync(dir).isDirectory(); } catch {}
        if (!isDir || !isValidReportId(name)) return;
        const resultsFile = join(dir, 'accessibility-results.json');
        if (!existsSync(resultsFile)) return;
        if (byId.has(name)) return;
        const resultJson = readJsonIfExists(resultsFile);
        const urls = Array.isArray(resultJson?.urls) ? resultJson.urls : [];
        byId.set(name, {
          id: name,
          status: 'done',
          updatedAt: (() => {
            try { return statSync(resultsFile).mtime; } catch { return null; }
          })(),
          pages: urls.length,
          issues: computeIssueCountFromResult(resultJson),
          source: 'file',
        });
      });
    }
  } catch (err) {
    console.error('Failed to list audits from files:', err.message);
  }

  return [...byId.values()].sort((a, b) => {
    const ta = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
    const tb = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
    return tb - ta;
  });
}

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

function runStatePatch(id, patch) {
  const prev = runStatus.get(id) || {};
  const next = { ...prev, ...patch };
  runStatus.set(id, next);
  dbUpsertRun(id, next).catch((err) => {
    console.error(`[run ${id}] DB state update failed:`, err.message);
  });
  void maybeSendRunEmail(id);
}

async function maybeSendRunEmail(id) {
  if (notificationAttempted.has(id)) return;
  const cur = runStatus.get(id);
  if (!cur?.notifyRequested || !cur.notifyEmail) return;
  if (cur.status !== 'done' && cur.status !== 'error') return;
  notificationAttempted.add(id);
  const base = (process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
  const reportUrl = `${base}/report/${id}/`;
  if (!createSmtpTransport()) {
    console.warn(
      `[run ${id}] Notification requested for ${cur.notifyEmail} but SMTP is not configured (set SMTP_HOST and related env vars).`
    );
    return;
  }
  try {
    await sendRunNotificationEmail({
      to: cur.notifyEmail,
      reportId: id,
      status: cur.status,
      error: cur.error || null,
      reportUrl,
    });
  } catch (err) {
    console.error(`[run ${id}] Notification email failed:`, err.message);
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

function emptyReport() {
  return {
    generatedAt: new Date().toISOString(),
    urls: [],
    axeResults: {},
    customResults: [],
    summary: { pass: 0, fail: 0, warn: 0 },
    screenshots: {},
  };
}

function computeCustomSummary(customResults) {
  const summary = { pass: 0, fail: 0, warn: 0 };
  (customResults || []).forEach((r) => {
    if (r.status === 'pass') summary.pass += 1;
    else if (r.status === 'fail') summary.fail += 1;
    else summary.warn += 1;
  });
  return summary;
}

function mergeReportData(existing, incoming) {
  const prev = existing || emptyReport();
  const next = incoming || emptyReport();
  const incomingUrls = new Set(next.urls || []);

  const merged = {
    generatedAt: new Date().toISOString(),
    urls: [...new Set([...(prev.urls || []), ...(next.urls || [])])],
    axeResults: { ...(prev.axeResults || {}) },
    customResults: [],
    screenshots: { ...(prev.screenshots || {}) },
    summary: { pass: 0, fail: 0, warn: 0 },
  };

  Object.entries(next.axeResults || {}).forEach(([url, data]) => {
    merged.axeResults[url] = data;
  });

  const keptCustom = (prev.customResults || []).filter((r) => !incomingUrls.has(r.url));
  const mergedCustom = [...keptCustom, ...(next.customResults || [])];
  merged.customResults = mergedCustom;
  merged.summary = computeCustomSummary(mergedCustom);

  Object.entries(next.screenshots || {}).forEach(([url, value]) => {
    merged.screenshots[url] = value;
  });

  return merged;
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

function parseXml(buffer) {
  const text = buffer.toString('utf8');
  const urls = [];
  const locMatch = text.matchAll(/<loc>([^<]+)<\/loc>/gi);
  for (const m of locMatch) urls.push(m[1].trim());
  const urlMatch = text.matchAll(/<url>([^<]+)<\/url>/gi);
  for (const m of urlMatch) urls.push(m[1].trim());
  return [...new Set(urls)];
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

const app = express();

// CORS: allow requests from Combell or any frontend (set ALLOWED_ORIGIN to restrict)
const allowedOrigin = process.env.ALLOWED_ORIGIN || '*';
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-App-Password');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

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

function passwordFromRequest(req) {
  const headerPwd = req.headers['x-app-password'];
  if (typeof headerPwd === 'string' && headerPwd) return headerPwd;
  const qp = req.query?.password;
  if (typeof qp === 'string' && qp) return qp;
  return '';
}

function setAuthCookie(res) {
  const securePart = AUTH_COOKIE_SECURE ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${AUTH_COOKIE_NAME}=1; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200${securePart}`);
}

function loginPageHtml(nextPath = '/', errorMessage = '') {
  const safeNext = String(nextPath || '/').replace(/"/g, '&quot;');
  const safeError = errorMessage ? `<p style="color:#c62828; margin:0 0 10px;">${errorMessage}</p>` : '';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex, nofollow, noarchive, nosnippet, noimageindex" />
  <title>Protected accessibility reports</title>
  <style>
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin:0; min-height:100vh; display:grid; place-items:center; background:#fafaf8; color:#1a1a1a; padding:20px; }
    .card { width:min(460px, 100%); background:#fff; border:1px solid #e8e6e1; border-radius:12px; padding:22px; box-shadow:0 2px 16px rgba(0,0,0,.06); }
    h1 { margin:0 0 8px; font-size:1.2rem; }
    p { margin:0 0 14px; color:#5c5c5c; }
    label { display:block; margin:0 0 6px; font-weight:600; }
    input { width:100%; box-sizing:border-box; padding:10px 12px; border:1px solid #d9d7d2; border-radius:8px; font-size:1rem; }
    button { margin-top:12px; width:100%; padding:10px 12px; border:0; border-radius:8px; background:#2d9d78; color:#fff; font-weight:600; cursor:pointer; }
    button:hover { filter:brightness(1.03); }
  </style>
</head>
<body>
  <form class="card" method="post" action="/auth/login">
    <h1>Protected area</h1>
    <p>Enter the password to continue.</p>
    ${safeError}
    <input type="hidden" name="next" value="${safeNext}" />
    <label for="password">Password</label>
    <input id="password" name="password" type="password" required autofocus />
    <button type="submit">Continue</button>
  </form>
</body>
</html>`;
}

app.use((req, res, next) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet, noimageindex');
  next();
});

app.get('/robots.txt', (_req, res) => {
  res.type('text/plain');
  res.send('User-agent: *\nDisallow: /');
});

app.get('/auth/login', (req, res) => {
  if (!AUTH_ENABLED) return res.redirect('/');
  const nextPath = typeof req.query.next === 'string' && req.query.next.startsWith('/') ? req.query.next : '/';
  return res.status(200).send(loginPageHtml(nextPath));
});

app.post('/auth/login', (req, res) => {
  if (!AUTH_ENABLED) return res.redirect('/');
  const nextPath = typeof req.body?.next === 'string' && req.body.next.startsWith('/') ? req.body.next : '/';
  const password = String(req.body?.password || '');
  if (password !== APP_PASSWORD) {
    return res.status(401).send(loginPageHtml(nextPath, 'Incorrect password. Try again.'));
  }
  setAuthCookie(res);
  return res.redirect(nextPath);
});

app.use((req, res, next) => {
  if (!AUTH_ENABLED) return next();
  if (req.path === '/robots.txt') return next();
  if (req.path === '/auth/login') return next();
  if (
    req.method === 'GET' &&
    (req.path === '/' ||
      req.path === '/index.html' ||
      req.path === '/loading.html' ||
      req.path.startsWith('/assets/'))
  ) {
    return next();
  }
  const cookies = parseCookies(req);
  if (cookies[AUTH_COOKIE_NAME] === '1') return next();
  const providedPassword = passwordFromRequest(req);
  if (providedPassword && providedPassword === APP_PASSWORD) {
    setAuthCookie(res);
    if (!req.path.startsWith('/api/') && typeof req.query?.password === 'string') {
      const cleanQuery = { ...req.query };
      delete cleanQuery.password;
      const qs = new URLSearchParams(cleanQuery).toString();
      const target = `${req.path}${qs ? `?${qs}` : ''}`;
      return res.redirect(target);
    }
    return next();
  }
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const nextPath = req.originalUrl || '/';
  return res.redirect(`/auth/login?next=${encodeURIComponent(nextPath)}`);
});

app.use(express.static(join(__dirname, 'public')));

app.post('/api/run', upload.single('file'), (req, res) => {
  let urls = [];

  const urlText = req.body?.urls || '';
  if (urlText.trim()) {
    urls = extractUrlsFromText(urlText);
  }

  if (req.file) {
    const buf = req.file.buffer;
    const name = (req.file.originalname || '').toLowerCase();
    if (name.endsWith('.csv')) {
      urls = [...urls, ...parseCsv(buf)];
    } else if (name.endsWith('.xml')) {
      urls = [...urls, ...parseXml(buf)];
    } else {
      urls = [...urls, ...extractUrlsFromText(buf.toString('utf8'))];
    }
  }

  urls = [...new Set(urls)].filter((u) => u.startsWith('http'));
  const requestedUrls = urls.length;

  if (urls.length === 0) {
    return res.status(400).json({ error: 'No valid URLs provided. Add URLs in the text area or upload a CSV/XML file.' });
  }

  const maxUrls = process.env.MAX_URLS_PER_RUN ? parseInt(process.env.MAX_URLS_PER_RUN, 10) : 0;
  if (maxUrls > 0 && urls.length > maxUrls) {
    urls = urls.slice(0, maxUrls);
  }
  const processedUrls = urls.length;
  const truncated = processedUrls < requestedUrls;

  const { notifyOnComplete, notifyEmail } = parseNotifyFields(req.body || {});
  if (notifyOnComplete && !isValidEmail(notifyEmail)) {
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

  const id = domainKey;
  if (runStatus.get(id)?.status === 'running') {
    return res.status(409).json({
      error: `A run for ${id} is already in progress. Please wait for it to finish.`,
    });
  }

  const reportDir = join(REPORTS_BASE, id);
  if (!existsSync(reportDir)) mkdirSync(reportDir, { recursive: true });

  const statementMeta = parseStatementMeta(req.body || {});
  try {
    writeFileSync(join(reportDir, 'statement-meta.json'), JSON.stringify(statementMeta, null, 2), 'utf8');
  } catch (err) {
    console.error('statement-meta write failed:', err.message);
  }

  const initialState = {
    status: 'running',
    urls: processedUrls,
    requestedUrls,
    processedUrls,
    truncated,
    error: null,
    notifyRequested: !!(notifyOnComplete && notifyEmail),
    notifyEmail: notifyOnComplete && notifyEmail ? notifyEmail : null,
  };
  notificationAttempted.delete(id);
  runStatus.set(id, initialState);
  dbUpsertRun(id, { ...initialState, statementMeta }).catch((err) => {
    console.error(`[run ${id}] DB initial write failed:`, err.message);
  });

  const urlsArg = urls.join('\n');
  const child = spawn(
    process.execPath,
    [join(__dirname, 'run-tests.js'), '--report', `--urls=${urlsArg}`, `--output-id=${id}`],
    {
      cwd: __dirname,
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );

  let stderr = '';
  child.stderr?.on('data', (d) => { stderr += d.toString(); });
  child.stdout?.on('data', () => {});

  child.on('close', (code) => {
    const reportPath = join(reportDir, 'accessibility-report.html');
    const resultsPath = join(reportDir, 'accessibility-results.json');

    if (code === 0 && existsSync(reportPath)) {
      finalizeSuccessfulRun({ id, reportDir, processedUrls, requestedUrls, truncated })
        .then((ok) => {
          if (!ok) {
            runStatePatch(id, { status: 'error', urls: processedUrls, processedUrls, requestedUrls, truncated, error: 'Report generation failed.' });
          }
        })
        .catch((err) => {
          runStatePatch(id, { status: 'error', urls: processedUrls, processedUrls, requestedUrls, truncated, error: err.message });
        });
      return;
    }
    if (code === 0 && !existsSync(reportPath)) {
      const pollForReport = (attempts = 0) => {
        if (existsSync(reportPath)) {
          finalizeSuccessfulRun({ id, reportDir, processedUrls, requestedUrls, truncated })
            .then((ok) => {
              if (!ok) {
                runStatePatch(id, { status: 'error', urls: processedUrls, processedUrls, requestedUrls, truncated, error: 'Report generation failed.' });
              }
            })
            .catch((err) => {
              runStatePatch(id, { status: 'error', urls: processedUrls, processedUrls, requestedUrls, truncated, error: err.message });
            });
          return;
        }
        if (attempts < 5) {
          setTimeout(() => pollForReport(attempts + 1), 500);
        } else if (existsSync(resultsPath)) {
          (async () => {
            try {
              const { generateReport } = await import('./generate-report.js');
              generateReport(null, { outputDir: reportDir });
              if (existsSync(reportPath)) {
                const ok = await finalizeSuccessfulRun({ id, reportDir, processedUrls, requestedUrls, truncated });
                if (!ok) {
                  runStatePatch(id, { status: 'error', urls: processedUrls, processedUrls, requestedUrls, truncated, error: 'Report generation failed.' });
                }
              } else {
                runStatePatch(id, { status: 'error', urls: processedUrls, processedUrls, requestedUrls, truncated, error: 'Report generation failed.' });
              }
            } catch (err) {
              runStatePatch(id, { status: 'error', urls: processedUrls, processedUrls, requestedUrls, truncated, error: err.message });
            }
          })();
        } else {
          runStatePatch(id, {
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
    runStatePatch(id, {
      status: 'error',
      urls: processedUrls,
      processedUrls,
      requestedUrls,
      truncated,
      error: stderr || `Process exited with code ${code}`,
    });
  });

  child.on('error', (err) => {
    runStatePatch(id, {
      status: 'error',
      urls: processedUrls,
      processedUrls,
      requestedUrls,
      truncated,
      error: err.message,
    });
  });

  res.json({
    id,
    reportId: id,
    domain: id,
    urls: processedUrls,
    processedUrls,
    requestedUrls,
    truncated,
    maxUrls: maxUrls > 0 ? maxUrls : null,
  });
});

app.get('/api/status/:id', async (req, res) => {
  const id = req.params.id;
  let status = runStatus.get(id);
  if (!status && dbPool) {
    try {
      const dbStatus = await dbGetRun(id);
      if (dbStatus) {
        status = dbStatus;
        runStatus.set(id, dbStatus);
      }
    } catch (err) {
      console.error(`[run ${id}] DB status lookup failed:`, err.message);
    }
  }
  const reportPath = join(REPORTS_BASE, id, 'accessibility-report.html');

  if (!status) {
    if (existsSync(reportPath)) {
      return res.json({ status: 'done', urls: 0 });
    }
    const remoteReport = await ftpDownload(`${id}/accessibility-report.html`);
    if (remoteReport) {
      return res.json({ status: 'done', urls: 0 });
    }
    return res.status(404).json({ error: 'Run not found' });
  }

  res.json({
    status: status.status,
    urls: status.urls,
    processedUrls: status.processedUrls ?? status.urls,
    requestedUrls: status.requestedUrls ?? status.urls,
    truncated: !!status.truncated,
    error: status.error,
  });
});

function isValidReportId(id) {
  return /^[a-zA-Z0-9.-]+$/.test(id) && id.length <= 120;
}

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

app.get('/api/audits', async (_req, res) => {
  try {
    const audits = await listAuditEntries();
    return res.json({ audits });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

const FTP_CONFIG = process.env.FTP_HOST && process.env.FTP_USER
  ? {
      host: process.env.FTP_HOST,
      user: process.env.FTP_USER,
      password: process.env.FTP_PASSWORD || '',
      secure: process.env.FTP_SECURE === 'true',
      remotePath: (process.env.FTP_REMOTE_PATH || '').replace(/\/$/, ''),
    }
  : null;

async function ftpDownload(remotePath) {
  if (!FTP_CONFIG) return null;
  const client = new Client(60_000);
  try {
    await client.access({
      host: FTP_CONFIG.host,
      user: FTP_CONFIG.user,
      password: FTP_CONFIG.password,
      secure: FTP_CONFIG.secure,
    });
    const fullPath = FTP_CONFIG.remotePath ? `${FTP_CONFIG.remotePath}/${remotePath}` : remotePath;
    const localFile = join(REPORTS_BASE, remotePath);
    const dir = dirname(localFile);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    await client.downloadTo(localFile, fullPath);
    return readFileSync(localFile, 'utf8');
  } catch {
    return null;
  } finally {
    client.close();
  }
}

async function ftpUpload(localPath, remotePath) {
  if (!FTP_CONFIG) return;
  const client = new Client(60_000);
  try {
    await client.access({
      host: FTP_CONFIG.host,
      user: FTP_CONFIG.user,
      password: FTP_CONFIG.password,
      secure: FTP_CONFIG.secure,
    });
    const fullRemote = FTP_CONFIG.remotePath ? `${FTP_CONFIG.remotePath}/${remotePath}` : remotePath;
    const remoteDir = dirname(fullRemote);
    if (remoteDir !== '.') await client.ensureDir(remoteDir);
    await client.uploadFrom(localPath, fullRemote);
  } catch (err) {
    console.error('FTP upload failed:', err.message);
  } finally {
    client.close();
  }
}

function listScreenshotFiles(reportDir) {
  const shotsDir = join(reportDir, 'screenshots');
  if (!existsSync(shotsDir)) return [];
  try {
    return readdirSync(shotsDir)
      .filter((name) => {
        const p = join(shotsDir, name);
        try {
          return statSync(p).isFile();
        } catch {
          return false;
        }
      })
      .map((name) => ({ local: join(shotsDir, name), remote: `screenshots/${name}` }));
  } catch {
    return [];
  }
}

function readJsonIfExists(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

async function finalizeSuccessfulRun({
  id,
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
      const previous = await dbGetRun(id);
      resultJson = mergeReportData(previous?.resultJson || null, resultJson);
      writeFileSync(resultsPath, JSON.stringify(resultJson, null, 2), 'utf8');
    } catch (err) {
      console.error(`[run ${id}] DB merge failed:`, err.message);
    }
  }
  if (resultJson) {
    try {
      const { generateReport } = await import('./generate-report.js');
      generateReport(resultJson, { outputDir: reportDir });
    } catch (err) {
      console.error(`[run ${id}] Report regeneration failed:`, err.message);
    }
  }
  if (existsSync(reportPath)) {
    persistReportArtifactsToFtp(id).catch((err) => {
      console.error(`[run ${id}] FTP persistence failed:`, err.message);
    });
    runStatePatch(id, { status: 'done', urls: processedUrls, processedUrls, requestedUrls, truncated, error: null, resultJson });
    return true;
  }
  return false;
}

async function persistReportArtifactsToFtp(id) {
  if (!FTP_CONFIG) return;
  const reportDir = join(REPORTS_BASE, id);
  const baseFiles = [
    'accessibility-report.html',
    'accessibility-client.html',
    'accessibility-developers.html',
    'accessibility-statement.html',
    'accessibility-results.json',
    'accessibility-results-previous.json',
    'statement-meta.json',
    'manual-progress.json',
  ];
  const jobs = [];
  baseFiles.forEach((name) => {
    const local = join(reportDir, name);
    if (existsSync(local)) jobs.push({ local, remote: `${id}/${name}` });
  });
  listScreenshotFiles(reportDir).forEach((f) => {
    jobs.push({ local: f.local, remote: `${id}/${f.remote}` });
  });
  for (const j of jobs) {
    await ftpUpload(j.local, j.remote);
  }
}

app.get('/api/report/:id/manual-progress', async (req, res) => {
  const id = req.params.id;
  if (!isValidReportId(id)) return res.status(400).json({ error: 'Invalid report ID' });
  if (dbPool) {
    try {
      const dbRun = await dbGetRun(id);
      if (dbRun && dbRun.manualProgress && Array.isArray(dbRun.manualProgress.checked)) {
        return res.json({ checked: dbRun.manualProgress.checked });
      }
    } catch (err) {
      console.error(`[run ${id}] DB manual-progress lookup failed:`, err.message);
    }
  }
  const filePath = join(REPORTS_BASE, id, 'manual-progress.json');
  let raw = null;
  try {
    raw = await ftpDownload(`${id}/manual-progress.json`);
  } catch {}
  if (!raw && existsSync(filePath)) raw = readFileSync(filePath, 'utf8');
  if (!raw) return res.json({ checked: [] });
  try {
    const data = JSON.parse(raw);
    res.json({ checked: Array.isArray(data.checked) ? data.checked : [] });
  } catch {
    res.json({ checked: [] });
  }
});

app.get('/api/report/:id/urls', async (req, res) => {
  const id = req.params.id;
  if (!isValidReportId(id)) return res.status(400).json({ error: 'Invalid report ID' });

  // Prefer DB-backed merged data when available.
  if (dbPool) {
    try {
      const dbRun = await dbGetRun(id);
      if (dbRun && dbRun.resultJson) {
        const urls = Array.isArray(dbRun.resultJson.urls)
          ? [...new Set(dbRun.resultJson.urls.map((u) => String(u)).filter(Boolean))]
          : [];
        return res.json({
          id,
          urls,
          count: urls.length,
          source: 'db',
        });
      }
    } catch (err) {
      console.error(`[run ${id}] DB urls lookup failed:`, err.message);
    }
  }

  // Fallback to local file, then FTP.
  const filePath = join(REPORTS_BASE, id, 'accessibility-results.json');
  let raw = null;
  if (existsSync(filePath)) {
    raw = readFileSync(filePath, 'utf8');
  } else {
    raw = await ftpDownload(`${id}/accessibility-results.json`);
  }
  if (!raw) {
    return res.status(404).json({ error: 'Report not found' });
  }
  try {
    const data = JSON.parse(raw);
    const urls = Array.isArray(data.urls)
      ? [...new Set(data.urls.map((u) => String(u)).filter(Boolean))]
      : [];
    return res.json({
      id,
      urls,
      count: urls.length,
      source: existsSync(filePath) ? 'file' : 'ftp',
    });
  } catch (err) {
    return res.status(500).json({ error: `Invalid report data: ${err.message}` });
  }
});

app.put('/api/report/:id/manual-progress', async (req, res) => {
  const id = req.params.id;
  if (!isValidReportId(id)) return res.status(400).json({ error: 'Invalid report ID' });
  const reportDir = join(REPORTS_BASE, id);
  if (!existsSync(reportDir)) {
    try {
      const dbRun = dbPool ? await dbGetRun(id) : null;
      if (!dbRun) return res.status(404).json({ error: 'Report not found' });
    } catch (err) {
      console.error(`[run ${id}] DB report lookup failed:`, err.message);
      return res.status(500).json({ error: 'Failed to verify report' });
    }
  }
  const checked = req.body?.checked;
  if (!Array.isArray(checked)) return res.status(400).json({ error: 'Body must include checked array' });
  const filePath = join(reportDir, 'manual-progress.json');
  try {
    if (dbPool) {
      await dbUpsertRun(id, { id, status: (runStatus.get(id)?.status || 'done'), manualProgress: { checked } });
    }
    if (!existsSync(reportDir)) mkdirSync(reportDir, { recursive: true });
    writeFileSync(filePath, JSON.stringify({ checked }), 'utf8');
    ftpUpload(filePath, `${id}/manual-progress.json`).catch(() => {});
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function serveReportFile(id, filename) {
  const filePath = join(REPORTS_BASE, id, filename);
  if (existsSync(filePath)) {
    return readFileSync(filePath, 'utf8');
  }
  return null;
}

async function ensureReportFilesFromDb(id) {
  if (!dbPool) return false;
  try {
    const dbRun = await dbGetRun(id);
    if (!dbRun || !dbRun.resultJson) return false;
    const reportDir = join(REPORTS_BASE, id);
    if (!existsSync(reportDir)) mkdirSync(reportDir, { recursive: true });
    const resultsPath = join(reportDir, 'accessibility-results.json');
    writeFileSync(resultsPath, JSON.stringify(dbRun.resultJson, null, 2), 'utf8');
    if (dbRun.manualProgress && Array.isArray(dbRun.manualProgress.checked)) {
      writeFileSync(join(reportDir, 'manual-progress.json'), JSON.stringify(dbRun.manualProgress, null, 2), 'utf8');
    }
    const { generateReport } = await import('./generate-report.js');
    generateReport(dbRun.resultJson, { outputDir: reportDir, verbose: true, throwOnDeliverableError: true });
    return existsSync(join(reportDir, 'accessibility-report.html'));
  } catch (err) {
    console.error(`[run ${id}] Failed to hydrate report from DB:`, err.message);
    return false;
  }
}

async function ensureDeliverableFromResults(id, filename, debugInfo = null) {
  const reportDir = join(REPORTS_BASE, id);
  const resultsPath = join(reportDir, 'accessibility-results.json');
  if (!existsSync(resultsPath)) {
    if (!existsSync(reportDir)) mkdirSync(reportDir, { recursive: true });
    const ftpResults = await ftpDownload(`${id}/accessibility-results.json`);
    if (!ftpResults) {
      const dbRun = dbPool ? await dbGetRun(id) : null;
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
    const { generateReport } = await import('./generate-report.js');
    generateReport(reportData, { outputDir: reportDir, verbose: true, throwOnDeliverableError: true, noExit: true });
    return existsSync(join(reportDir, filename));
  } catch (err) {
    if (debugInfo) debugInfo.error = err.message;
    console.error(`[run ${id}] Failed to regenerate deliverables:`, err.message);
    return false;
  }
}

const DELIVERABLE_FILES = ['accessibility-developers.html', 'accessibility-client.html', 'accessibility-statement.html'];

app.get('/api/debug/deliverable/:id/:file', async (req, res) => {
  const { id, file } = req.params;
  if (!isValidReportId(id)) return res.status(400).json({ error: 'Invalid report ID' });
  if (!DELIVERABLE_FILES.includes(file)) return res.status(400).json({ error: 'Unsupported deliverable file' });

  const reportDir = join(REPORTS_BASE, id);
  const reportHtmlPath = join(reportDir, 'accessibility-report.html');
  const deliverablePath = join(reportDir, file);
  const resultsPath = join(reportDir, 'accessibility-results.json');
  const diagnostics = {
    id,
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
    const dbRun = dbPool ? await dbGetRun(id) : null;
    diagnostics.db.hasRun = !!dbRun;
    diagnostics.db.hasResultJson = !!dbRun?.resultJson;
  } catch (err) {
    diagnostics.actions.push(`dbGetRun error: ${err.message}`);
  }

  try { diagnostics.ftp.reportHtml = !!(await ftpDownload(`${id}/accessibility-report.html`)); } catch (err) { diagnostics.actions.push(`ftp report error: ${err.message}`); }
  try { diagnostics.ftp.deliverable = !!(await ftpDownload(`${id}/${file}`)); } catch (err) { diagnostics.actions.push(`ftp deliverable error: ${err.message}`); }
  try { diagnostics.ftp.results = !!(await ftpDownload(`${id}/accessibility-results.json`)); } catch (err) { diagnostics.actions.push(`ftp results error: ${err.message}`); }

  if (String(req.query.rebuild || '') === '1') {
    const regen = {};
    try {
      const rebuilt = await ensureDeliverableFromResults(id, file, regen);
      diagnostics.actions.push(`ensureDeliverableFromResults: ${rebuilt ? 'ok' : 'failed'}`);
      if (regen.error) diagnostics.actions.push(`regenError: ${regen.error}`);
    } catch (err) {
      diagnostics.actions.push(`ensureDeliverableFromResults error: ${err.message}`);
    }
  }

  diagnostics.finalExists = existsSync(deliverablePath);
  return res.json(diagnostics);
});

app.get('/report/:id/screenshots/:file', async (req, res) => {
  const { id, file } = req.params;
  const safeName = file.replace(/[^a-zA-Z0-9._-]/g, '');
  const filePath = join(REPORTS_BASE, id, 'screenshots', safeName);
  if (existsSync(filePath)) {
    res.sendFile(filePath);
    return;
  }
  await ftpDownload(`${id}/screenshots/${safeName}`);
  if (existsSync(filePath)) {
    res.sendFile(filePath);
    return;
  }
  res.status(404).send('Not found');
});

app.get('/report/:id/:file', async (req, res) => {
  const { id, file } = req.params;
  if (DELIVERABLE_FILES.includes(file)) {
    const reportDir = join(REPORTS_BASE, id);
    let html = serveReportFile(id, file);
    if (!html) {
      html = await ftpDownload(`${id}/${file}`);
    }
    if (!html) {
      const hydrated = await ensureReportFilesFromDb(id);
      if (hydrated) html = serveReportFile(id, file);
    }
    if (!html) {
      const rebuilt = await ensureDeliverableFromResults(id, file);
      if (rebuilt) html = serveReportFile(id, file);
    }
    if (html) {
      res.setHeader('Content-Type', 'text/html');
      return res.send(html);
    }
    if (existsSync(join(reportDir, 'accessibility-report.html'))) {
      return res.status(404).send('Deliverable is not available yet. Please refresh in a moment.');
    }
    return res.status(404).send('Deliverable not found');
  }
  const reportPath = join(REPORTS_BASE, id, 'accessibility-report.html');
  if (existsSync(reportPath)) {
    return res.redirect(`/report/${id}`);
  }
  res.status(404).send(`
    <!DOCTYPE html>
    <html><head><title>Report Not Found</title></head>
    <body style="font-family:sans-serif;padding:2rem;text-align:center;">
      <h1>Report not found</h1>
      <p>Run ID: ${id}</p>
      <p><a href="/">Start a new test</a></p>
    </body></html>
  `);
});

app.get('/report/:id', async (req, res) => {
  const id = req.params.id;
  const reportPath = join(REPORTS_BASE, id, 'accessibility-report.html');

  if (existsSync(reportPath) || await ensureReportFilesFromDb(id)) {
    if (!req.path.endsWith('/')) {
      return res.redirect(301, `/report/${id}/`);
    }
    const html = readFileSync(reportPath, 'utf8');
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
    return;
  }

  const downloaded = await ftpDownload(`${id}/accessibility-report.html`);
  if (downloaded) {
    if (!req.path.endsWith('/')) {
      return res.redirect(301, `/report/${id}/`);
    }
    res.setHeader('Content-Type', 'text/html');
    return res.send(downloaded);
  }

  const status = runStatus.get(id);
  if (status?.status === 'running') {
    return res.redirect(`/loading.html?id=${id}`);
  }

  res.status(404).send(`
    <!DOCTYPE html>
    <html><head><title>Report Not Found</title></head>
    <body style="font-family:sans-serif;padding:2rem;text-align:center;">
      <h1>Report not found</h1>
      <p>Run ID: ${id}</p>
      <p><a href="/">Start a new test</a></p>
    </body></html>
  `);
});

app.get('/report/:id/', async (req, res) => {
  const id = req.params.id;
  const reportPath = join(REPORTS_BASE, id, 'accessibility-report.html');
  if (existsSync(reportPath) || await ensureReportFilesFromDb(id)) {
    const html = readFileSync(reportPath, 'utf8');
    res.setHeader('Content-Type', 'text/html');
    return res.send(html);
  }
  const downloaded = await ftpDownload(`${id}/accessibility-report.html`);
  if (downloaded) {
    res.setHeader('Content-Type', 'text/html');
    return res.send(downloaded);
  }
  res.redirect(`/report/${id}`);
});

app.get('/audits', async (req, res) => {
  return res.redirect('/audits/');
});

app.get('/audits/', async (_req, res) => {
  const escapeHtml = (s) =>
    String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  const audits = await listAuditEntries();
  const rows = audits.length
    ? audits.map((a) => {
        const when = a.updatedAt ? new Date(a.updatedAt).toLocaleString() : '—';
        return `<tr>
          <td><a href="/report/${encodeURIComponent(a.id)}/">${escapeHtml(a.id)}</a></td>
          <td>${escapeHtml(a.status)}</td>
          <td>${Number(a.pages || 0)}</td>
          <td>${Number(a.issues || 0)}</td>
          <td>${escapeHtml(when)}</td>
        </tr>`;
      }).join('')
    : '<tr><td colspan="5">No audits found yet.</td></tr>';

  return res.type('html').send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>All domain audits</title>
  <meta name="robots" content="noindex, nofollow, noarchive, nosnippet, noimageindex" />
  <style>
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin:0; background:#fafaf8; color:#1a1a1a; padding:24px; }
    .wrap { max-width: 980px; margin: 0 auto; background:#fff; border:1px solid #e8e6e1; border-radius:12px; overflow:hidden; }
    header { padding:16px 18px; border-bottom:1px solid #e8e6e1; display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; }
    h1 { margin:0; font-size:1.2rem; }
    .actions a { text-decoration:none; color:#1a1a1a; border:1px solid #d9d7d2; border-radius:8px; padding:7px 10px; background:#fff; font-size:.9rem; }
    .actions a:hover { background:#f3f3f1; }
    table { width:100%; border-collapse:collapse; font-size:.94rem; }
    th, td { padding:10px 12px; border-bottom:1px solid #f0efea; text-align:left; }
    th { background:#fafaf8; color:#5c5c5c; font-weight:600; }
    tbody tr:hover { background:#fafaf8; }
  </style>
</head>
<body>
  <div class="wrap">
    <header>
      <h1>All domain audits</h1>
      <div class="actions">
        <a href="/">Run a new audit</a>
      </div>
    </header>
    <table>
      <thead><tr><th>Domain</th><th>Status</th><th>Pages</th><th>Issues</th><th>Last updated</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
</body>
</html>`);
});

app.get('/', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'index.html'));
});

initDb()
  .then(() => {
    if (DB_ENABLED) {
      console.log('Postgres persistence enabled (runs table ready).');
    } else {
      console.log('Postgres persistence disabled (DATABASE_URL not set).');
    }
    app.listen(PORT, () => {
      console.log(`Accessibility test server running at http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialize database:', err.message);
    process.exit(1);
  });
