/**
 * "Reviewed" marks on findings the scanner cannot decide by itself (warnings).
 *
 * A person looks at a warning, decides it is fine (captions are burned into the
 * video, the link is clear in context) and marks it reviewed. That counts
 * toward the "To review" part of the score (see score-model.js).
 *
 * Stored per run in reports/<domain>/<runId>/reviewed.json as { reviewed: [key] },
 * where a key is `<ruleId>|<pageUrl>` (reviewKey in scoring.js). When a new scan
 * of the same site finishes, marks are carried over from the owner's previous
 * run for every warning that is still there, so nobody reviews the same thing twice.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { isValidDomain, isValidRunId, listRunIdsForDomain, runDir } from './run-ids.js';
import { reviewItems } from '../scoring.js';

const FILE_NAME = 'reviewed.json';
const RESULTS_FILE = 'accessibility-results.json';

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/** Keys that can be marked on this run: its warnings. Null when the run has no results. */
export function reviewableKeys(domain, runId) {
  if (!isValidDomain(domain) || !isValidRunId(runId)) return null;
  const results = readJson(join(runDir(domain, runId), RESULTS_FILE));
  if (!results) return null;
  return reviewItems(results).map((item) => item.key);
}

/** Marks saved for a run, limited to warnings the run still has. */
export function readReviewed(domain, runId) {
  if (!isValidDomain(domain) || !isValidRunId(runId)) return [];
  const saved = readJson(join(runDir(domain, runId), FILE_NAME));
  const list = Array.isArray(saved?.reviewed) ? saved.reviewed : [];
  const valid = reviewableKeys(domain, runId);
  if (!valid) return [];
  const allowed = new Set(valid);
  return [...new Set(list.filter((key) => typeof key === 'string' && allowed.has(key)))];
}

/**
 * Replace the marks of a run. Keys that are not warnings of this run are dropped.
 * @returns {string[] | null} the saved list, or null when the run has no results
 */
export function writeReviewed(domain, runId, keys) {
  const valid = reviewableKeys(domain, runId);
  if (!valid) return null;
  const allowed = new Set(valid);
  const reviewed = [...new Set((Array.isArray(keys) ? keys : []).filter((key) => typeof key === 'string' && allowed.has(key)))];
  const dir = runDir(domain, runId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, FILE_NAME), JSON.stringify({ reviewed }), 'utf8');
  return reviewed;
}

/**
 * Copy marks from the newest earlier run the owner may see onto a run that has
 * just finished. Does nothing when the new run already has marks.
 *
 * @param {string} domain
 * @param {string} runId the run that just finished
 * @param {(candidateRunId: string) => boolean | Promise<boolean>} mayInheritFrom
 *   true when the new run's owner also owns that earlier run
 * @returns {Promise<string[]>} the marks now on the new run
 */
export async function carryReviewedForward(domain, runId, mayInheritFrom) {
  if (!isValidDomain(domain) || !isValidRunId(runId)) return [];
  if (existsSync(join(runDir(domain, runId), FILE_NAME))) return readReviewed(domain, runId);
  // Run ids start with a UTC timestamp, so they sort by time.
  const earlier = listRunIdsForDomain(domain)
    .filter((id) => id < runId)
    .sort()
    .reverse();
  for (const candidate of earlier) {
    if (!(await mayInheritFrom(candidate))) continue;
    const marks = readReviewed(domain, candidate);
    if (marks.length === 0) return [];
    return writeReviewed(domain, runId, marks) || [];
  }
  return [];
}
