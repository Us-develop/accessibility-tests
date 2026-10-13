import { randomBytes } from 'crypto';
import {
  dbPool,
  dbAddTokensToLot,
  dbApplyTokenLotClawback,
  dbConsumeTokens,
  dbGetTokenLotByCheckoutSession,
  dbInsertTokenLot,
  dbListRunsForUser,
  dbListTokenLots,
  dbSetTokenLotRemaining,
} from './db.js';
import { readJsonStore, writeJsonStore } from './json-store.mjs';
import { listProjectsForUser } from './projects.mjs';
import { FREEBIE_PACK_ID, TOKEN_TTL_MONTHS, addMonthsUtc, tokenPackById } from './plan-catalog.mjs';

const LOTS_FILE = 'token-lots.json';

function useDb() {
  return Boolean(dbPool);
}

function loadLots() {
  const data = readJsonStore(LOTS_FILE, { lots: [] });
  return Array.isArray(data.lots) ? data.lots : [];
}

function saveLots(lots) {
  writeJsonStore(LOTS_FILE, { lots });
}

function nowIso() {
  return new Date().toISOString();
}

function compareLotsForConsume(a, b) {
  const af = a.packId === FREEBIE_PACK_ID ? 0 : 1;
  const bf = b.packId === FREEBIE_PACK_ID ? 0 : 1;
  if (af !== bf) return af - bf;
  return String(a.expiresAt || '').localeCompare(String(b.expiresAt || ''));
}

function isUnexpired(lot, now = new Date()) {
  if (!lot) return false;
  const remaining = Number(lot.tokensRemaining || 0);
  if (remaining <= 0) return false;
  const expires = lot.expiresAt ? new Date(lot.expiresAt) : null;
  if (expires && expires.getTime() <= now.getTime()) return false;
  return true;
}

export function tokenExpiryFrom(purchasedAt = new Date()) {
  return addMonthsUtc(new Date(purchasedAt), TOKEN_TTL_MONTHS).toISOString();
}

export async function listTokenLots(userId) {
  if (!userId) return [];
  if (useDb()) return dbListTokenLots(userId);
  return loadLots()
    .filter((lot) => lot.userId === userId)
    .sort((a, b) => String(a.expiresAt || '').localeCompare(String(b.expiresAt || '')));
}

export async function getTokenBalance(userId, now = new Date()) {
  if (!userId) return { tokens: 0, nextExpiresAt: null, lots: [] };
  const lots = (await listTokenLots(userId)).filter((lot) => isUnexpired(lot, now));
  const tokens = lots.reduce((sum, lot) => sum + Number(lot.tokensRemaining || 0), 0);
  const nextExpiresAt = lots[0]?.expiresAt || null;
  return { tokens, nextExpiresAt, lots };
}

export async function findTokenLotByCheckoutSession(sessionId) {
  if (!sessionId) return null;
  if (useDb()) return dbGetTokenLotByCheckoutSession(sessionId);
  return loadLots().find((lot) => lot.stripeCheckoutSessionId === sessionId) || null;
}

export async function grantTokenPack({
  userId,
  packId,
  tokens,
  stripeCheckoutSessionId,
  stripePaymentIntentId,
  purchasedAt,
} = {}) {
  if (!userId) return null;
  const pack = tokenPackById(packId);
  const granted = Number(tokens || pack?.tokens || 0);
  if (granted <= 0) return null;
  if (stripeCheckoutSessionId) {
    const existing = await findTokenLotByCheckoutSession(stripeCheckoutSessionId);
    if (existing) return existing;
  }
  const bought = purchasedAt ? new Date(purchasedAt) : new Date();
  const lot = {
    id: randomBytes(10).toString('hex'),
    userId,
    packId: packId || pack?.id || null,
    tokensGranted: granted,
    tokensRemaining: granted,
    purchasedAt: bought.toISOString(),
    expiresAt: tokenExpiryFrom(bought),
    stripeCheckoutSessionId: stripeCheckoutSessionId || null,
    stripePaymentIntentId: stripePaymentIntentId || null,
    createdAt: nowIso(),
  };
  if (useDb()) return dbInsertTokenLot(lot);
  const rows = loadLots();
  rows.push(lot);
  saveLots(rows);
  return lot;
}

export async function consumeTokens(userId, amount) {
  const needed = Number(amount) || 0;
  if (!userId || needed <= 0) return { consumed: 0, lots: [] };
  if (useDb()) {
    const result = await dbConsumeTokens(userId, needed);
    if (result.consumed < needed) {
      throw Object.assign(new Error('Not enough tokens remaining.'), {
        status: 429,
        code: 'empty_tokens',
      });
    }
    return { consumed: result.consumed, lots: result.lots || [] };
  }
  const now = new Date();
  const rows = loadLots();
  const mine = rows
    .filter((lot) => lot.userId === userId && isUnexpired(lot, now))
    .sort(compareLotsForConsume);
  let left = needed;
  const lots = [];
  for (const lot of mine) {
    if (left <= 0) break;
    const take = Math.min(Number(lot.tokensRemaining || 0), left);
    lot.tokensRemaining = Number(lot.tokensRemaining || 0) - take;
    lots.push({ id: lot.id, amount: take });
    left -= take;
  }
  if (left > 0) {
    for (const lot of lots) {
      const row = rows.find((item) => item.id === lot.id);
      if (row) row.tokensRemaining = Number(row.tokensRemaining || 0) + lot.amount;
    }
    throw Object.assign(new Error('Not enough tokens remaining.'), {
      status: 429,
      code: 'empty_tokens',
    });
  }
  saveLots(rows);
  return { consumed: needed, lots };
}

