import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';

const {
  dbPool,
  initDb,
  dbUpsertRun,
  dbGetRun,
  sweepStaleActiveRuns,
  dbClaimStripeEvent,
  dbClaimRunRefund,
  withUserLedgerLock,
} = await import('../server/db.js');

const haveDb = Boolean(dbPool);

describe('postgres-backed paths', { skip: !haveDb }, () => {
  it('initDb sweeps stale queued rows and lets two staff runs persist', async () => {
    await initDb();
    const runA = '2026-09-15T00-00-00Z-staffaaaaaa';
    const runB = '2026-09-15T00-00-00Z-staffbbbbbb';
    await dbUpsertRun('staff-a.example', runA, { status: 'running', userId: 'staff' });
    await dbUpsertRun('staff-b.example', runB, { status: 'running', userId: 'staff' });
    const a = await dbGetRun('staff-a.example', runA);
    const b = await dbGetRun('staff-b.example', runB);
    assert.equal(a?.status, 'running');
    assert.equal(a?.userId, 'staff');
    assert.equal(b?.status, 'running');
    assert.equal(b?.userId, 'staff');

    const staleRun = '2026-09-15T00-00-00Z-staleaaaaaa';
    await dbUpsertRun('stale.example', staleRun, { status: 'queued', userId: 'cust-stale' });
    const swept = await sweepStaleActiveRuns();
    assert.ok(swept.swept >= 1);
    const stale = await dbGetRun('stale.example', staleRun);
    assert.equal(stale?.status, 'error');
  });

  it('claims a stripe event only once', async () => {
    await initDb();
    const id = `evt_test_${Date.now()}`;
    assert.equal(await dbClaimStripeEvent(id, 'checkout.session.completed'), true);
    assert.equal(await dbClaimStripeEvent(id, 'checkout.session.completed'), false);
  });

  it('serializes withUserLedgerLock via advisory lock', async () => {
    await initDb();
    const order = [];
    await Promise.all([
      withUserLedgerLock('lock-user', async () => {
        order.push('a-start');
        await new Promise((resolve) => setTimeout(resolve, 40));
        order.push('a-end');
      }),
      withUserLedgerLock('lock-user', async () => {
        order.push('b-start');
        order.push('b-end');
      }),
    ]);
    const joined = order.join(',');
    assert.ok(
      joined === 'a-start,a-end,b-start,b-end' || joined === 'b-start,b-end,a-start,a-end',
      joined
    );
  });

  it('claims a run refund only once', async () => {
    await initDb();
    const runId = `2026-09-15T00-00-00Z-refund${Date.now().toString(16).slice(-8)}`;
    await dbUpsertRun('refund.example', runId, {
      status: 'error',
      userId: 'u-refund',
      entitlement: { lots: [], scans: 1 },
    });
    const first = await dbClaimRunRefund(runId);
    const second = await dbClaimRunRefund(runId);
    assert.ok(first?.refundedAt);
    assert.equal(second, null);
  });
});
