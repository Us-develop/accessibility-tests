import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { REPORTS_BASE } from './paths.js';
import { parsePositiveIntEnv } from './guest.mjs';
import { assertPublicHttpUrl } from './url-guard.mjs';

const QUEUE_DIR = () => join(REPORTS_BASE, '_queue');

/** @type {(job: object) => Promise<void> | void} */
let executor = null;
/** @type {(job: object, err?: Error) => void} */
let jobErrorHandler = null;
let draining = false;
let drainQueued = false;

export function setQueueExecutor(fn) {
  executor = fn;
}

export function setQueueJobErrorHandler(fn) {
  jobErrorHandler = typeof fn === 'function' ? fn : null;
}

function ensureQueueDir() {
  const dir = QUEUE_DIR();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function jobPath(id) {
  return join(ensureQueueDir(), `${id}.json`);
}

export function writeJob(job) {
  writeFileSync(jobPath(job.id), JSON.stringify(job, null, 2), 'utf8');
}

export function readJob(id) {
  const file = jobPath(id);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export function deleteJob(id) {
  const file = jobPath(id);
  if (existsSync(file)) unlinkSync(file);
}

export function listJobs() {
  const dir = ensureQueueDir();
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => {
      try {
        return JSON.parse(readFileSync(join(dir, name), 'utf8'));
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
}

export function customerHasActiveScan(runStatus, userId) {
  if (!userId) return false;
  for (const value of runStatus.values()) {
    if (value?.userId === userId && (value.status === 'running' || value.status === 'queued')) {
      return true;
    }
  }
  return listJobs().some(
    (job) => job.userId === userId && (job.status === 'queued' || job.status === 'running')
  );
}

/**
 * True when `state` belongs to `owner`.
 * - `{ userId }` matches that user (customers or `'staff'`).
 * - `{ guestToken }` matches that guest token (never matches a missing token).
 * - `null` / omitted owner matches anyone (staff latest-run redirect).
 */
export function runMatchesOwner(state, owner) {
  if (!owner) return true;
  if (Object.prototype.hasOwnProperty.call(owner, 'userId')) {
    return (state?.userId || null) === owner.userId;
  }
  if (Object.prototype.hasOwnProperty.call(owner, 'guestToken')) {
    return Boolean(owner.guestToken) && state?.guestToken === owner.guestToken;
  }
  return false;
}

/**
 * Find a running or queued run for a domain, optionally limited to one owner.
 * @param {Map<string, object>} runStatusMap
 * @param {string} domain
 * @param {{ userId?: string|null, guestToken?: string|null } | null} [owner]
 */
export function findRunningRun(runStatusMap, domain, owner = null) {
  if (!domain || !runStatusMap) return null;
  const prefix = `${domain}:`;
  for (const [key, value] of runStatusMap.entries()) {
    if (!key.startsWith(prefix)) continue;
    if (value?.status !== 'running' && value?.status !== 'queued') continue;
    if (!runMatchesOwner(value, owner)) continue;
    return { runId: key.slice(prefix.length), state: value };
  }
  return null;
}

/**
 * Persist a queued scan. The executor starts it when a pool slot is free.
 */
export function enqueueScanJob(job) {
  const row = {
    ...job,
    status: job.status || 'queued',
    createdAt: job.createdAt || new Date().toISOString(),
  };
  writeJob(row);
  kickQueue();
  return row;
}

export function kickQueue() {
  if (draining) {
    drainQueued = true;
    return;
  }
  draining = true;
  setImmediate(() => {
    drainQueue()
      .catch((err) => console.error('[queue]', err?.message || err))
      .finally(() => {
        draining = false;
        if (drainQueued) {
          drainQueued = false;
          kickQueue();
        }
      });
  });
}

async function assertJobUrlsPublic(job) {
  const urls = Array.isArray(job?.urls) ? job.urls : [];
  for (const url of urls) {
    await assertPublicHttpUrl(url);
  }
}

function spawnJob(job) {
  const run = async () => {
    try {
      try {
        await assertJobUrlsPublic(job);
      } catch {
        job.status = 'error';
        job.error = 'blocked_target';
        writeJob(job);
        if (typeof jobErrorHandler === 'function') {
          jobErrorHandler(job);
        }
        return;
      }
      await executor(job);
    } catch (err) {
      job.status = 'error';
      job.error = err?.message || String(err);
      writeJob(job);
    } finally {
      deleteJob(job.id);
      kickQueue();
    }
  };
  void run();
}

async function drainQueue() {
  if (!executor) return;
  const max = parsePositiveIntEnv('SCAN_MAX_CONCURRENT', 3);
  while (true) {
    const jobs = listJobs();
    const running = jobs.filter((j) => j.status === 'running').length;
    if (running >= max) return;
    const next = jobs.find((j) => j.status === 'queued');
    if (!next) return;
    next.status = 'running';
    next.startedAt = new Date().toISOString();
    writeJob(next);
    spawnJob(next);
  }
}

export function recoverInterruptedJobs() {
  for (const job of listJobs()) {
    if (job.status === 'running') {
      job.status = 'queued';
      delete job.startedAt;
      writeJob(job);
    }
  }
}
