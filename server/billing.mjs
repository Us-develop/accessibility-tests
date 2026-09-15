import { randomBytes } from 'crypto';
import {
  dbPool,
  dbClaimRunRefund,
  dbCountActiveRunsForUser,
  dbDecrementUsage,
  dbGetPlan,
  dbGetSubscription,
  dbGetUsage,
  dbIncrementUsage,
  dbInsertPayment,
  dbFindPaymentByStripeIntent,
  dbListPayments,
  dbListPlans,
  dbGetSubscriptionByStripeCustomer,
  dbGetSubscriptionByStripeSubscription,
  dbUpdatePaymentStatus,
  dbUpsertPlan,
  dbUpsertSubscription,
  dbUpdatePaymentInvoiceUrl,
  withUserLedgerLock,
  withDbTransaction,
} from './db.js';
import { readJsonStore, writeJsonStore } from './json-store.mjs';
import {
  DEFAULT_PLANS,
  MAX_PAGES_PER_CUSTOMER_RUN,
  NONE_PLAN_ID,
  PRO_PAGES_PER_MONTH,
  commercialCtas,
  currentPeriod,
  entitlementError,
  isActiveProSubscription,
  periodBounds,
} from './plan-catalog.mjs';
import { consumeTokens, ensureFreebieLot, getFreebieLot, getTokenBalance, restoreConsumedLots } from './tokens.mjs';

const PLANS_FILE = 'plans.json';
const SUBS_FILE = 'subscriptions.json';
const USAGE_FILE = 'usage.json';
const PAYMENTS_FILE = 'payments.json';

function useDb() {
  return Boolean(dbPool);
}

function loadList(name, key) {
  const data = readJsonStore(name, { [key]: [] });
  return Array.isArray(data[key]) ? data[key] : [];
}

function saveList(name, key, rows) {
  writeJsonStore(name, { [key]: rows });
}

export async function seedPlans() {
  if (useDb()) {
    for (const plan of DEFAULT_PLANS) await dbUpsertPlan(plan);
    return DEFAULT_PLANS;
  }
  const existing = loadList(PLANS_FILE, 'plans');
  const byId = new Map(existing.map((plan) => [plan.id, plan]));
  for (const plan of DEFAULT_PLANS) byId.set(plan.id, { ...byId.get(plan.id), ...plan });
  const next = [...byId.values()].map((plan) => {
    if (plan.id === 'free' || plan.id === 'starter' || plan.id === 'agency') {
      return { ...plan, active: false };
    }
    return plan;
  });
  saveList(PLANS_FILE, 'plans', next);
  return next.filter((plan) => plan.active !== false);
}

export async function getPlan(id) {
  await seedPlans();
  if (useDb()) return dbGetPlan(id);
  return loadList(PLANS_FILE, 'plans').find((p) => p.id === id) || null;
}

export async function listPlans() {
  await seedPlans();
  if (useDb()) return dbListPlans();
  return loadList(PLANS_FILE, 'plans').filter((p) => p.active !== false);
}

export async function getSubscription(userId) {
  if (!userId) return null;
  if (useDb()) return dbGetSubscription(userId);
  return loadList(SUBS_FILE, 'subscriptions').find((s) => s.userId === userId) || null;
}

export async function upsertSubscription(sub) {
  if (useDb()) return dbUpsertSubscription(sub);
  const rows = loadList(SUBS_FILE, 'subscriptions');
  const idx = rows.findIndex((s) => s.userId === sub.userId);
  const next = { ...sub, updatedAt: new Date().toISOString() };
  if (idx === -1) rows.push(next);
  else rows[idx] = { ...rows[idx], ...next };
  saveList(SUBS_FILE, 'subscriptions', rows);
  return idx === -1 ? next : rows[idx];
}

