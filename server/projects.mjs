import { randomBytes } from 'crypto';
import { existsSync, rmSync } from 'fs';
import { join } from 'path';
import {
  dbPool,
  dbDeleteProjectsForUser,
  dbFindProjectByDomain,
  dbGetProject,
  dbGetRun,
  dbListProjectsForUser,
  dbListRunsForUser,
  dbSetRunUserId,
  dbUpsertProject,
} from './db.js';
import { isValidDomain, isValidRunId } from './run-ids.js';
import { REPORTS_BASE } from './paths.js';
import { readJsonStore, writeJsonStore } from './json-store.mjs';

const FILE = 'projects.json';

function useDb() {
  return Boolean(dbPool);
}

function load() {
  const data = readJsonStore(FILE, { projects: [] });
  return Array.isArray(data.projects) ? data.projects : [];
}

function save(projects) {
  writeJsonStore(FILE, { projects });
}

export async function listProjectsForUser(userId) {
  if (!userId) return [];
  if (useDb()) return dbListProjectsForUser(userId);
  return load().filter((p) => p.userId === userId);
}

export async function getProject(id) {
  if (useDb()) return dbGetProject(id);
  return load().find((p) => p.id === id) || null;
}

export async function findProjectByDomain(userId, domain) {
  const d = String(domain || '').toLowerCase();
  if (useDb()) return dbFindProjectByDomain(userId, d);
  return load().find((p) => p.userId === userId && p.domain === d) || null;
}

export async function upsertProject({ userId, domain, name, runId }) {
  const d = String(domain || '').toLowerCase().trim();
  if (!userId || !d) return null;
  if (useDb()) {
    const existing = await dbFindProjectByDomain(userId, d);
    const project = await dbUpsertProject({
      id: existing?.id || randomBytes(10).toString('hex'),
      userId,
      domain: d,
      name: String(name || existing?.name || d).slice(0, 200),
      runIds: existing?.runIds || [],
      createdAt: existing?.createdAt,
    });
    if (runId) await dbSetRunUserId(d, runId, userId);
    if (project && runId && !project.runIds.includes(runId)) {
      project.runIds = [...project.runIds, runId];
    }
    return project;
  }
  const projects = load();
  let project = projects.find((p) => p.userId === userId && p.domain === d);
  if (!project) {
    project = {
      id: randomBytes(10).toString('hex'),
      userId,
      domain: d,
      name: String(name || d).slice(0, 200),
      runIds: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    projects.push(project);
  }
  if (runId && !project.runIds.includes(runId)) project.runIds.push(runId);
  project.updatedAt = new Date().toISOString();
  save(projects);
  return project;
}

export async function userOwnsDomain(userId, domain) {
  if (!userId || !domain) return false;
  return Boolean(await findProjectByDomain(userId, domain));
}

export async function attachRunToUser(userId, domain, runId) {
  return upsertProject({ userId, domain, runId });
}

export async function domainsForUser(userId) {
  return (await listProjectsForUser(userId)).map((p) => p.domain);
}

export async function deleteProjectsForUser(userId) {
  if (useDb()) {
    await dbDeleteProjectsForUser(userId);
    return;
  }
  save(load().filter((p) => p.userId !== userId));
}

export async function listRunRefsForUser(userId) {
  if (!userId) return [];
  if (useDb()) {
    return (await dbListRunsForUser(userId, 5000)).map((row) => ({ domain: row.domain, runId: row.runId }));
  }
  const out = [];
  for (const project of await listProjectsForUser(userId)) {
    for (const runId of project.runIds || []) {
      out.push({ domain: project.domain, runId });
    }
  }
  return out;
}

export function deleteRunDirectory(domain, runId) {
  if (!isValidDomain(domain) || !isValidRunId(runId)) return false;
  const dir = join(REPORTS_BASE, domain, runId);
  if (!existsSync(dir)) return false;
  rmSync(dir, { recursive: true, force: true });
  return true;
}

/** True when a customer account owns this run (DB user_id or a project runIds list). */
export async function customerOwnsRun(domain, runId) {
  if (!isValidDomain(domain) || !isValidRunId(runId)) return false;
  if (useDb()) {
    const row = await dbGetRun(domain, runId);
    return Boolean(row?.userId);
  }
  const needle = String(domain).toLowerCase();
  return load().some(
    (project) =>
      project.domain === needle && Array.isArray(project.runIds) && project.runIds.includes(runId)
  );
}

export async function canAccessDomain(access, domain) {
  if (!access) return false;
  if (access.role === 'staff') return true;
  if (access.role === 'customer') return userOwnsDomain(access.userId, domain);
  return false;
}

const DOMAIN_SCOPED_SECONDS = new Set(['history', 'manual-progress', 'urls', 'runs']);

/**
 * Parse report/API paths into a domain-scoped vs run-scoped tenancy check.
 * `/api/debug/deliverable/:domain/:runId/…` is run-scoped.
 */
export function parseTenantPath(pathname) {
  const path = String(pathname || '');
  const debug = path.match(/^\/api\/debug\/deliverable\/([^/]+)\/([^/]+)(?:\/|$)/);
  if (debug) {
    return { domain: debug[1], runId: debug[2], scoped: 'run' };
  }
  const match = path.match(/^\/(?:api\/status|api\/report|api\/audits|report)\/([^/]+)(?:\/([^/]+))?(?:\/.*)?$/);
  if (!match) return null;
  const domain = match[1];
  const second = match[2] || '';
  if (!second || DOMAIN_SCOPED_SECONDS.has(second) || !isValidRunId(second)) {
    return { domain, runId: null, scoped: 'domain' };
  }
  return { domain, runId: second, scoped: 'run' };
}

/**
 * Customers may only see/modify runs they own. Staff see every run.
 * `user_id IS NULL` (and guest tokens) stay staff/guest-owned.
 * File-store fallback: the run id is listed on the customer's project.
 *
 * @param {{ role?: string, userId?: string } | null} access
 * @param {string} domain
 * @param {string} runId
 * @param {{ memoryRun?: { userId?: string|null, guestToken?: string|null, tier?: string } | null }} [opts]
 */
export async function canAccessRun(access, domain, runId, { memoryRun } = {}) {
  if (!access) return false;
  if (access.role === 'staff') return true;
  if (access.role !== 'customer' || !access.userId) return false;
  if (!isValidDomain(domain) || !isValidRunId(runId)) return false;

  if (memoryRun) {
    if (memoryRun.userId) return memoryRun.userId === access.userId;
    if (memoryRun.guestToken || memoryRun.tier === 'guest' || memoryRun.tier === 'staff') return false;
    if (Object.prototype.hasOwnProperty.call(memoryRun, 'userId') && !memoryRun.userId) return false;
  }

  if (useDb()) {
    const row = await dbGetRun(domain, runId);
    if (row) return row.userId === access.userId;
  }

  const project = await findProjectByDomain(access.userId, domain);
  return Boolean(project && Array.isArray(project.runIds) && project.runIds.includes(runId));
}
