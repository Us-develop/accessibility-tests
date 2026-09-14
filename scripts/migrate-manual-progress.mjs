#!/usr/bin/env node
/**
 * Copy leftover domain-level reports/<domain>/manual-progress.json into the
 * latest run of that domain, then delete the domain-level file.
 *
 * Usage:
 *   node scripts/migrate-manual-progress.mjs            # dry run
 *   node scripts/migrate-manual-progress.mjs --apply    # copy + delete
 */
import { copyFileSync, existsSync, readdirSync, statSync, unlinkSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { isValidReportId } from '../server/fs-utils.js';
import { isValidRunId } from '../server/run-ids.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPORTS_BASE = process.env.REPORTS_BASE?.trim()
  ? process.env.REPORTS_BASE.trim()
  : join(__dirname, '..', 'reports');

const APPLY = process.argv.includes('--apply');

function latestRunIdIn(reportsBase, domain) {
  const dir = join(reportsBase, domain);
  if (!existsSync(dir)) return null;
  let names = [];
  try {
    names = readdirSync(dir);
  } catch {
    return null;
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
    runs.push({ runId: name, mtime: stat.mtimeMs });
  }
  runs.sort((a, b) => b.mtime - a.mtime);
  return runs[0]?.runId || null;
}

export function migrateDomainManualProgress(reportsBase = DEFAULT_REPORTS_BASE, { apply = APPLY } = {}) {
  if (!existsSync(reportsBase)) {
    return { skipped: true, reason: 'no reports directory', domains: [] };
  }
  const domains = readdirSync(reportsBase).filter((name) => {
    if (!isValidReportId(name)) return false;
    try {
      return statSync(join(reportsBase, name)).isDirectory();
    } catch {
      return false;
    }
  });

  const results = [];
  for (const domain of domains) {
    const domainFile = join(reportsBase, domain, 'manual-progress.json');
    if (!existsSync(domainFile)) {
      results.push({ domain, skipped: true, reason: 'no domain file' });
      continue;
    }
    const runId = latestRunIdIn(reportsBase, domain);
    if (!runId) {
      results.push({ domain, skipped: true, reason: 'no run folder' });
      continue;
    }
    const runFile = join(reportsBase, domain, runId, 'manual-progress.json');
    const copied = !existsSync(runFile);
    if (apply) {
      if (copied) copyFileSync(domainFile, runFile);
      unlinkSync(domainFile);
    }
    results.push({ domain, runId, copied, deleted: true });
  }
  return { skipped: false, domains: results };
}

function main() {
  console.log(`${APPLY ? 'APPLY' : 'DRY-RUN'} domain manual-progress migration in ${DEFAULT_REPORTS_BASE}`);
  const summary = migrateDomainManualProgress(DEFAULT_REPORTS_BASE, { apply: APPLY });
  if (summary.skipped) {
    console.log(`No reports directory at ${DEFAULT_REPORTS_BASE}`);
    return;
  }
  for (const row of summary.domains) {
    if (row.skipped) {
      console.log(`  skip  ${row.domain}  (${row.reason})`);
    } else {
      console.log(
        `  ${row.copied ? 'copy' : 'keep'}  ${row.domain}  -> ${row.runId}/manual-progress.json  (delete domain file)`
      );
    }
  }
  console.log(`Done. Domains processed: ${summary.domains.length}`);
  if (!APPLY) console.log('Re-run with --apply to copy into the latest run and delete the domain file.');
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) main();
