import { existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { computeIssueCountFromResult } from './report-data.js';
import { isValidReportId, readJsonIfExists } from './fs-utils.js';
import { listRunIdsForDomain, isValidRunId, runDir } from './run-ids.js';

function entryFromDb(domain, dbRow, totalRuns) {
  const resultJson = dbRow.resultJson || null;
  const urls = Array.isArray(resultJson?.urls) ? resultJson.urls : [];
  return {
    id: domain,
    domain,
    latestRunId: dbRow.runId,
    status: dbRow.status || 'unknown',
    updatedAt: dbRow.updatedAt || null,
    pages: urls.length || Number(dbRow.processedUrls || dbRow.requestedUrls || 0),
    issues: computeIssueCountFromResult(resultJson),
    totalRuns,
    source: 'db',
  };
}

function entryFromDisk(domain, runId, reportsBase) {
  const dir = runDir(domain, runId);
  const resultsFile = join(dir, 'accessibility-results.json');
  if (!existsSync(resultsFile)) return null;
  const resultJson = readJsonIfExists(resultsFile);
  const urls = Array.isArray(resultJson?.urls) ? resultJson.urls : [];
  let updatedAt = null;
  try {
    updatedAt = statSync(resultsFile).mtime;
  } catch {}
  return {
    id: domain,
    domain,
    latestRunId: runId,
    status: 'done',
    updatedAt,
    pages: urls.length,
    issues: computeIssueCountFromResult(resultJson),
    totalRuns: listRunIdsForDomain(domain).length,
    source: 'file',
  };
}

/**
 * Returns one row per domain with the latest run summary, merged from DB + filesystem.
 * @param {import('pg').Pool | null} dbPool
 * @param {string} reportsBase
 */
export async function listAuditEntries(dbPool, reportsBase) {
  const byDomain = new Map();

  if (dbPool) {
    try {
      const { rows } = await dbPool.query(
        `WITH latest AS (
           SELECT DISTINCT ON (id) id, run_id, status, urls, processed_urls, requested_urls,
                  result_json, updated_at
             FROM runs
             ORDER BY id, updated_at DESC
         ),
         counts AS (
           SELECT id, COUNT(*)::int AS total FROM runs GROUP BY id
         )
         SELECT l.id, l.run_id, l.status, l.urls, l.processed_urls, l.requested_urls,
                l.result_json, l.updated_at, c.total
           FROM latest l
           JOIN counts c ON c.id = l.id
          ORDER BY l.updated_at DESC
          LIMIT 1000`
      );
      rows.forEach((row) => {
        byDomain.set(row.id, entryFromDb(row.id, {
          runId: row.run_id,
          status: row.status,
          urls: row.urls,
          processedUrls: row.processed_urls,
          requestedUrls: row.requested_urls,
          resultJson: row.result_json,
          updatedAt: row.updated_at,
        }, Number(row.total || 1)));
      });
    } catch (err) {
      console.error('Failed to list audits from DB:', err.message);
    }
  }

  try {
    if (existsSync(reportsBase)) {
      const entries = readdirSync(reportsBase);
      entries.forEach((name) => {
        if (!isValidReportId(name)) return;
        if (byDomain.has(name)) return;
        const dir = join(reportsBase, name);
        let isDir = false;
        try {
          isDir = statSync(dir).isDirectory();
        } catch {}
        if (!isDir) return;
        const runIds = listRunIdsForDomain(name);
        if (runIds.length > 0) {
          const entry = entryFromDisk(name, runIds[0], reportsBase);
          if (entry) byDomain.set(name, entry);
          return;
        }
        // legacy single-folder layout (pre-runId migration): treat the folder itself as the run
        const legacyResults = join(dir, 'accessibility-results.json');
        if (existsSync(legacyResults) && isValidRunId('legacy')) {
          const resultJson = readJsonIfExists(legacyResults);
          const urls = Array.isArray(resultJson?.urls) ? resultJson.urls : [];
          let updatedAt = null;
          try { updatedAt = statSync(legacyResults).mtime; } catch {}
          byDomain.set(name, {
            id: name,
            domain: name,
            latestRunId: 'legacy',
            status: 'done',
            updatedAt,
            pages: urls.length,
            issues: computeIssueCountFromResult(resultJson),
            totalRuns: 1,
            source: 'file-legacy',
          });
        }
      });
    }
  } catch (err) {
    console.error('Failed to list audits from files:', err.message);
  }

  return [...byDomain.values()].sort((a, b) => {
    const ta = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
    const tb = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
    return tb - ta;
  });
}

/**
 * Per-domain history: every run we have, newest first. Merges DB rows + filesystem dirs.
 */
export async function listRunsForDomain(dbPool, reportsBase, domain) {
  if (!isValidReportId(domain)) return [];
  const byRun = new Map();

  if (dbPool) {
    try {
      const { rows } = await dbPool.query(
        `SELECT id, run_id, status, urls, processed_urls, requested_urls,
                result_json, updated_at
           FROM runs
          WHERE id = $1
          ORDER BY updated_at DESC
          LIMIT 200`,
        [domain]
      );
      rows.forEach((row) => {
        const resultJson = row.result_json || null;
        const urls = Array.isArray(resultJson?.urls) ? resultJson.urls : [];
        byRun.set(row.run_id, {
          domain,
          runId: row.run_id,
          status: row.status,
          updatedAt: row.updated_at,
          pages: urls.length || Number(row.processed_urls || row.requested_urls || 0),
          issues: computeIssueCountFromResult(resultJson),
          source: 'db',
          score: scoreFromResult(resultJson),
        });
      });
    } catch (err) {
      console.error(`Failed to list runs for ${domain}:`, err.message);
    }
  }

  try {
    listRunIdsForDomain(domain).forEach((runId) => {
      if (byRun.has(runId)) return;
      const resultsFile = join(reportsBase, domain, runId, 'accessibility-results.json');
      const resultJson = readJsonIfExists(resultsFile);
      if (!resultJson) return;
      let updatedAt = null;
      try { updatedAt = statSync(resultsFile).mtime; } catch {}
      const urls = Array.isArray(resultJson.urls) ? resultJson.urls : [];
      byRun.set(runId, {
        domain,
        runId,
        status: 'done',
        updatedAt,
        pages: urls.length,
        issues: computeIssueCountFromResult(resultJson),
        source: 'file',
        score: scoreFromResult(resultJson),
      });
    });
  } catch (err) {
    console.error(`Failed to list runs from disk for ${domain}:`, err.message);
  }

  return [...byRun.values()].sort((a, b) => {
    const ta = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
    const tb = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
    return tb - ta;
  });
}

/** Score 0–100 derived the same way as the Astro payload (pass+axePass / scoreDen). */
export function scoreFromResult(resultJson) {
  if (!resultJson || typeof resultJson !== 'object') return null;
  const summary = resultJson.summary || {};
  const pass = Number(summary.pass || 0);
  const fail = Number(summary.fail || 0);
  const warn = Number(summary.warn || 0);
  let axeViolations = 0;
  let axePasses = 0;
  Object.values(resultJson.axeResults || {}).forEach((r) => {
    axeViolations += Number((r && r.violations && r.violations.length) || 0);
    axePasses += Number((r && r.passes && r.passes.length) || 0);
  });
  const den = pass + fail + warn + axeViolations + axePasses;
  if (den === 0) return 100;
  return Math.max(0, Math.min(100, Math.round(((pass + axePasses) / den) * 100)));
}
