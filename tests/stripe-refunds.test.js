import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'wcag-stripe-refunds-'));
process.env.REPORTS_BASE = tmp;
process.env.SESSION_SECRET = 'unit-test-session-secret-32chars!!';
process.env.AUTH_EMAIL_VERIFY = 'auto';
process.env.STRIPE_PRICE_PACK_10 = 'price_pack10_test';
process.env.STRIPE_PRICE_PRO_MONTHLY = 'price_pro_month_test';
delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_API_KEY;

const { createUser } = await import('../server/users.mjs');
const { getSubscription, listPayments } = await import('../server/billing.mjs');
const {
  clawbackTargetFor,
  consumeTokens,
  getTokenBalance,
  listTokenLots,
  restoreConsumedLots,
  settleTokenLot,
} = await import('../server/tokens.mjs');
const {
  applyStripeSubscription,
  createCheckoutSession,
  fulfillCheckoutSession,
  handleStripeEvent,
  setStripeClientForTests,
} = await import('../server/stripe.mjs');

after(() => {
  setStripeClientForTests(null);
  rmSync(tmp, { recursive: true, force: true });
});

let seq = 0;
/** A new customer who bought one pack_10 for EUR 10.00. Starts with 1 free token + 10. */
async function customerWithPack() {
  seq += 1;
  const { user } = await createUser({ email: `refund-${seq}@example.com`, password: 'longenough1' });
  const intent = `pi_refund_${seq}`;
  await fulfillCheckoutSession({
    id: `cs_refund_${seq}`,
    mode: 'payment',
    payment_status: 'paid',
    amount_total: 1000,
    currency: 'eur',
    created: Math.floor(Date.now() / 1000),
    payment_intent: intent,
    metadata: { userId: user.id, packId: 'pack_10', tokens: '10' },
  });
  return { user, intent };
}

const charge = (intent, amountRefunded, extra = {}) => ({
  id: `ch_${intent}`,
  payment_intent: intent,
  amount: 1000,
  amount_refunded: amountRefunded,
  refunded: amountRefunded >= 1000,
  ...extra,
});

async function packLot(userId) {
  return (await listTokenLots(userId)).find((lot) => lot.packId === 'pack_10');
}

async function paymentStatus(userId, intent) {
  return (await listPayments(userId)).find((p) => p.stripePaymentIntentId === intent)?.status;
}

describe('clawback maths', () => {
  it('takes the refunded share of a pack, rounded down, and all of it on a full refund', () => {
    assert.equal(clawbackTargetFor(10, 0), 0);
    assert.equal(clawbackTargetFor(10, 0.15), 1);
    assert.equal(clawbackTargetFor(10, 0.5), 5);
    assert.equal(clawbackTargetFor(10, 0.999), 9);
    assert.equal(clawbackTargetFor(10, 1), 10);
    assert.equal(clawbackTargetFor(100, 0.125), 12);
  });

  it('never drives a lot negative when tokens were already spent', () => {
    // 10 granted, 8 spent, 2 left, full refund: only 2 can be removed.
    assert.deepEqual(settleTokenLot({ remaining: 2, removed: 0 }, 10), { remaining: 0, removed: 2 });
    // 10 granted, 3 spent, 7 left, half refunded: entitled to 5, 3 spent, 2 left.
    assert.deepEqual(settleTokenLot({ remaining: 7, removed: 0 }, 5), { remaining: 2, removed: 5 });
  });

  it('gives tokens back when the target goes down again', () => {
    assert.deepEqual(settleTokenLot({ remaining: 0, removed: 2 }, 0), { remaining: 2, removed: 0 });
    assert.deepEqual(settleTokenLot({ remaining: 2, removed: 5 }, 1), { remaining: 6, removed: 1 });
  });

  it('keeps a returning scan token out of a fully refunded lot', () => {
    assert.deepEqual(settleTokenLot({ remaining: 0, removed: 2 }, 10, 3), { remaining: 0, removed: 5 });
    assert.deepEqual(settleTokenLot({ remaining: 4, removed: 0 }, 0, 1), { remaining: 5, removed: 0 });
  });
});