export async function ensureCustomerSubscription(userId, { guestFreebieUsed = false, emailVerified = true } = {}) {
  const existing = await getSubscription(userId);
  if (existing) {
    if (existing.planId === 'free' || existing.planId === 'starter' || existing.planId === 'agency') {
      if (emailVerified) await ensureFreebieLot(userId, { guestFreebieUsed });
      return upsertSubscription({ ...existing, planId: NONE_PLAN_ID });
    }
    if (emailVerified) await ensureFreebieLot(userId, { guestFreebieUsed });
    return existing;
  }
  await seedPlans();
  const { start, end } = periodBounds(currentPeriod());
  const created = await upsertSubscription({
    id: randomBytes(10).toString('hex'),
    userId,
    planId: NONE_PLAN_ID,
    status: 'active',
    currentPeriodStart: start,
    currentPeriodEnd: end,
    cancelAtPeriodEnd: false,
    billingInterval: null,
    stripeSubscriptionId: null,
    stripeCustomerId: null,
    createdAt: new Date().toISOString(),
  });
  if (emailVerified) await ensureFreebieLot(userId, { guestFreebieUsed });
  return created;
}

/** @deprecated Use ensureCustomerSubscription */
export async function ensureFreeSubscription(userId) {
  return ensureCustomerSubscription(userId);
}

export async function getUsage(userId, period = currentPeriod()) {
  if (!userId) return { userId, period, scansUsed: 0, pagesScanned: 0 };
  if (useDb()) return dbGetUsage(userId, period);
  const row = loadList(USAGE_FILE, 'usage').find((u) => u.userId === userId && u.period === period);
  return row || { userId, period, scansUsed: 0, pagesScanned: 0 };
}

export async function incrementUsage(userId, { scans = 1, pages = 0, period = currentPeriod() } = {}) {
  if (!userId) return getUsage(userId, period);
  if (useDb()) return dbIncrementUsage(userId, period, scans, pages);
  const rows = loadList(USAGE_FILE, 'usage');
  const idx = rows.findIndex((u) => u.userId === userId && u.period === period);
  if (idx === -1) {
    const created = { userId, period, scansUsed: Number(scans) || 0, pagesScanned: Number(pages) || 0 };
    rows.push(created);
    saveList(USAGE_FILE, 'usage', rows);
    return created;
  }
  rows[idx] = {
    ...rows[idx],
    scansUsed: Number(rows[idx].scansUsed || 0) + (Number(scans) || 0),
    pagesScanned: Number(rows[idx].pagesScanned || 0) + (Number(pages) || 0),
  };
  saveList(USAGE_FILE, 'usage', rows);
  return rows[idx];
}

