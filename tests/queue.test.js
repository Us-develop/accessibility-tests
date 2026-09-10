import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'wcag-queue-'));
process.env.REPORTS_BASE = tmp;

const {
  writeJob,
  listJobs,
  recoverInterruptedJobs,
  customerHasActiveScan,
  enqueueScanJob,
  kickQueue,
  setQueueExecutor,
  deleteJob,
} = await import('../server/queue.mjs');

function waitFor(check, timeoutMs = 1000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      try {
        if (check()) {
          resolve();
          return;
        }
      } catch (err) {
        reject(err);
        return;
      }
      if (Date.now() - started > timeoutMs) {
        reject(new Error('timed out waiting for queue condition'));
        return;
      }
      setTimeout(tick, 10);
    };
    tick();
  });
}

after(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('scan queue', () => {
  it('re-queues jobs that were running when the process died', () => {
    writeJob({
      id: 'example.com:run-1',
      domain: 'example.com',
      runId: 'run-1',
      status: 'running',
      userId: 'user-a',
      createdAt: '2026-09-10T00:00:00.000Z',
    });
    recoverInterruptedJobs();
    const jobs = listJobs();
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].status, 'queued');
    assert.equal(jobs[0].startedAt, undefined);
    deleteJob('example.com:run-1');
  });

  it('treats queued and running jobs as an active customer scan', () => {
    writeJob({
      id: 'example.com:run-2',
      domain: 'example.com',
      runId: 'run-2',
      status: 'queued',
      userId: 'user-b',
      createdAt: '2026-09-10T00:00:00.000Z',
    });
    assert.equal(customerHasActiveScan(new Map(), 'user-b'), true);
    assert.equal(customerHasActiveScan(new Map(), 'user-c'), false);
    deleteJob('example.com:run-2');
  });

  it('runs a queued job through the executor then removes it', async () => {
    let seen = null;
    setQueueExecutor(async (job) => {
      seen = job.id;
    });
    enqueueScanJob({
      id: 'example.com:run-3',
      domain: 'example.com',
      runId: 'run-3',
      userId: 'user-d',
      urls: ['https://example.com'],
    });
    await waitFor(() => seen === 'example.com:run-3' && listJobs().length === 0);
    assert.equal(seen, 'example.com:run-3');
    assert.equal(listJobs().length, 0);
  });

  it('fills free pool slots instead of waiting for the first scan to finish', async () => {
    process.env.SCAN_MAX_CONCURRENT = '2';
    try {
      const started = [];
      const gates = new Map();
      setQueueExecutor(async (job) => {
        started.push(job.id);
        await new Promise((resolve) => {
          gates.set(job.id, resolve);
        });
      });
      enqueueScanJob({ id: 'a.example:run-4', domain: 'a.example', runId: 'run-4' });
      enqueueScanJob({ id: 'b.example:run-5', domain: 'b.example', runId: 'run-5' });
      await waitFor(() => started.length === 2);
      assert.deepEqual([...started].sort(), ['a.example:run-4', 'b.example:run-5']);
      for (const release of gates.values()) release();
      await waitFor(() => listJobs().length === 0);
    } finally {
      delete process.env.SCAN_MAX_CONCURRENT;
    }
  });

  it('keeps extra jobs queued when the pool is full', async () => {
    process.env.SCAN_MAX_CONCURRENT = '1';
    try {
      const started = [];
      const gates = new Map();
      setQueueExecutor(async (job) => {
        started.push(job.id);
        await new Promise((resolve) => {
          gates.set(job.id, resolve);
        });
      });
      enqueueScanJob({ id: 'c.example:run-6', domain: 'c.example', runId: 'run-6' });
      enqueueScanJob({ id: 'd.example:run-7', domain: 'd.example', runId: 'run-7' });
      await waitFor(() => started.length === 1);
      assert.equal(started[0], 'c.example:run-6');
      assert.equal(listJobs().filter((j) => j.status === 'queued').length, 1);
      gates.get('c.example:run-6')();
      await waitFor(() => started.length === 2);
      gates.get('d.example:run-7')();
      await waitFor(() => listJobs().length === 0);
    } finally {
      delete process.env.SCAN_MAX_CONCURRENT;
    }
  });

  it('starts recovered jobs once the executor is attached', async () => {
    writeJob({
      id: 'e.example:run-8',
      domain: 'e.example',
      runId: 'run-8',
      status: 'running',
      createdAt: '2026-09-10T00:00:00.000Z',
    });
    recoverInterruptedJobs();
    let seen = null;
    setQueueExecutor(async (job) => {
      seen = job.id;
    });
    kickQueue();
    await waitFor(() => seen === 'e.example:run-8' && listJobs().length === 0);
    assert.equal(seen, 'e.example:run-8');
  });
});
