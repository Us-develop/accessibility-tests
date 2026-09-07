import { parsePositiveIntEnv } from './guest.mjs';
import { readJsonStore, writeJsonStore } from './json-store.mjs';
import { hasActiveSubscription } from './users.mjs';

const FILE = 'credits.json';

export const PAGE_CREDITS_PER_MONTH = parsePositiveIntEnv('PAGE_CREDITS_PER_MONTH', 300);
export const CUSTOMER_MAX_URLS_PER_RUN = parsePositiveIntEnv('CUSTOMER_MAX_URLS_PER_RUN', 50);

function periodKey(date = new Date()) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function load() {
  const data = readJsonStore(FILE, { periods: {} });
  return data.periods && typeof data.periods === 'object' ? data.periods : {};
}

function save(periods) {
  writeJsonStore(FILE, { periods });
}

function bucket(userId) {
  const periods = load();
  const key = `${userId}:${periodKey()}`;
  if (!periods[key]) periods[key] = { used: 0, reserved: 0 };
  return { periods, key, row: periods[key] };
}

export function creditSnapshot(user) {
  if (!user || user.role === 'staff') {
    return { unlimited: true, used: 0, reserved: 0, remaining: null, limit: null, period: periodKey() };
  }
  const { row } = bucket(user.id);
  const used = Number(row.used || 0) + Number(row.reserved || 0);
  const remaining = Math.max(0, PAGE_CREDITS_PER_MONTH - used);
  return {
    unlimited: false,
    used: Number(row.used || 0),
    reserved: Number(row.reserved || 0),
    remaining,
    limit: PAGE_CREDITS_PER_MONTH,
    period: periodKey(),
    subscribed: hasActiveSubscription(user),
  };
}

export function assertCanSpend(user, pages) {
  const n = Math.max(1, Number(pages) || 1);
  if (!user || user.role === 'staff') return;
  if (!hasActiveSubscription(user)) {
    throw Object.assign(new Error('A Pro subscription is required to run full audits.'), { status: 402 });
  }
  const snap = creditSnapshot(user);
  if (snap.remaining < n) {
    throw Object.assign(
      new Error(`Not enough page credits this month (${snap.remaining} left, this run needs ${n}).`),
      { status: 402 }
    );
  }
}

export function reserveCredits(userId, pages) {
  const n = Math.max(1, Number(pages) || 1);
  const { periods, key, row } = bucket(userId);
  row.reserved = Number(row.reserved || 0) + n;
  periods[key] = row;
  save(periods);
}

export function commitCredits(userId, pages) {
  const n = Math.max(1, Number(pages) || 1);
  const { periods, key, row } = bucket(userId);
  row.reserved = Math.max(0, Number(row.reserved || 0) - n);
  row.used = Number(row.used || 0) + n;
  periods[key] = row;
  save(periods);
}

export function releaseCredits(userId, pages) {
  const n = Math.max(1, Number(pages) || 1);
  const { periods, key, row } = bucket(userId);
  row.reserved = Math.max(0, Number(row.reserved || 0) - n);
  periods[key] = row;
  save(periods);
}

export function customerHasRunningScan(runStatus, userId) {
  if (!userId) return false;
  for (const value of runStatus.values()) {
    if (value?.status === 'running' && value.userId === userId) return true;
    if (value?.status === 'queued' && value.userId === userId) return true;
  }
  return false;
}
