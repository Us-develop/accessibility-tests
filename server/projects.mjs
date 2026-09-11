import { randomBytes } from 'crypto';
import {
  dbPool,
  dbDeleteProjectsForUser,
  dbFindProjectByDomain,
  dbGetProject,
  dbListProjectsForUser,
  dbSetRunUserId,
  dbUpsertProject,
} from './db.js';
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
    const runIds = [...(existing?.runIds || [])];
    if (runId && !runIds.includes(runId)) runIds.push(runId);
    const project = await dbUpsertProject({
      id: existing?.id || randomBytes(10).toString('hex'),
      userId,
      domain: d,
      name: String(name || existing?.name || d).slice(0, 200),
      runIds,
      createdAt: existing?.createdAt,
    });
    if (runId) await dbSetRunUserId(d, runId, userId);
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

export async function canAccessDomain(access, domain) {
  if (!access) return false;
  if (access.role === 'staff') return true;
  if (access.role === 'customer') return userOwnsDomain(access.userId, domain);
  return false;
}
