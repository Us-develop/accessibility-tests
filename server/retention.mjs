import { existsSync, readdirSync, readFileSync, statSync, unlinkSync } from 'fs';
import { join } from 'path';
import { asyncHandler } from './http-utils.mjs';
import {
  dbPool,
  dbClearExpiredAuthTokens,
  dbDeleteExpiredTokenLots,
  dbDeleteLeadById,
  dbDeleteLeadsOlderThan,
  dbDeleteRun,
  dbListGuestRunsOlderThan,
} from './db.js';
import { ftpRemoveRunArtifacts } from './ftp.js';
import {
  deleteGuestTokenFile,
  deleteLeadFileById,
  isGuestTokenExpired,
  listGuestTokenRecords,
  parsePositiveIntEnv,
  pruneGuestFreebies,
  pruneLeadFileRows,
} from './guest.mjs';
import { pruneLeadPrivacyConsents } from './consents.mjs';
import { readJsonStore, writeJsonStore } from './json-store.mjs';
import { REPORTS_BASE } from './paths.js';
import { customerOwnsRun, deleteRunDirectory } from './projects.mjs';

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const QUEUE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const TOKEN_LOT_GRACE_MS = 365 * 24 * 60 * 60 * 1000;
const TWELVE_MONTHS_MS = 365 * 24 * 60 * 60 * 1000;

function envDays(name, fallback) {
  return parsePositiveIntEnv(name, fallback);
}

function logStep(step, count, extra = {}) {
  console.info('[retention]', { step, count, ...extra });
  return count;
}

async function removeRunArtifacts(domain, runId) {
  deleteRunDirectory(domain, runId);
  await ftpRemoveRunArtifacts(domain, runId);
}

async function pruneGuestTokensAndRuns(now) {
  const days = envDays('GUEST_RUN_RETENTION_DAYS', 30);
  const cutoffMs = now.getTime() - days * 24 * 60 * 60 * 1000;
  let tokens = 0;
  let runs = 0;
  for (const rec of listGuestTokenRecords()) {
    const createdMs = Date.parse(rec.createdAt || '');
    const stale =
      rec.unreadable || isGuestTokenExpired(rec, now) || (Number.isFinite(createdMs) && createdMs < cutoffMs);
    if (!stale) continue;
    if (rec.domain && rec.runId) {
      const owned = await customerOwnsRun(rec.domain, rec.runId);
      if (!owned) {
        await removeRunArtifacts(rec.domain, rec.runId);
        if (dbPool && (await dbDeleteRun(rec.domain, rec.runId))) runs += 1;
        else runs += 1;
      }
    }
    if (deleteGuestTokenFile(rec.token)) tokens += 1;
  }
  if (dbPool) {
    const rows = await dbListGuestRunsOlderThan(new Date(cutoffMs));
    for (const row of rows) {
      await removeRunArtifacts(row.domain, row.runId);
      if (row.guestToken) deleteGuestTokenFile(row.guestToken);
      if (await dbDeleteRun(row.domain, row.runId)) runs += 1;
    }
  }
  logStep('guestTokens', tokens);
  logStep('guestRuns', runs);
  return { tokens, runs };
}

function pruneQueueFiles(now) {
  const dir = join(REPORTS_BASE, '_queue');
  if (!existsSync(dir)) return 0;
  let names = [];
  try {
    names = readdirSync(dir);
  } catch {
    return 0;
  }
  let pruned = 0;
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const file = join(dir, name);
    let ts = NaN;
    try {
      const data = JSON.parse(readFileSync(file, 'utf8'));
      ts = Date.parse(data?.createdAt || '');
    } catch {
      ts = NaN;
    }
    try {
      if (!Number.isFinite(ts)) ts = statSync(file).mtimeMs;
    } catch {
      continue;
    }
    if (now.getTime() - ts < QUEUE_RETENTION_MS) continue;
    try {
      unlinkSync(file);
      pruned += 1;
    } catch {
      /* next pass */
    }
  }
  return pruned;
}

