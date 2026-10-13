import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';

const {
  dbPool,
  initDb,
  dbUpsertRun,
  dbGetRun,
  sweepStaleActiveRuns,
  dbListUnrefundedErrorRunIds,
  dbClaimStripeEvent,
  dbClaimRunRefund,
  dbAddTokensToLot,
  dbApplyTokenLotClawback,
  dbInsertTokenLot,
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

  it('claws a token lot back pro rata and settles on the running refund total', async () => {
    await initDb();
    const stamp = Date.now().toString(16);
    const intent = `pi_claw_${stamp}`;
    // token_lots.user_id references users, so the lot needs a real account.
    const { createUser } = await import('../server/users.mjs');
    const { user } = await createUser({ email: `claw-${stamp}@example.com`, password: 'longenough1' });
    const userId = user.id;
    const lot = await dbInsertTokenLot({
      id: `lot-${stamp}`,
      userId,
      packId: 'pack_10',
      tokensGranted: 10,
      tokensRemaining: 7, // 3 already spent
      purchasedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      stripeCheckoutSessionId: `cs_claw_${stamp}`,
      stripePaymentIntentId: intent,
    });
    assert.ok(lot?.id);

    const half = await dbApplyTokenLotClawback(intent, 0.5);
    assert.equal(half.clawbackTarget, 5);
    assert.equal(half.tokensRemaining, 2);
    assert.equal(half.tokensClawedBack, 5);

    const again = await dbApplyTokenLotClawback(intent, 0.5);
    assert.equal(again.tokensRemaining, 2);

    const full = await dbApplyTokenLotClawback(intent, 1);
    assert.equal(full.clawbackTarget, 10);
    assert.equal(full.tokensRemaining, 0);
    assert.equal(full.tokensClawedBack, 7);

    // A failed scan returns 3 tokens: they stay removed on a refunded lot.
    const restored = await dbAddTokensToLot(lot.id, 3);
    assert.equal(restored.tokensRemaining, 0);
    assert.equal(restored.tokensClawedBack, 10);

    // The refund is reversed: everything unspent comes back.
    const reversed = await dbApplyTokenLotClawback(intent, 0);
    assert.equal(reversed.tokensRemaining, 10);
    assert.equal(reversed.tokensClawedBack, 0);
  });

  it('leaves a freshly touched run alone when the sweep has a minimum age', async () => {
    await initDb();
    const runId = `2026-09-15T00-00-00Z-fresh${Date.now().toString(16).slice(-8)}`;
    await dbUpsertRun('fresh.example', runId, { status: 'running', userId: 'staff' });

    const guarded = await sweepStaleActiveRuns({ minAgeMs: 60_000 });
    assert.equal(guarded.runs.some((run) => run.runId === runId), false);
    assert.equal((await dbGetRun('fresh.example', runId))?.status, 'running');

    const unguarded = await sweepStaleActiveRuns();
    assert.deepEqual(
      unguarded.runs.filter((run) => run.runId === runId),
      [{ domain: 'fresh.example', runId }]
    );
    assert.equal((await dbGetRun('fresh.example', runId))?.status, 'error');
  });

  it('lists errored customer runs that still hold an entitlement until they are refunded', async () => {
    await initDb();
    const stamp = Date.now().toString(16).slice(-8);
    const owed = `2026-09-15T00-00-00Z-owed${stamp}`;
    const staffRun = `2026-09-15T00-00-00Z-stff${stamp}`;
    const noEntitlement = `2026-09-15T00-00-00Z-none${stamp}`;
    await dbUpsertRun('owed.example', owed, { status: 'error', userId: 'u-owed', entitlement: { lots: [], scans: 1 } });
    await dbUpsertRun('owed.example', staffRun, { status: 'error', userId: 'staff', entitlement: { lots: [], scans: 1 } });
    await dbUpsertRun('owed.example', noEntitlement, { status: 'error', userId: 'u-owed' });

    const before = await dbListUnrefundedErrorRunIds();
    assert.equal(before.includes(owed), true);
    assert.equal(before.includes(staffRun), false);
    assert.equal(before.includes(noEntitlement), false);

    await dbClaimRunRefund(owed);
    assert.equal((await dbListUnrefundedErrorRunIds()).includes(owed), false);
  });
});
