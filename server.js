#!/usr/bin/env node
/**
 * Web server for accessibility testing UI.
 * Provides form to add URLs or upload CSV/XML, runs tests, and serves reports by unique ID.
 */

import express from 'express';
import multer from 'multer';
import { spawn } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Client } from 'basic-ftp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPORTS_BASE = join(__dirname, 'reports');
const PORT = process.env.PORT || 3456;

// In-memory run status (running, done, error)
const runStatus = new Map();

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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
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

  if (urls.length === 0) {
    return res.status(400).json({ error: 'No valid URLs provided. Add URLs in the text area or upload a CSV/XML file.' });
  }

  const maxUrls = process.env.MAX_URLS_PER_RUN ? parseInt(process.env.MAX_URLS_PER_RUN, 10) : 0;
  if (maxUrls > 0 && urls.length > maxUrls) {
    urls = urls.slice(0, maxUrls);
  }

  const id = uuidv4().slice(0, 8);
  const reportDir = join(REPORTS_BASE, id);
  if (!existsSync(reportDir)) mkdirSync(reportDir, { recursive: true });

  const statementMeta = parseStatementMeta(req.body || {});
  try {
    writeFileSync(join(reportDir, 'statement-meta.json'), JSON.stringify(statementMeta, null, 2), 'utf8');
  } catch (err) {
    console.error('statement-meta write failed:', err.message);
  }

  runStatus.set(id, { status: 'running', urls: urls.length, error: null });

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
      runStatus.set(id, { status: 'done', urls: urls.length, error: null });
      return;
    }
    if (code === 0 && !existsSync(reportPath)) {
      const pollForReport = (attempts = 0) => {
        if (existsSync(reportPath)) {
          runStatus.set(id, { status: 'done', urls: urls.length, error: null });
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
                runStatus.set(id, { status: 'done', urls: urls.length, error: null });
              } else {
                runStatus.set(id, { status: 'error', urls: urls.length, error: 'Report generation failed.' });
              }
            } catch (err) {
              runStatus.set(id, { status: 'error', urls: urls.length, error: err.message });
            }
          })();
        } else {
          runStatus.set(id, {
            status: 'error',
            urls: urls.length,
            error: 'Report file was not created.',
          });
        }
      };
      pollForReport();
      return;
    }
    runStatus.set(id, { status: 'error', urls: urls.length, error: stderr || `Process exited with code ${code}` });
  });

  child.on('error', (err) => {
    runStatus.set(id, { status: 'error', urls: urls.length, error: err.message });
  });

  res.json({ id, urls: urls.length });
});

app.get('/api/status/:id', (req, res) => {
  const id = req.params.id;
  const status = runStatus.get(id);
  const reportPath = join(REPORTS_BASE, id, 'accessibility-report.html');

  if (!status) {
    if (existsSync(reportPath)) {
      return res.json({ status: 'done', urls: 0 });
    }
    return res.status(404).json({ error: 'Run not found' });
  }

  res.json(status);
});

function isValidReportId(id) {
  return /^[a-zA-Z0-9-]+$/.test(id) && id.length <= 32;
}

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

app.get('/api/report/:id/manual-progress', async (req, res) => {
  const id = req.params.id;
  if (!isValidReportId(id)) return res.status(400).json({ error: 'Invalid report ID' });
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

app.put('/api/report/:id/manual-progress', async (req, res) => {
  const id = req.params.id;
  if (!isValidReportId(id)) return res.status(400).json({ error: 'Invalid report ID' });
  const reportDir = join(REPORTS_BASE, id);
  if (!existsSync(reportDir)) return res.status(404).json({ error: 'Report not found' });
  const checked = req.body?.checked;
  if (!Array.isArray(checked)) return res.status(400).json({ error: 'Body must include checked array' });
  const filePath = join(reportDir, 'manual-progress.json');
  try {
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

const DELIVERABLE_FILES = ['accessibility-developers.html', 'accessibility-client.html', 'accessibility-statement.html'];

app.get('/report/:id/screenshots/:file', (req, res) => {
  const { id, file } = req.params;
  const safeName = file.replace(/[^a-zA-Z0-9._-]/g, '');
  const filePath = join(REPORTS_BASE, id, 'screenshots', safeName);
  if (existsSync(filePath)) {
    res.sendFile(filePath);
    return;
  }
  res.status(404).send('Not found');
});

app.get('/report/:id/:file', (req, res) => {
  const { id, file } = req.params;
  if (DELIVERABLE_FILES.includes(file)) {
    const html = serveReportFile(id, file);
    if (html) {
      res.setHeader('Content-Type', 'text/html');
      return res.send(html);
    }
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

app.get('/report/:id', (req, res) => {
  const id = req.params.id;
  const reportPath = join(REPORTS_BASE, id, 'accessibility-report.html');

  if (existsSync(reportPath)) {
    if (!req.path.endsWith('/')) {
      return res.redirect(301, `/report/${id}/`);
    }
    const html = readFileSync(reportPath, 'utf8');
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
    return;
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

app.get('/report/:id/', (req, res) => {
  const id = req.params.id;
  const reportPath = join(REPORTS_BASE, id, 'accessibility-report.html');
  if (existsSync(reportPath)) {
    const html = readFileSync(reportPath, 'utf8');
    res.setHeader('Content-Type', 'text/html');
    return res.send(html);
  }
  res.redirect(`/report/${id}`);
});

app.get('/', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Accessibility test server running at http://localhost:${PORT}`);
});
