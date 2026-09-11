import { randomBytes } from 'crypto';
import {
  dbPool,
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
  dbUpsertPlan,
  dbUpsertSubscription,
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
import { consumeTokens, ensureFreebieLot, getFreebieLot, getTokenBalance } from './tokens.mjs';

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

export async function ensureCustomerSubscription(userId, { guestFreebieUsed = false } = {}) {
  const existing = await getSubscription(userId);
  if (existing) {
    if (existing.planId === 'free' || existing.planId === 'starter' || existing.planId === 'agency') {
      await ensureFreebieLot(userId, { guestFreebieUsed });
      return upsertSubscription({ ...existing, planId: NONE_PLAN_ID });
    }
    await ensureFreebieLot(userId, { guestFreebieUsed });
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
  await ensureFreebieLot(userId, { guestFreebieUsed });
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
  if (tokenPages > 0) {
    await consumeTokens(userId, tokenPages);
  }
  const proPages = Math.max(0, (Number(pages) || 0) - tokenPages);
  return incrementUsage(userId, { scans: 1, pages: proPages });
}

export { currentPeriod, DEFAULT_PLANS, commercialCtas };
