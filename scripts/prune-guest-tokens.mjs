#!/usr/bin/env node
/**
 * Delete expired guest teaser tokens (createdAt + 30 days).
 * Also called from the retention job once it lands.
 *
 * Usage:
 *   node scripts/prune-guest-tokens.mjs
 */
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { pruneExpiredGuestTokens } from '../server/guest.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
if (!process.env.REPORTS_BASE?.trim()) {
  process.env.REPORTS_BASE = join(__dirname, '..', 'reports');
}

function main() {
  const { scanned, pruned } = pruneExpiredGuestTokens();
  console.log(`Guest tokens: scanned ${scanned}, pruned ${pruned}`);
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) main();
