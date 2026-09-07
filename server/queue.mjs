import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { REPORTS_BASE } from './paths.js';
import { parsePositiveIntEnv } from './guest.mjs';

const QUEUE_DIR = () => join(REPORTS_BASE, '_queue');

/** @type {(job: object) => Promise<void> | void} */
let executor = null;
let kicking = false;

export function setQueueExecutor(fn) {
  executor = fn;
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

export function countRunningFromJobs() {
  return listJobs().filter((j) => j.status === 'running').length;
}

export function globalPoolFull(runStatus) {
  const max = parsePositiveIntEnv('SCAN_MAX_CONCURRENT', 3);
  let n = 0;
  for (const value of runStatus.values()) {
    if (value?.status === 'running') n += 1;
  }
  n = Math.max(n, countRunningFromJobs());
  return n >= max;
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
  if (kicking) return;
  kicking = true;
  setImmediate(() => {
    kicking = false;
    drainQueue().catch((err) => console.error('[queue]', err?.message || err));
  });
}

async function drainQueue() {
  if (!executor) return;
  const max = parsePositiveIntEnv('SCAN_MAX_CONCURRENT', 3);
  const jobs = listJobs();
  const running = jobs.filter((j) => j.status === 'running').length;
  if (running >= max) return;
  const next = jobs.find((j) => j.status === 'queued');
  if (!next) return;
  next.status = 'running';
  next.startedAt = new Date().toISOString();
  writeJob(next);
  try {
    await executor(next);
  } catch (err) {
    next.status = 'error';
    next.error = err?.message || String(err);
    writeJob(next);
  }
}

export function finishJob(id, patch = {}) {
  const job = readJob(id);
  if (!job) return;
  const next = { ...job, ...patch, finishedAt: new Date().toISOString() };
  if (next.status === 'done' || next.status === 'error') {
    deleteJob(id);
  } else {
    writeJob(next);
  }
  kickQueue();
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
