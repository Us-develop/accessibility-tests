import { config as dotenvConfig } from 'dotenv';
import { existsSync } from 'fs';
import { join } from 'path';

/**
 * Vars the host may inject before Node starts. Always restored after dotenv in development
 * (PaaS / systemd PORT and NODE_ENV must win). In production every dotenv call uses
 * override: false, so host-injected values already win for every key.
 */
const ENV_PRESERVE_FROM_HOST = ['PORT', 'NODE_ENV'];

function loadDotenvFile(path, override) {
  if (!existsSync(path)) return false;
  dotenvConfig({ path, override });
  return true;
}

/**
 * Load local env files for development.
 * Priority: .env.local overrides .env unless `override` is false (production).
 * @param {string} repoRoot
 * @param {{ override?: boolean }} [opts]
 * @returns {string[]} loaded file paths
 */
export function loadLocalEnv(repoRoot, opts = {}) {
  const override = opts.override === true;
  const loaded = [];
  const envPath = join(repoRoot, '.env');
  const envLocalPath = join(repoRoot, '.env.local');
  if (loadDotenvFile(envPath, false)) loaded.push(envPath);
  if (loadDotenvFile(envLocalPath, override)) loaded.push(envLocalPath);
  return loaded;
}

/**
 * Load `web/.env` and `web/.env.local` after repo root.
 * @param {string} repoRoot
 * @param {{ override?: boolean }} [opts]
 * @returns {string[]} loaded file paths
 */
export function loadWebEnv(repoRoot, opts = {}) {
  const override = opts.override === true;
  const loaded = [];
  const webRoot = join(repoRoot, 'web');
  for (const name of ['.env', '.env.local']) {
    const p = join(webRoot, name);
    if (loadDotenvFile(p, override)) loaded.push(p);
  }
  return loaded;
}

/** Root env + web env (typical for server.js and web/run-server.mjs). */
export function loadAllAppEnv(repoRoot) {
  const production = process.env.NODE_ENV === 'production';
  const override = !production;
  const preserved = {};
  for (const k of ENV_PRESERVE_FROM_HOST) {
    if (process.env[k] !== undefined) preserved[k] = process.env[k];
  }
  const loaded = [...loadLocalEnv(repoRoot, { override }), ...loadWebEnv(repoRoot, { override })];
  for (const k of ENV_PRESERVE_FROM_HOST) {
    if (preserved[k] !== undefined) process.env[k] = preserved[k];
  }
  if (loaded.length) {
    console.log(`[env] loaded ${loaded.join(', ')} (NODE_ENV=${process.env.NODE_ENV || ''}, dotenv override=${override})`);
  } else {
    console.log(`[env] no dotenv files found (NODE_ENV=${process.env.NODE_ENV || ''})`);
  }
  return { loaded, production, override };
}