/**
 * How many tokens of a lot a refund takes away. A full refund takes them all;
 * a partial refund takes the same share of the pack, rounded down in the
 * customer's favour (15% back on a 10 pack removes 1 token, not 2).
 * @param {number} granted
 * @param {number} refundedFraction refunded amount / charged amount, 0..1
 */
export function clawbackTargetFor(granted, refundedFraction) {
  const total = Math.max(0, Number(granted) || 0);
  const fraction = Math.min(1, Math.max(0, Number(refundedFraction) || 0));
  return fraction >= 1 ? total : Math.floor(total * fraction);
}

/**
 * Recompute a lot after its clawback target changed or tokens came back from a
 * failed scan.
 *
 * `remaining + removed` is everything the customer has not spent. They keep
 * what is left of that after the target is taken off; the rest is `removed`.
 * Recomputing from those two numbers keeps the result right when refunds
 * arrive in steps, when a refund is later reversed (the target goes down and
 * tokens return), and when the customer had already spent more than they were
 * left entitled to (remaining stops at 0 and never goes negative).
 *
 * The SQL in dbApplyTokenLotClawback and dbAddTokensToLot does the same sum.
 * @param {{ remaining: number, removed: number }} lot
 * @param {number} target tokens the refunds take away in total
 * @param {number} [add] tokens returning from a failed scan
 */
export function settleTokenLot({ remaining, removed }, target, add = 0) {
  const unspent = Math.max(0, Number(remaining) || 0) + Math.max(0, Number(removed) || 0) + Math.max(0, Number(add) || 0);
  const nextRemaining = Math.max(0, unspent - Math.max(0, Number(target) || 0));
  return { remaining: nextRemaining, removed: unspent - nextRemaining };
}

export async function restoreConsumedLots(lots) {
  if (!Array.isArray(lots) || !lots.length) return;
  for (const lot of lots) {
    const amount = Number(lot?.amount) || 0;
    if (!lot?.id || amount <= 0) continue;
    if (useDb()) {
      await dbAddTokensToLot(lot.id, amount);
      continue;
    }
    const rows = loadLots();
    const found = rows.find((row) => row.id === lot.id);
    if (found) {
      // A refunded lot does not get tokens back just because a scan failed.
      const next = settleTokenLot(
        { remaining: found.tokensRemaining, removed: found.tokensClawedBack },
        found.clawbackTarget,
        amount
      );
      found.tokensRemaining = next.remaining;
      found.tokensClawedBack = next.removed;
    }
    saveLots(rows);
  }
}

/**
 * Bring the token lot bought with this payment in line with how much of the
 * payment has been refunded so far. Safe to call again with the same or a
 * different fraction: the lot is recomputed, not decremented.
 * @param {string} intentId Stripe payment intent of the pack purchase
 * @param {number} refundedFraction refunded amount / charged amount, 0..1
 */
export async function applyRefundToTokenLot(intentId, refundedFraction) {
  if (!intentId) return null;
  const fraction = Math.min(1, Math.max(0, Number(refundedFraction) || 0));
  if (useDb()) return dbApplyTokenLotClawback(intentId, fraction);
  const rows = loadLots();
  const lot = rows.find((row) => row.stripePaymentIntentId === intentId);
  if (!lot) return null;
  const target = clawbackTargetFor(lot.tokensGranted, fraction);
  const next = settleTokenLot({ remaining: lot.tokensRemaining, removed: lot.tokensClawedBack }, target);
  lot.tokensRemaining = next.remaining;
  lot.tokensClawedBack = next.removed;
  lot.clawbackTarget = target;
  saveLots(rows);
  return lot;
}

export async function getFreebieLot(userId) {
  if (!userId) return null;
  const lots = await listTokenLots(userId);
  return lots.find((lot) => lot.packId === FREEBIE_PACK_ID) || null;
}

async function userAlreadyScanned(userId) {
  if (useDb()) {
    const rows = await dbListRunsForUser(userId, 1);
    return rows.length > 0;
  }
  const projects = await listProjectsForUser(userId);
  return projects.some((project) => (project.runIds || []).length > 0);
}

async function setLotRemaining(lot, remaining) {
  const next = Math.max(0, Number(remaining) || 0);
  if (useDb()) return dbSetTokenLotRemaining(lot.id, next);
  const rows = loadLots();
  const found = rows.find((row) => row.id === lot.id);
  if (found) found.tokensRemaining = next;
  saveLots(rows);
  return { ...lot, tokensRemaining: next };
}

/**
 * One complimentary token per account. If they already used the guest snapshot
 * (cookie/IP or an attached run), the lot is recorded as used (0 remaining) so
 * Payment history can still show Freebie.
 */
export async function ensureFreebieLot(userId, { guestFreebieUsed = false } = {}) {
  if (!userId) return null;
  const alreadyScanned = await userAlreadyScanned(userId);
  const used = Boolean(guestFreebieUsed) || alreadyScanned;
  const existing = await getFreebieLot(userId);
  if (existing) {
    if (guestFreebieUsed && Number(existing.tokensRemaining || 0) > 0) {
      return setLotRemaining(existing, 0);
    }
    return existing;
  }
  const remaining = used ? 0 : 1;
  const now = new Date();
  const lot = {
    id: randomBytes(10).toString('hex'),
    userId,
    packId: FREEBIE_PACK_ID,
    tokensGranted: 1,
    tokensRemaining: remaining,
    purchasedAt: now.toISOString(),
    expiresAt: tokenExpiryFrom(now),
    stripeCheckoutSessionId: null,
    stripePaymentIntentId: null,
    createdAt: nowIso(),
  };
  try {
    if (useDb()) return dbInsertTokenLot(lot);
    const rows = loadLots();
    rows.push(lot);
    saveLots(rows);
    return lot;
  } catch (err) {
    const again = await getFreebieLot(userId);
    if (again) return again;
    throw err;
  }
}