function clearExpiredJsonAuthTokens(now) {
  const data = readJsonStore('users.json', { users: [] });
  const users = Array.isArray(data.users) ? data.users : [];
  let verify = 0;
  let reset = 0;
  let pendingEmail = 0;
  const nowMs = now.getTime();
  for (const user of users) {
    if (user.verifyToken && user.verifyExpiresAt && Date.parse(user.verifyExpiresAt) < nowMs) {
      user.verifyToken = null;
      user.verifyExpiresAt = null;
      verify += 1;
    }
    if (user.resetToken && user.resetExpiresAt && Date.parse(user.resetExpiresAt) < nowMs) {
      user.resetToken = null;
      user.resetExpiresAt = null;
      reset += 1;
    }
    if (user.pendingEmailToken && user.pendingEmailExpiresAt && Date.parse(user.pendingEmailExpiresAt) < nowMs) {
      user.pendingEmail = null;
      user.pendingEmailToken = null;
      user.pendingEmailExpiresAt = null;
      pendingEmail += 1;
    }
  }
  if (verify || reset || pendingEmail) writeJsonStore('users.json', { users });
  return { verify, reset, pendingEmail };
}

function deleteExpiredJsonTokenLots(cutoff) {
  const data = readJsonStore('token-lots.json', { lots: [] });
  const lots = Array.isArray(data.lots) ? data.lots : [];
  const kept = lots.filter((lot) => {
    const exp = Date.parse(lot?.expiresAt || '');
    return !Number.isFinite(exp) || exp >= cutoff.getTime();
  });
  const pruned = lots.length - kept.length;
  if (pruned) writeJsonStore('token-lots.json', { lots: kept });
  return pruned;
}

export async function deleteLeadById(id) {
  if (dbPool) {
    const ok = await dbDeleteLeadById(id);
    if (ok) return true;
  }
  return deleteLeadFileById(id);
}

export async function runRetention(now = new Date()) {
  const leadDays = envDays('LEAD_RETENTION_DAYS', 365);
  const leadAgeMs = leadDays * 24 * 60 * 60 * 1000;

  const guest = await pruneGuestTokensAndRuns(now);
  const freebies = pruneGuestFreebies(now, TWELVE_MONTHS_MS);
  logStep('guestFreebies', freebies.pruned, { scanned: freebies.scanned });

  const fileLeads = pruneLeadFileRows(now, leadAgeMs);
  let dbLeads = 0;
  if (dbPool) {
    dbLeads = await dbDeleteLeadsOlderThan(new Date(now.getTime() - leadAgeMs));
  }
  const leadPrivacy = await pruneLeadPrivacyConsents({
    olderThan: new Date(now.getTime() - leadAgeMs),
  });
  logStep('leads', fileLeads.pruned + dbLeads, { file: fileLeads.pruned, db: dbLeads });
  logStep('leadPrivacyConsents', leadPrivacy);

  let tokens = { verify: 0, reset: 0, pendingEmail: 0 };
  if (dbPool) tokens = await dbClearExpiredAuthTokens(now);
  const jsonTokens = clearExpiredJsonAuthTokens(now);
  tokens = {
    verify: tokens.verify + jsonTokens.verify,
    reset: tokens.reset + jsonTokens.reset,
    pendingEmail: tokens.pendingEmail + jsonTokens.pendingEmail,
  };
  logStep('expiredAuthTokens', tokens.verify + tokens.reset + tokens.pendingEmail, tokens);

  const lotCutoff = new Date(now.getTime() - TOKEN_LOT_GRACE_MS);
  let lots = deleteExpiredJsonTokenLots(lotCutoff);
  if (dbPool) lots += await dbDeleteExpiredTokenLots(lotCutoff);
  logStep('expiredTokenLots', lots);

  const queue = pruneQueueFiles(now);
  logStep('queueFiles', queue);

  return {
    guestTokens: guest.tokens,
    guestRuns: guest.runs,
    guestFreebies: freebies.pruned,
    leads: fileLeads.pruned + dbLeads,
    expiredAuthTokens: tokens,
    expiredTokenLots: lots,
    queueFiles: queue,
  };
}

export function startRetentionJob() {
  const tick = () => {
    runRetention().catch((err) => {
      console.error('[retention]', err?.message || err);
    });
  };
  tick();
  return setInterval(tick, SIX_HOURS_MS);
}

export function registerRetentionRoutes(app) {
  app.delete(
    '/api/admin/leads/:id',
    asyncHandler(async (req, res) => {
      if (req.access?.role !== 'staff') {
        return res.status(403).json({ error: 'Staff only.' });
      }
      const ok = await deleteLeadById(req.params.id);
      if (!ok) return res.status(404).json({ error: 'Lead not found.' });
      return res.json({ ok: true });
    })
  );
}
