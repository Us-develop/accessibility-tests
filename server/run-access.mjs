import { listAuditEntries, listRunsForDomain } from './audit-list.js';
import { findProjectByDomain, listProjectsForUser } from './projects.mjs';
import { dbGetRun, dbPool } from './db.js';
import { REPORTS_BASE } from './paths.js';

/** Customers only see their own runs; staff see every run on the domain. */
export function viewerUserId(access) {
  if (access?.role === 'customer' && access.userId && access.userId !== 'staff') {
    return access.userId;
  }
  return null;
}

async function allowedRunIdsForUser(userId, domain) {
  if (!userId || !domain) return new Set();
  const project = await findProjectByDomain(userId, domain);
  return new Set(project?.runIds || []);
}

export async function listRunsForAccess(access, domain, pool = dbPool, reportsBase = REPORTS_BASE) {
  const userId = viewerUserId(access);
  const allowedRunIds = userId ? await allowedRunIdsForUser(userId, domain) : null;
  return listRunsForDomain(pool, reportsBase, domain, { userId, allowedRunIds });
}

export async function listAuditEntriesForAccess(access, pool = dbPool, reportsBase = REPORTS_BASE) {
  const userId = viewerUserId(access);
  if (!userId) return listAuditEntries(pool, reportsBase);
  const projects = await listProjectsForUser(userId);
  const entries = [];
  for (const project of projects) {
    const runs = await listRunsForAccess(access, project.domain, pool, reportsBase);
    if (!runs.length) continue;
    const latest = runs[0];
    entries.push({
      id: project.domain,
      domain: project.domain,
      latestRunId: latest.runId,
      status: latest.status,
      updatedAt: latest.updatedAt,
      pages: latest.pages,
      issues: latest.issues,
      totalRuns: runs.length,
      source: latest.source,
    });
  }
  return entries.sort((a, b) => {
    const ta = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
    const tb = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
    return tb - ta;
  });
}

export async function canAccessRun(access, domain, runId) {
  if (!access) return false;
  if (access.role === 'staff') return true;
  if (access.role !== 'customer' || !access.userId) return false;
  if (!domain || !runId) return false;
  if (dbPool) {
    try {
      const row = await dbGetRun(domain, runId);
      if (row?.userId) return row.userId === access.userId;
    } catch {
      /* fall through to project run list */
    }
  }
  const allowed = await allowedRunIdsForUser(access.userId, domain);
  return allowed.has(runId);
}