export async function listPayments(userId) {
  if (!userId) return [];
  if (useDb()) return dbListPayments(userId);
  return loadList(PAYMENTS_FILE, 'payments')
    .filter((p) => p.userId === userId)
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

export async function listPaymentsWithFreebie(userId) {
  const payments = await listPayments(userId);
  const freebie = await getFreebieLot(userId);
  if (!freebie) return payments;
  const remaining = Number(freebie.tokensRemaining || 0);
  return [
    {
      createdAt: freebie.purchasedAt || freebie.createdAt,
      description: `${remaining} token${remaining === 1 ? '' : 's'}`,
      amountCents: 0,
      currency: 'eur',
      status: 'freebie',
    },
    ...payments,
  ];
}

export async function insertPayment(payment) {
  if (useDb()) return dbInsertPayment(payment);
  const rows = loadList(PAYMENTS_FILE, 'payments');
  if (payment.stripePaymentIntentId) {
    const existing = rows.find((p) => p.stripePaymentIntentId === payment.stripePaymentIntentId);
    if (existing) return existing;
  }
  const row = {
    ...payment,
    createdAt: payment.createdAt || new Date().toISOString(),
  };
  rows.push(row);
  saveList(PAYMENTS_FILE, 'payments', rows);
  return row;
}

export async function getSubscriptionByStripeCustomer(customerId) {
  if (!customerId) return null;
  if (useDb()) return dbGetSubscriptionByStripeCustomer(customerId);
  return loadList(SUBS_FILE, 'subscriptions').find((s) => s.stripeCustomerId === customerId) || null;
}

export async function getSubscriptionByStripeSubscription(subscriptionId) {
  if (!subscriptionId) return null;
  if (useDb()) return dbGetSubscriptionByStripeSubscription(subscriptionId);
  return (
    loadList(SUBS_FILE, 'subscriptions').find((s) => s.stripeSubscriptionId === subscriptionId) || null
  );
}

export async function findPaymentByStripeIntent(intentId) {
  if (!intentId) return null;
  if (useDb()) return dbFindPaymentByStripeIntent(intentId);
  return loadList(PAYMENTS_FILE, 'payments').find((p) => p.stripePaymentIntentId === intentId) || null;
}

export async function updatePaymentInvoiceUrl(intentId, invoiceUrl) {
  if (!intentId || !invoiceUrl) return null;
  if (useDb()) return dbUpdatePaymentInvoiceUrl(intentId, invoiceUrl);
  const rows = loadList(PAYMENTS_FILE, 'payments');
  const idx = rows.findIndex((p) => p.stripePaymentIntentId === intentId);
  if (idx === -1) return null;
  if (rows[idx].invoiceUrl) return rows[idx];
  rows[idx] = { ...rows[idx], invoiceUrl };
  saveList(PAYMENTS_FILE, 'payments', rows);
  return rows[idx];
}

export async function markPaymentStatus(intentId, status) {
  if (!intentId || !status) return null;
  if (useDb()) return dbUpdatePaymentStatus(intentId, status);
  const rows = loadList(PAYMENTS_FILE, 'payments');
  const idx = rows.findIndex((p) => p.stripePaymentIntentId === intentId);
  if (idx === -1) return null;
  rows[idx] = { ...rows[idx], status };
  saveList(PAYMENTS_FILE, 'payments', rows);
  return rows[idx];
}

export async function decrementUsage(userId, { scans = 0, pages = 0, period = currentPeriod() } = {}) {
  if (!userId) return getUsage(userId, period);
  if (useDb()) return dbDecrementUsage(userId, period, scans, pages);
  const rows = loadList(USAGE_FILE, 'usage');
  const idx = rows.findIndex((u) => u.userId === userId && u.period === period);
  if (idx === -1) return { userId, period, scansUsed: 0, pagesScanned: 0 };
  rows[idx] = {
    ...rows[idx],
    scansUsed: Math.max(0, Number(rows[idx].scansUsed || 0) - (Number(scans) || 0)),
    pagesScanned: Math.max(0, Number(rows[idx].pagesScanned || 0) - (Number(pages) || 0)),
  };
  saveList(USAGE_FILE, 'usage', rows);
  return rows[idx];
}

function emptyScanMessage() {
  return 'You need Pro or tokens to scan into your account. Buy a token pack, subscribe to Pro, or request Us services.';
}

/**
 * Soft plan-limit check before a customer scan.
 * Guest scans never call this.
 * @returns {Promise<{ plan: object, usage: object, subscription: object, pagesFromPro: number, pagesFromTokens: number, tokens: object }>}
 */
export async function assertCustomerCanScan(userId, { pages = 1, domain = '', guestFreebieUsed = false } = {}) {
  const subscription = await ensureCustomerSubscription(userId, { guestFreebieUsed });
  const pro = isActiveProSubscription(subscription);
  const plan = await getPlan(pro ? subscription.planId : NONE_PLAN_ID);
  const usage = await getUsage(userId, currentPeriod());
  const tokens = await getTokenBalance(userId);
  const pageCount = Number(pages) || 1;
  const maxPerRun = plan?.maxPagesPerScan ?? MAX_PAGES_PER_CUSTOMER_RUN;

  if (!plan) {
    throw Object.assign(new Error('No plan is assigned to this account.'), { status: 500 });
  }
  if (maxPerRun != null && pageCount > maxPerRun) {
    throw entitlementError(`This account allows ${maxPerRun} page(s) per scan.`, {
      status: 400,
      code: 'plan_page_limit',
    });
  }

  let pagesFromPro = 0;
  let pagesFromTokens = 0;
  if (pro) {
    const remainingPro = Math.max(0, PRO_PAGES_PER_MONTH - Number(usage.pagesScanned || 0));
    if (pageCount <= remainingPro) {
      pagesFromPro = pageCount;
    } else if (pageCount - remainingPro <= tokens.tokens) {
      pagesFromPro = remainingPro;
      pagesFromTokens = pageCount - remainingPro;
    } else {
      throw entitlementError(
        'You have used this month’s Pro pages. Buy extra tokens or wait until next month.',
        { status: 429, code: 'plan_scan_limit' }
      );
    }
  } else if (tokens.tokens >= pageCount) {
    pagesFromTokens = pageCount;
  } else {
    throw entitlementError(emptyScanMessage(), { status: 429, code: 'empty_tokens' });
  }

  return {
    plan,
    usage,
    subscription,
    pagesFromPro,
    pagesFromTokens,
    tokens,
    domain,
    ctas: commercialCtas(),
  };
}

export async function consumeScanEntitlement(userId, { pagesFromTokens = 0, pages = 1 } = {}) {
  const tokenPages = Math.max(0, Number(pagesFromTokens) || 0);
  let lots = [];
  if (tokenPages > 0) {
    const result = await consumeTokens(userId, tokenPages);
    lots = result.lots || [];
  }
  const proPages = Math.max(0, (Number(pages) || 0) - tokenPages);
  await incrementUsage(userId, { scans: 1, pages: proPages });
  return {
    userId,
    pagesFromTokens: tokenPages,
    pagesFromPro: proPages,
    scans: 1,
    lots,
  };
}

/** @type {Map<string, { userId: string, pagesFromTokens: number, pagesFromPro: number, scans: number, lots: object[], refundedAt?: string|null }>} */
const entitlementsByRunId = new Map();

export function rememberRunEntitlement(runId, entitlement) {
  if (!runId || !entitlement) return;
  entitlementsByRunId.set(runId, { ...entitlement, refundedAt: null });
}

async function restoreScanEntitlement(userId, entitlement) {
  if (!userId || !entitlement) return;
  await restoreConsumedLots(entitlement.lots || []);
  await decrementUsage(userId, {
    scans: Number(entitlement.scans) || 1,
    pages: Number(entitlement.pagesFromPro) || 0,
  });
}

/**
 * Re-credit the lot/usage consumed for a scan. Idempotent via `runs.refunded_at`.
 */
export async function refundScanEntitlement(runId) {
  if (!runId) return null;
  if (useDb()) {
    return withDbTransaction(async () => {
      const claimed = await dbClaimRunRefund(runId);
      if (!claimed) return null;
      const entitlement = claimed.entitlement || entitlementsByRunId.get(runId);
      if (entitlement) await restoreScanEntitlement(claimed.userId || entitlement.userId, entitlement);
      const mem = entitlementsByRunId.get(runId);
      if (mem) mem.refundedAt = claimed.refundedAt || new Date().toISOString();
      return claimed;
    });
  }
  const rec = entitlementsByRunId.get(runId);
  if (!rec || rec.refundedAt) return null;
  rec.refundedAt = new Date().toISOString();
  await restoreScanEntitlement(rec.userId, rec);
  return rec;
}

/**
 * Lock, check balance then active-job cap, consume, then `persistFn`.
 * A throw after consume rolls back (Postgres) or restores lots (JSON store).
 */
export async function consumeAndQueueCustomerScan(
  userId,
  { pages = 1, domain = '', guestFreebieUsed = false, isActive } = {},
  persistFn
) {
  if (!userId) {
    throw Object.assign(new Error('Sign in first.'), { status: 401 });
  }
  return withUserLedgerLock(userId, async () => {
    let entitlement = null;
    try {
      const gate = await assertCustomerCanScan(userId, { pages, domain, guestFreebieUsed });
      const dbActive = await dbCountActiveRunsForUser(userId);
      const active = dbActive > 0 || (typeof isActive === 'function' && isActive());
      if (active) {
        throw Object.assign(
          new Error('A scan is already running or waiting for your account. Please wait for it to finish.'),
          { status: 409, code: 'scan_in_progress' }
        );
      }
      entitlement = await consumeScanEntitlement(userId, {
        pages,
        pagesFromTokens: gate.pagesFromTokens || 0,
      });
      if (typeof persistFn === 'function') {
        await persistFn({ gate, entitlement });
      }
      return { gate, entitlement };
    } catch (err) {
      if (err?.code === '23505') {
        throw Object.assign(
          new Error('A scan is already running or waiting for your account. Please wait for it to finish.'),
          { status: 409, code: 'scan_in_progress' }
        );
      }
      if (entitlement && !useDb()) {
        await restoreScanEntitlement(userId, entitlement);
      }
      throw err;
    }
  });
}

export { currentPeriod, DEFAULT_PLANS, commercialCtas };
