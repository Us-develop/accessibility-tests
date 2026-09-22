import { existsSync, readFileSync } from 'fs';

export function readJsonIfExists(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

export function isValidReportId(id) {
  if (typeof id !== 'string' || id.length === 0 || id.length > 120) return false;
  if (id === '.' || id === '..' || id.includes('..')) return false;
  return /^[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(id);
}
