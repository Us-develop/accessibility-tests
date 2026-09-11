import { randomBytes } from 'crypto';
import {
  dbPool,
  dbClawbackTokenLotByPaymentIntent,
  dbConsumeTokens,
  dbGetTokenLotByCheckoutSession,
  dbInsertTokenLot,
  dbListTokenLots,
} from './db.js';
import { readJsonStore, writeJsonStore } from './json-store.mjs';
import { TOKEN_TTL_MONTHS, addMonthsUtc, tokenPackById } from './plan-catalog.mjs';

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
  if (!userId || needed <= 0) return { consumed: 0 };
  if (useDb()) {
    const result = await dbConsumeTokens(userId, needed);
    if (result.consumed < needed) {
      throw Object.assign(new Error('Not enough tokens remaining.'), {
        status: 429,
        code: 'empty_tokens',
      });
    }
    return result;
  }
  const now = new Date();
  const rows = loadLots();
  const mine = rows
    .filter((lot) => lot.userId === userId && isUnexpired(lot, now))
    .sort((a, b) => String(a.expiresAt || '').localeCompare(String(b.expiresAt || '')));
  let left = needed;
  for (const lot of mine) {
    if (left <= 0) break;
    const take = Math.min(Number(lot.tokensRemaining || 0), left);
    lot.tokensRemaining = Number(lot.tokensRemaining || 0) - take;
    left -= take;
  }
  if (left > 0) {
    throw Object.assign(new Error('Not enough tokens remaining.'), {
      status: 429,
      code: 'empty_tokens',
    });
  }
  saveLots(rows);
  return { consumed: needed };
}

export async function clawbackTokensForPaymentIntent(intentId) {
  if (!intentId) return null;
  if (useDb()) return dbClawbackTokenLotByPaymentIntent(intentId);
  const rows = loadLots();
  const lot = rows.find((row) => row.stripePaymentIntentId === intentId);
  if (!lot) return null;
  lot.tokensRemaining = 0;
  saveLots(rows);
  return lot;
}
