# Accessibility Test Suite

Automated accessibility testing for websites based on **Deque University** checklists. Generates client-ready reports.

## Checklist Chapters

| Chapter | Topic | Source |
|---------|-------|--------|
| 1 | Semantic Structure and Navigation | [module-semantic-checklist.pdf](https://media.dequeuniversity.com/courses/generic/testing-basic-method-and-tools/2.0/en/docs/module-semantic-checklist.pdf) |
| 2 | Images, Canvas, SVG, Non-Text Content | [module-images-checklist.pdf](https://media.dequeuniversity.com/courses/generic/testing-basic-method-and-tools/2.0/en/docs/module-images-checklist.pdf) |
| 3 | Visual Design and Colors | [module-visual-design-checklist.pdf](https://media.dequeuniversity.com/courses/generic/testing-basic-method-and-tools/2.0/en/docs/module-visual-design-checklist.pdf) |
| 4 | Responsive Design and Zoom | [module-responsive-zoom-checklist.pdf](https://media.dequeuniversity.com/courses/generic/testing-basic-method-and-tools/2.0/en/docs/module-responsive-zoom-checklist.pdf) |
| 5 | Multimedia, Animations, Motion | [module-multimedia-checklist.pdf](https://media.dequeuniversity.com/courses/generic/testing-basic-method-and-tools/2.0/en/docs/module-multimedia-checklist.pdf) |
| 6 | Device-Independent Input Methods | [module-input-methods-checklist.pdf](https://media.dequeuniversity.com/courses/generic/testing-basic-method-and-tools/2.0/en/docs/module-input-methods-checklist.pdf) |
| 7 | Form Labels, Instructions, Validation | [module-forms-checklist.pdf](https://media.dequeuniversity.com/courses/generic/testing-basic-method-and-tools/2.0/en/docs/module-forms-checklist.pdf) |
| 8 | Dynamic Updates, AJAX, SPAs | [module-dynamic-updates-checklist.pdf](https://media.dequeuniversity.com/courses/generic/testing-basic-method-and-tools/2.0/en/docs/module-dynamic-updates-checklist.pdf) |

## Setup (dependencies)

Install packages and Chromium once per machine:

```bash
npm install
npx playwright install chromium   # ~250MB; required for tests
```

**Exact local steps:** follow **[SETUP-GUIDE.md](SETUP-GUIDE.md)** (step-by-step checklist).

### Web UI authentication

The server defaults to `AUTH_ENABLED=true` and **requires** `APP_PASSWORD`; it exits on startup if the password is missing. For **local development**, use:

```bash
AUTH_ENABLED=false npm start
```

### How scans work (and limitations)

- **Page load:** URLs open with `domcontentloaded` (see `PAGE_GOTO_TIMEOUT_MS`, optional `WAIT_FOR_NETWORKIDLE` in the test runner and server-spawned runs).
- **Media:** `BLOCK_MEDIA_REQUESTS` (default `true`) skips video/audio fetches, which can change layout or behavior on media-heavy pages.
- **Assisted review:** The suite combines axe-core (WCAG 2.2 A/AA tags), custom heuristics, and a manual checklist. It is **not** a complete WCAG audit or legal sign-off. See `/limitations` in the web UI.
- **Reports:** Axe results are placed in **one primary checklist chapter** per rule (so chapter charts do not double-count the same axe issue). Use the per-page violation list for the canonical axe finding list.

## Web UI

After `AUTH_ENABLED=false npm start` (or `APP_PASSWORD` set — see above), open:

**http://localhost:3456**

You can:

- **Add URLs** in the text area (one per line or comma-separated)
- **Upload a CSV or XML file** (e.g. sitemap.xml) with URLs
- Click **Run accessibility tests** → loading page → report URL

Reports use IDs in the URL, e.g. `http://localhost:3456/report/example.com/` when keyed by domain.

Current behavior:

- Reports are keyed by **domain + run id** (e.g. `https://example.com` →
  `/report/example.com/2026-05-04T13-45-12Z-ab12/`).
- `/report/<domain>/` redirects to the latest run for that domain.
- `/report/<domain>/history` shows every audit ever stored for the domain.
- Each run must contain URLs from a **single domain**.
- Re-running tests for the same domain creates a new run row and a new
  on-disk folder under `reports/<domain>/<runId>/`.

### Optional: Postgres persistence

To store run status/results/manual checklist progress in Postgres:

- Set **`DATABASE_URL`** in the server environment.
- Optional for SSL-required connections: **`DATABASE_SSL=true`**.

When `DATABASE_URL` is set, the server creates a `runs` table and stores run lifecycle, summary metadata, raw report JSON, and manual checklist progress.

If `DATABASE_URL` is not set, the app uses **local files** under `reports/` (and optional FTP — see below).

Monitoring:

- `GET /api/health/db` → DB health (`up`, `down`, or `disabled`).
- `GET /api/report/:domain/:runId/urls` → list URLs stored for a run.
- `GET /api/audits/:domain/runs` → every run for a given domain (used by the history page).

### Publish to the live VPS (OVH)

The production app is on the OVH VPS. It pulls the **`development`** branch. Log in as **`debian`**, then run git, `npm`, and the Astro build as **`deploy`**. The systemd unit is **`accessibility.service`** (not `accessibility-tests`). There is no pm2.

SSH:

```bash
ssh debian@135.125.226.198
```

Then paste:

```bash
cd /srv/accessibility-tests

sudo -u deploy git fetch origin
sudo -u deploy git checkout development
sudo -u deploy git pull --ff-only origin development
sudo -u deploy git log -1 --oneline

# Only if package-lock.json or web/package-lock.json changed:
# sudo -H -u deploy npm ci
# sudo -H -u deploy npm ci --prefix web

sudo -H -u deploy npm run build --prefix web
sudo systemctl restart accessibility.service
sudo systemctl status accessibility.service --no-pager
```

Do **not** run `npm ci` or `npm run build` as `debian` — `node_modules` is owned by `deploy` and you will get `EACCES`. After restart, hard-refresh the site.

If the unit name is ever in doubt:

```bash
systemctl list-units --type=service --state=running | grep -iE 'access|node|wcag'
```

The app **must** be served by Node — the UI is rendered by the Astro shell at `web/` and is built with `npm run build --prefix web`. Static hosting alone is not enough (`/api/run`, `/api/status/:domain/:runId`, reports).

For a new machine (not a routine publish): install dependencies and Chromium (`npm ci`, `npx playwright install chromium`), set **`APP_PASSWORD`** (keep auth enabled), **`PORT`** if needed, optional **`DATABASE_URL`**, optional **`PUBLIC_BASE_URL`**.

**Different origin for HTML vs API:** If users load the form from another host, add inside `<head>` of the Astro layout (`web/src/layouts/Layout.astro`):

```html
<meta name="accessibility-app-base" content="https://your-node-api-host.example">
```

(no trailing slash). Omit this meta when the UI and API are the **same** origin (normal local use).

**Subpath on one host:** If the app lives under e.g. `/accessibility`, use:

```html
<meta name="accessibility-app-base" content="/accessibility">
```

**Heavy scans:** On small instances, tune **`MAX_URLS_PER_RUN`**, **`URL_CONCURRENCY`** (often `1`), and related env vars documented elsewhere in this README (memory section previously tied to Render applies to any low-RAM host).

The repo may include **`render.yaml`** as an **optional** example blueprint — it is **not** required for local development.

### Optional: store manual checklist progress on FTP

To persist the manual/assistive-tech checklist state on your FTP server (e.g. Combell), set these environment variables before starting the server:

| Variable | Description |
|----------|-------------|
| `FTP_HOST` | FTP host (e.g. `ftp.yourdomain.com`) |
| `FTP_USER` | FTP username |
| `FTP_PASSWORD` | FTP password |
| `FTP_SECURE` | Set to `true` for FTPS (TLS) |
| `FTP_REMOTE_PATH` | Optional. Base path on the server (e.g. `reports` or `accessibility/reports`) |

Progress is stored as `{FTP_REMOTE_PATH}/{reportId}/manual-progress.json`. If these are not set, progress is stored only on the server’s local disk (and in the browser).

## CLI (alternative)

### With urls.config.js

Edit `urls.config.js` and run:

```bash
npm run test:report
```

### With inline URLs

```bash
node run-tests.js --report --urls="https://example.com,https://example.com/about" --output-id=my-run
```

### Generate HTML report from existing results

```bash
npm run report
```

## Deploy on Combell

Shared web hosting with the **Node.js** add-on: follow **[deploy/COMBELL.md](deploy/COMBELL.md)** for the Git pipeline, required **`npm run build` / `npm run serve`** flow, environment variables (HTTPS cookies, Postgres, **`REPORTS_BASE`**), and a **support ticket template** before relying on Playwright on shared hosting.

For day-to-day local UI work without reinstalling Chromium, prefer **`npm run build:web`** (Astro only) or **`npm run build --prefix web`**.

## Output

- **`reports/accessibility-results.json`** – Raw test results (axe violations + custom checks)
- **`reports/accessibility-report.html`** – Client-ready HTML report
- **`reports/accessibility-developers.html`** – Developer guide (issues + fix snippets)
- **`reports/accessibility-client.html`** – Client presentation (stats + phased plan)
- **`reports/accessibility-statement.html`** – Draft accessibility statement (customize before publishing)

Each report includes links to these deliverables. When served by the web server, open the report at `/report/{id}/` (trailing slash required for relative links to work), then use the links in the header to open each deliverable.

## What is tested

- **axe-core (Deque)** – WCAG 2.x automated rules (contrast, ARIA, semantics, forms, etc.); each finding is shown once under a **primary** chapter in charts.
- **Custom checks** – Semantic structure, page title, lang, landmarks, headings, links (including image/SVG name heuristics), images, forms, responsive layout, multimedia, input methods, dynamic content.
- **Custom result statuses** – `pass` / `fail` / `warn` / `info` (informational; `info` does not count as a warning in summary totals).

Some checklist items require manual verification (e.g., audio description quality, full 1.4.10 reflow). The report includes pass/warn/fail/info and references to the Deque PDFs for full criteria.
