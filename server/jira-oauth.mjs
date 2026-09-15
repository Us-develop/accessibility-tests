/**
 * Jira OAuth state (in-memory) and at-rest token file for reports/<domain>/jira-oauth.json.
 * Tokens are AES-256-GCM encrypted with a key derived from SESSION_SECRET.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { join } from 'path';
import { isValidDomain, domainDir } from './run-ids.js';
import { sessionSecret } from './session.mjs';

export const JIRA_OAUTH_STATE_MAX = 100;
export const JIRA_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const HKDF_SALT = 'wcag-jira-oauth';
const HKDF_INFO = 'jira-oauth.json v1';
const ALG = 'aes-256-gcm';

/** @type {Map<string, { domain: string, expiresAt: number }>} */
export const jiraOauthState = new Map();

export function jiraOAuthFile(domain) {
  return join(domainDir(domain), 'jira-oauth.json');
}

function deriveJiraOAuthKey() {
  return Buffer.from(hkdfSync('sha256', sessionSecret(), HKDF_SALT, HKDF_INFO, 32));
}

export function isJiraOAuthEnvelope(value) {
  return (
    value &&
    typeof value === 'object' &&
    Number(value.v) === 1 &&
    value.alg === ALG &&
    typeof value.iv === 'string' &&
    typeof value.tag === 'string' &&
    typeof value.data === 'string'
  );
}

export function encryptJiraOAuth(data) {
  const key = deriveJiraOAuthKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALG, key, iv, { authTagLength: 16 });
  const plaintext = Buffer.from(JSON.stringify(data), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: 1,
    alg: ALG,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: ciphertext.toString('base64'),
  };
}

export function decryptJiraOAuth(envelope) {
  const key = deriveJiraOAuthKey();
  const iv = Buffer.from(envelope.iv, 'base64');
  const tag = Buffer.from(envelope.tag, 'base64');
  const data = Buffer.from(envelope.data, 'base64');
  const decipher = createDecipheriv(ALG, key, iv, { authTagLength: 16 });
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(data), decipher.final()]);
  return JSON.parse(plaintext.toString('utf8'));
}

/**
 * Drop expired entries, then evict oldest until size < max (room for one insert).
 * @param {Map<string, { domain: string, expiresAt: number }>} map
 * @param {number} [now]
 * @param {number} [max]
 */
export function pruneJiraOauthState(map, now = Date.now(), max = JIRA_OAUTH_STATE_MAX) {
  for (const [state, row] of map) {
    if (!row || row.expiresAt < now) map.delete(state);
  }
  while (map.size >= max) {
    const oldest = map.keys().next().value;
    if (oldest == null) break;
    map.delete(oldest);
  }
}

export function newOauthState(domain) {
  pruneJiraOauthState(jiraOauthState);
  const state = randomBytes(24).toString('hex');
  jiraOauthState.set(state, { domain, expiresAt: Date.now() + JIRA_OAUTH_STATE_TTL_MS });
  return state;
}

export function consumeOauthState(state) {
  const row = jiraOauthState.get(state);
  jiraOauthState.delete(state);
  if (!row) return null;
  if (row.expiresAt < Date.now()) return null;
  return row;
}

export function readJiraOAuth(domain) {
  if (!isValidDomain(domain)) return null;
  const p = jiraOAuthFile(domain);
  if (!existsSync(p)) return null;
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf8'));
    if (isJiraOAuthEnvelope(parsed)) {
      return decryptJiraOAuth(parsed);
    }
    // Plaintext leftover: migrate on first read.
    writeJiraOAuth(domain, parsed);
    return parsed;
  } catch {
    return null;
  }
}

export function writeJiraOAuth(domain, data) {
  if (!isValidDomain(domain)) return;
  const dir = domainDir(domain);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const file = jiraOAuthFile(domain);
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(encryptJiraOAuth(data), null, 2), 'utf8');
  renameSync(tmp, file);
}
