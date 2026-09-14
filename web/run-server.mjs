/**
 * Production: Express (API + reports from server/create-app.mjs) + Astro SSR + static client.
 * Run from repo: cd web && npm run build && npm start
 */
import './set-reports-env.mjs';
import express from 'express';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { loadAllAppEnv } from '../server/load-env.mjs';
import { initDb, dbPool } from '../server/db.js';
import { createAccessibilityApp } from '../server/create-app.mjs';
import { installProcessGuards } from '../server/http-utils.mjs';
import { startRetentionJob } from '../server/retention.mjs';
import { setStaticAssetHeaders } from '../server/static-cache.mjs';

installProcessGuards();

const webRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(webRoot, '..');
loadAllAppEnv(repoRoot);
const PORT = Number(process.env.PORT) || 3456;

/**
 * Importing dist/server/entry.mjs runs @astrojs/node `start()` in standalone mode,
 * which binds another HTTP server to localhost:PORT (see process.env.PORT above).
 * Our Express app already listens on PORT for *:PORT — IPv4 clients hit Express, but
 * many browsers resolve "localhost" to ::1 and hit Astro-only, yielding 403 on POST /api/*.
 */
process.env.ASTRO_NODE_AUTOSTART ??= 'disabled';

const { handler } = await import('./dist/server/entry.mjs');

/**
 * Let unauthenticated GET / reach Astro (Layout + LoginModal). API-only server.js keeps Express login HTML for /.
 */
process.env.DEFER_ROOT_LOGIN_TO_SHELL ??= 'true';

let apiApp;
try {
  apiApp = createAccessibilityApp(repoRoot);
} catch (err) {
  console.error(err?.message || err);
  process.exit(1);
}
const app = express();
app.use(apiApp);
app.use(
  express.static(join(webRoot, 'dist/client'), {
    redirect: false,
    maxAge: '1h',
    setHeaders: setStaticAssetHeaders,
  })
);
app.use((req, res, next) => handler(req, res, next, { access: req.access || null }));

await initDb();
if (dbPool) {
  console.log('Postgres persistence enabled (runs table ready).');
} else {
  console.log('Postgres persistence disabled (DATABASE_URL not set).');
}
startRetentionJob();
app.listen(PORT, () => {
  console.log(`Accessibility app (Astro + API) at http://localhost:${PORT}`);
});
