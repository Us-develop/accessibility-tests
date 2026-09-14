#!/usr/bin/env node
/**
 * One-shot retention pass: guest tokens/runs, freebies, leads, auth tokens, token lots, queue files.
 *
 * Usage:
 *   node scripts/retention.mjs
 */
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { loadAllAppEnv } from '../server/load-env.mjs';
import { initDb } from '../server/db.js';
import { runRetention } from '../server/retention.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
if (!process.env.REPORTS_BASE?.trim()) {
  process.env.REPORTS_BASE = join(repoRoot, 'reports');
}
loadAllAppEnv(repoRoot);

async function main() {
  await initDb();
  const summary = await runRetention();
  console.log('Retention complete', summary);
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err?.message || err);
    process.exit(1);
  });
}
