#!/usr/bin/env node
/**
 * Standalone API server: Express API + report routes only (no static UI).
 * Production uses the Astro shell at web/ which proxies /api and /report here.
 * For the full app run: cd web && npm run build && npm start
 */
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { loadAllAppEnv } from './server/load-env.mjs';
import { initDb, dbPool } from './server/db.js';
import { createAccessibilityApp } from './server/create-app.mjs';
import { installProcessGuards } from './server/http-utils.mjs';
import { assertProductionDatabaseUrl } from './server/config.mjs';

installProcessGuards();

const repoRoot = dirname(fileURLToPath(import.meta.url));
loadAllAppEnv(repoRoot);
assertProductionDatabaseUrl();
const PORT = process.env.PORT || 3456;

let app;
try {
  app = createAccessibilityApp(repoRoot);
} catch (err) {
  console.error(err?.message || err);
  process.exit(1);
}
/** API-only process has no Astro shell; after auth, `/` would otherwise 404. */
app.get('/', (req, res) => res.redirect(302, '/audits'));

initDb()
  .then(() => {
    if (dbPool) {
      console.log('Postgres persistence enabled (runs table ready).');
    } else {
      console.log('Postgres persistence disabled (DATABASE_URL not set).');
    }
    app.listen(PORT, () => {
      console.log(`Accessibility API at http://localhost:${PORT} (signed-in home redirects to /audits).`);
      console.log(`Full UI with Astro: cd web && npm run build && npm start`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialize database:', err.message);
    process.exit(1);
  });
