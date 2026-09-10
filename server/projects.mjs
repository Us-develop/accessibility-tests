import { randomBytes } from 'crypto';
import { readJsonStore, writeJsonStore } from './json-store.mjs';

const FILE = 'projects.json';

function load() {
  const data = readJsonStore(FILE, { projects: [] });
  return Array.isArray(data.projects) ? data.projects : [];
}

function save(projects) {
  writeJsonStore(FILE, { projects });
}

export function listProjectsForUser(userId) {
  if (!userId) return [];
  return load().filter((p) => p.userId === userId);
}

export function getProject(id) {
  return load().find((p) => p.id === id) || null;
}

export function findProjectByDomain(userId, domain) {
  const d = String(domain || '').toLowerCase();
  return load().find((p) => p.userId === userId && p.domain === d) || null;
}

export function upsertProject({ userId, domain, name, runId }) {
  const d = String(domain || '').toLowerCase().trim();
  if (!userId || !d) return null;
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

export function userOwnsDomain(userId, domain) {
  if (!userId || !domain) return false;
  return Boolean(findProjectByDomain(userId, domain));
}

export function attachRunToUser(userId, domain, runId) {
  return upsertProject({ userId, domain, runId });
}

export function domainsForUser(userId) {
  return listProjectsForUser(userId).map((p) => p.domain);
}

export function deleteProjectsForUser(userId) {
  save(load().filter((p) => p.userId !== userId));
}

export function canAccessDomain(access, domain) {
  if (!access) return false;
  if (access.role === 'staff') return true;
  if (access.role === 'customer') return userOwnsDomain(access.userId, domain);
  return false;
}
