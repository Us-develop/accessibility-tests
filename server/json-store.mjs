/**
 * Atomic JSON file store under reports/_saas/.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { join } from 'path';
import { REPORTS_BASE as FALLBACK_REPORTS_BASE } from './paths.js';

function reportsBase() {
  const fromEnv = String(process.env.REPORTS_BASE || '').trim();
  return fromEnv || FALLBACK_REPORTS_BASE;
}

export function saasDir() {
  return join(reportsBase(), '_saas');
}

export function saasFile(name) {
  return join(saasDir(), name);
}

export function ensureSaasDir() {
  const dir = saasDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * @param {string} name
 * @param {unknown} fallback
 */
export function readJsonStore(name, fallback) {
  const file = saasFile(name);
  if (!existsSync(file)) return fallback;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

/**
 * @param {string} name
 * @param {unknown} value
 */
export function writeJsonStore(name, value) {
  ensureSaasDir();
  const file = saasFile(name);
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  renameSync(tmp, file);
}
