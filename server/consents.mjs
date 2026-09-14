import { createHash } from 'crypto';
import {
  dbPool,
  dbInsertConsent,
  dbGetConsent,
  dbListConsents,
  dbMergeConsentContext,
  dbDeleteConsentsForAccount,
} from './db.js';
import { readJsonStore, writeJsonStore } from './json-store.mjs';

const CONSENTS_FILE = 'consents.json';
const CONSENT_KINDS = new Set(['terms', 'privacy', 'withdrawal_waiver', 'lead_privacy', 'deletion']);

function useDb() {
  return Boolean(dbPool);
}

function loadConsents() {
  const data = readJsonStore(CONSENTS_FILE, { consents: [] });
  return Array.isArray(data.consents) ? data.consents : [];
}

function saveConsents(consents) {
  writeJsonStore(CONSENTS_FILE, { consents });
}

function nextJsonId(rows) {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1;
}

export function hashIp(ip) {
  const raw = String(ip || '').trim();
  if (!raw) return null;
  return createHash('sha256').update(`consent-ip:${raw}`).digest('hex');
}

export function hashEmail(email) {
  const raw = String(email || '').trim().toLowerCase();
  if (!raw) return null;
  const salt = String(process.env.GUEST_IP_HASH_SALT || process.env.SESSION_SECRET || 'consent-email');
  return createHash('sha256').update(`consent-email:${salt}:${raw}`).digest('hex');
}

function clipUserAgent(value) {
  return String(value || '').trim().slice(0, 400) || null;
}

export async function recordConsent({
  userId = null,
  email = null,
  kind,
  version,
  ip = '',
  userAgent = '',
  context = {},
  acceptedAt = null,
} = {}) {
  if (!CONSENT_KINDS.has(kind)) {
    throw Object.assign(new Error('Unknown consent kind.'), { status: 400 });
  }
  const row = {
    userId: userId || null,
    email: email ? String(email).trim().toLowerCase() : null,
    kind,
    version: String(version || ''),
    acceptedAt: acceptedAt || new Date().toISOString(),
    ipHash: hashIp(ip),
    userAgent: clipUserAgent(userAgent),
    context: context && typeof context === 'object' ? context : {},
  };
  if (useDb()) return dbInsertConsent(row);
  const consents = loadConsents();
  const stored = { id: nextJsonId(consents), ...row };
  consents.push(stored);
  saveConsents(consents);
  return stored;
}

export async function getConsent(id) {
  if (id == null) return null;
  if (useDb()) return dbGetConsent(id);
  return loadConsents().find((row) => Number(row.id) === Number(id)) || null;
}

export async function listConsents(filter = {}) {
  if (useDb()) return dbListConsents(filter);
  const email = filter.email ? String(filter.email).trim().toLowerCase() : '';
  return loadConsents()
    .filter((row) => {
      if (filter.userId && row.userId !== filter.userId) return false;
      if (email && row.email !== email) return false;
      if (filter.kind && row.kind !== filter.kind) return false;
      return true;
    })
    .sort((a, b) => String(b.acceptedAt || '').localeCompare(String(a.acceptedAt || '')));
}

export async function mergeConsentContext(id, patch) {
  if (id == null) return null;
  const extra = patch && typeof patch === 'object' ? patch : {};
  if (useDb()) return dbMergeConsentContext(id, extra);
  const consents = loadConsents();
  const idx = consents.findIndex((row) => Number(row.id) === Number(id));
  if (idx === -1) return null;
  consents[idx] = {
    ...consents[idx],
    context: { ...(consents[idx].context || {}), ...extra },
  };
  saveConsents(consents);
  return consents[idx];
}

export async function deleteConsentsForAccount({ userId = null, email = null } = {}) {
  const needleEmail = email ? String(email).trim().toLowerCase() : '';
  let deleted = 0;
  if (useDb()) {
    deleted = await dbDeleteConsentsForAccount({ userId, email: needleEmail });
  } else {
    const consents = loadConsents();
    const kept = consents.filter((row) => {
      if (row.kind === 'deletion') return true;
      if (userId && row.userId === userId) return false;
      if (needleEmail && row.email === needleEmail) return false;
      return true;
    });
    deleted = consents.length - kept.length;
    if (deleted) saveConsents(kept);
  }
  return deleted;
}

export async function recordDeletionTombstone(email) {
  return recordConsent({
    userId: null,
    email: hashEmail(email),
    kind: 'deletion',
    version: '1',
    context: {},
  });
}