describe('refund webhooks', () => {
  it('removes every pack token on a full refund', async () => {
    const { user, intent } = await customerWithPack();
    assert.equal((await getTokenBalance(user.id)).tokens, 11);
    await handleStripeEvent({ id: `evt_full_${intent}`, type: 'charge.refunded', data: { object: charge(intent, 1000) } });
    assert.equal((await getTokenBalance(user.id)).tokens, 1);
    assert.equal(await paymentStatus(user.id, intent), 'refunded');
  });

  it('removes tokens in proportion on partial refunds and settles on the running total', async () => {
    const { user, intent } = await customerWithPack();
    await handleStripeEvent({ id: `evt_p1_${intent}`, type: 'charge.refunded', data: { object: charge(intent, 150) } });
    assert.equal((await packLot(user.id)).tokensRemaining, 9);
    assert.equal(await paymentStatus(user.id, intent), 'partially_refunded');

    await handleStripeEvent({ id: `evt_p2_${intent}`, type: 'charge.refunded', data: { object: charge(intent, 500) } });
    assert.equal((await packLot(user.id)).tokensRemaining, 5);

    // The same totals again under a new event id change nothing.
    await handleStripeEvent({ id: `evt_p3_${intent}`, type: 'charge.refunded', data: { object: charge(intent, 500) } });
    assert.equal((await packLot(user.id)).tokensRemaining, 5);
    assert.equal((await getTokenBalance(user.id)).tokens, 6);
  });

  it('gives the tokens back when a refund fails after all', async () => {
    const { user, intent } = await customerWithPack();
    await handleStripeEvent({ id: `evt_f1_${intent}`, type: 'charge.refunded', data: { object: charge(intent, 1000) } });
    assert.equal((await packLot(user.id)).tokensRemaining, 0);

    // Stripe reports the failed refund; the charge no longer counts it.
    setStripeClientForTests({ charges: { retrieve: async () => charge(intent, 0) } });
    await handleStripeEvent({
      id: `evt_f2_${intent}`,
      type: 'charge.refund.updated',
      data: { object: { id: 're_1', status: 'failed', amount: 1000, charge: `ch_${intent}`, payment_intent: intent } },
    });
    setStripeClientForTests(null);
    assert.equal((await packLot(user.id)).tokensRemaining, 10);
    assert.equal(await paymentStatus(user.id, intent), 'paid');
  });

  it('does not hand a refunded customer tokens back when a scan fails', async () => {
    const { user, intent } = await customerWithPack();
    // Spend the free token and 3 from the pack on one scan.
    const spent = await consumeTokens(user.id, 4);
    await handleStripeEvent({ id: `evt_s1_${intent}`, type: 'charge.refunded', data: { object: charge(intent, 1000) } });
    assert.equal((await getTokenBalance(user.id)).tokens, 0);

    await restoreConsumedLots(spent.lots);
    assert.equal((await packLot(user.id)).tokensRemaining, 0);
    // The complimentary token was not bought, so it does come back.
    assert.equal((await getTokenBalance(user.id)).tokens, 1);
  });

  it('freezes a disputed pack and restores it when the dispute is won', async () => {
    const { user, intent } = await customerWithPack();
    await handleStripeEvent({
      id: `evt_d1_${intent}`,
      type: 'charge.dispute.created',
      data: { object: { id: 'dp_1', status: 'needs_response', payment_intent: intent, charge: `ch_${intent}` } },
    });
    assert.equal((await packLot(user.id)).tokensRemaining, 0);
    assert.equal(await paymentStatus(user.id, intent), 'disputed');

    setStripeClientForTests({ charges: { retrieve: async () => charge(intent, 0) } });
    await handleStripeEvent({
      id: `evt_d2_${intent}`,
      type: 'charge.dispute.closed',
      data: { object: { id: 'dp_1', status: 'won', payment_intent: intent, charge: `ch_${intent}` } },
    });
    setStripeClientForTests(null);
    assert.equal((await packLot(user.id)).tokensRemaining, 10);
    assert.equal(await paymentStatus(user.id, intent), 'paid');
  });

  it('keeps a lost dispute clawed back', async () => {
    const { user, intent } = await customerWithPack();
    await handleStripeEvent({
      id: `evt_l1_${intent}`,
      type: 'charge.dispute.created',
      data: { object: { id: 'dp_2', payment_intent: intent } },
    });
    await handleStripeEvent({
      id: `evt_l2_${intent}`,
      type: 'charge.dispute.closed',
      data: { object: { id: 'dp_2', status: 'lost', payment_intent: intent, charge: `ch_${intent}` } },
    });
    assert.equal((await packLot(user.id)).tokensRemaining, 0);
  });
});

describe('subscriptions', () => {
  const proSub = (userId, id) => ({
    id,
    status: 'active',
    customer: `cus_${id}`,
    metadata: { userId },
    items: { data: [{ price: { id: 'price_pro_month_test', recurring: { interval: 'month' } } }] },
  });

  it('refuses a second Pro checkout while one is live', async () => {
    const { user } = await createUser({ email: 'second-pro@example.com', password: 'longenough1' });
    await applyStripeSubscription(proSub(user.id, 'sub_first'));
    await assert.rejects(
      createCheckoutSession({ user, kind: 'pro', interval: 'monthly' }),
      (err) => err.status === 409 && err.code === 'already_subscribed'
    );
  });

  it('still lets a subscriber buy a token pack', async () => {
    const { user } = await createUser({ email: 'pro-pack@example.com', password: 'longenough1' });
    await applyStripeSubscription(proSub(user.id, 'sub_pack'));
    // Gets past the subscription check and stops at "Stripe is not configured" in this test setup.
    await assert.rejects(createCheckoutSession({ user, kind: 'pack', packId: 'pack_10' }), (err) => err.status !== 409);
  });

  it('acknowledges events for a deleted account without writing anything', async () => {
    const applied = await applyStripeSubscription(proSub('user-that-was-deleted', 'sub_gone'));
    assert.equal(applied, null);
    assert.equal(await getSubscription('user-that-was-deleted'), null);

    const lot = await fulfillCheckoutSession({
      id: 'cs_gone',
      mode: 'payment',
      payment_status: 'paid',
      amount_total: 1000,
      payment_intent: 'pi_gone',
      metadata: { userId: 'user-that-was-deleted', packId: 'pack_10', tokens: '10' },
    });
    assert.equal(lot, null);

    const result = await handleStripeEvent({
      id: 'evt_gone_deleted',
      type: 'customer.subscription.deleted',
      data: { object: { ...proSub('user-that-was-deleted', 'sub_gone'), status: 'canceled' } },
    });
    assert.equal(result.ok, true);
  });
});
