import { randomBytes } from 'crypto';
import {
  dbPool,
  dbGetPlan,
  dbGetSubscription,
  dbGetUsage,
  dbIncrementUsage,
  dbInsertPayment,
  dbListPayments,
  dbListPlans,
  dbUpsertPlan,
  dbUpsertSubscription,
} from './db.js';
import { readJsonStore, writeJsonStore } from './json-store.mjs';
import { DEFAULT_PLANS, currentPeriod, periodBounds } from './plan-catalog.mjs';
import { listProjectsForUser } from './projects.mjs';

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
  if (existing.length) return existing;
  saveList(PLANS_FILE, 'plans', DEFAULT_PLANS);
  return DEFAULT_PLANS;
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

export async function ensureFreeSubscription(userId) {
  const existing = await getSubscription(userId);
  if (existing) return existing;
  await seedPlans();
  const { start, end } = periodBounds(currentPeriod());
  return upsertSubscription({
    id: randomBytes(10).toString('hex'),
    userId,
    planId: 'free',
    status: 'active',
    currentPeriodStart: start,
    currentPeriodEnd: end,
    stripeSubscriptionId: null,
    stripeCustomerId: null,
    createdAt: new Date().toISOString(),
  });
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

/**
 * Soft plan-limit check before a customer scan.
 * @returns {Promise<{ plan: object, usage: object, subscription: object }>}
 */
export async function assertCustomerCanScan(userId, { pages = 1, domain = '' } = {}) {
  const subscription = await ensureFreeSubscription(userId);
  const plan = await getPlan(subscription.planId || 'free');
  const usage = await getUsage(userId, currentPeriod());
  if (!plan) {
    throw Object.assign(new Error('No plan is assigned to this account.'), { status: 500 });
  }
  if (plan.maxScansPerMonth != null && usage.scansUsed >= plan.maxScansPerMonth) {
    throw Object.assign(
      new Error('You have used this month’s scans on the current plan. Try again next month or upgrade.'),
      { status: 429, code: 'plan_scan_limit' }
    );
  }
  if (plan.maxPagesPerScan != null && pages > plan.maxPagesPerScan) {
    throw Object.assign(
      new Error(`This plan allows ${plan.maxPagesPerScan} page(s) per scan.`),
      { status: 400, code: 'plan_page_limit' }
    );
  }
  if (domain && plan.maxProjects != null) {
    const projects = await listProjectsForUser(userId);
    const owns = projects.some((p) => p.domain === String(domain).toLowerCase());
    if (!owns && projects.length >= plan.maxProjects) {
      throw Object.assign(
        new Error(`This plan allows ${plan.maxProjects} project(s). Remove one or upgrade to add ${domain}.`),
        { status: 429, code: 'plan_project_limit' }
      );
    }
  }
  return { plan, usage, subscription };
}

export { currentPeriod, DEFAULT_PLANS };
