/**
 * Run ID helpers. Each audit run lives at reports/<domain>/<runId>/.
 * runId = "YYYY-MM-DDTHH-MM-SSZ-<12hex>", e.g. "2026-05-04T13-45-12Z-ab12cd34ef56".
 */
import { randomBytes } from 'crypto';
import { existsSync, readdirSync, statSync } from 'fs';
import { join, relative, resolve, sep } from 'path';
import { REPORTS_BASE } from './paths.js';
import { isValidReportId, readJsonIfExists } from './fs-utils.js';

/** Filesystem-safe ISO timestamp (no `:` so it is portable across OSes/FTP). */
function tsForRunId(date = new Date()) {
  return date.toISOString().replace(/\.\d+Z$/, 'Z').replace(/:/g, '-');
}

/** 12-hex suffix so two runs in the same second do not collide. */
function shortHex() {
  return randomBytes(6).toString('hex');
}

export function newRunId(date = new Date()) {
  return `${tsForRunId(date)}-${shortHex()}`;
}

/** Validate a runId path segment (also rejects path traversal). */
export function isValidRunId(runId) {
  if (typeof runId !== 'string' || runId.length === 0 || runId.length > 80) return false;
  if (runId === '.' || runId === '..' || runId.includes('..')) return false;
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(runId);
}

function isInsideReportsBase(target) {
  const base = resolve(REPORTS_BASE);
  const resolved = resolve(target);
  const rel = relative(base, resolved);
  return Boolean(rel) && !rel.startsWith(`..${sep}`) && rel !== '..' && !rel.split(sep).includes('..');
}

/** Same shape rule as report ids but renamed for clarity. */
export function isValidDomain(domain) {
  return isValidReportId(domain);
}

export function runDir(domain, runId) {
  if (!isValidDomain(domain) || !isValidRunId(runId)) {
    throw new Error('Invalid report path');
  }
  const dir = resolve(join(REPORTS_BASE, domain, runId));
  if (!isInsideReportsBase(dir)) {
    throw new Error('Invalid report path');
  }
  return dir;
}

export function domainDir(domain) {
  if (!isValidDomain(domain)) {
    throw new Error('Invalid report path');
  }
  const dir = resolve(join(REPORTS_BASE, domain));
  if (!isInsideReportsBase(dir)) {
    throw new Error('Invalid report path');
  }
  return dir;
}

/** List runId folder names under reports/<domain>/, newest first by mtime. */
export function listRunIdsForDomain(domain) {
  if (!isValidDomain(domain)) return [];
  const dir = domainDir(domain);
  if (!existsSync(dir)) return [];
  let names = [];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const runs = [];
  for (const name of names) {
    if (!isValidRunId(name)) continue;
    const full = join(dir, name);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;
    if (!existsSync(join(full, 'accessibility-results.json'))) continue;
    runs.push({ runId: name, mtime: stat.mtimeMs });
  }
  runs.sort((a, b) => b.mtime - a.mtime);
  return runs.map((r) => r.runId);
}

/** Find the most recent run ID for a domain on disk, or null. */
export function latestRunIdOnDisk(domain) {
  return listRunIdsForDomain(domain)[0] || null;
}

/**
 * Read summary metadata for one run. Used for the history page + audits list.
 * Returns null if the run dir / results file is missing.
 */
export function readRunSummary(domain, runId) {
  if (!isValidDomain(domain) || !isValidRunId(runId)) return null;
  const dir = runDir(domain, runId);
  const resultsPath = join(dir, 'accessibility-results.json');
  if (!existsSync(resultsPath)) return null;
  const result = readJsonIfExists(resultsPath);
  let mtime = null;
  try {
    mtime = statSync(resultsPath).mtime;
  } catch {}
  return {
    domain,
    runId,
    result,
    generatedAt: result?.generatedAt || (mtime ? mtime.toISOString() : null),
    mtime,
  };
}
