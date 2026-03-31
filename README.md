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

## Setup

```bash
npm install
npx playwright install chromium   # Download Chromium browser (~250MB, required for tests)
```

## Web UI (recommended)

Start the server and open the form in your browser:

```bash
npm start
```

Then open http://localhost:3456 (or the port shown). You can:

- **Add URLs** in the text area (one per line or comma-separated)
- **Upload a CSV or XML file** (e.g. sitemap.xml) with URLs
- Click **Run accessibility tests** → loading page → redirect to report with unique URL

Each report has a unique ID in the URL, e.g. `http://localhost:3456/report/a1b2c3d4`

Current behavior:

- Reports are keyed by **domain name** (for example: `https://example.com` -> `/report/example.com/`).
- Each run must contain URLs from a **single domain**.
- Re-running tests for the same domain updates/merges that domain report.

### Optional: persist runs in Postgres (Render)

To store run status/results/manual checklist progress in Postgres:

- Set `DATABASE_URL` on the **Node server environment** (Render web service env vars).
- Optional for SSL-required connections: set `DATABASE_SSL=true`.

When `DATABASE_URL` is set, the server automatically creates a `runs` table and stores:

- run lifecycle status (`running`, `done`, `error`)
- summary run metadata (requested/processed URL counts, truncation, errors)
- raw report JSON (`result_json`)
- manual checklist progress (`manual_progress_json`)

If `DATABASE_URL` is not set, the app continues using local files/FTP fallback.

Monitoring endpoint:

- `GET /api/health/db` -> DB health (`up`, `down`, or `disabled`).

### Live / production deployment

The app **requires the Node server** to be running. Uploading only the `public/` folder (e.g. via FTP) is not enough: `/api/run` and `/api/status/:id` are handled by the server. If the server is not running, the form will show: *"API not available: the server returned a page instead of JSON..."*.

- **On your host:** Run `npm install`, then `npm start` (or run `node server.js` in a process manager), and ensure the port is reachable (or put a reverse proxy in front that forwards requests to Node).
- **If the app is under a subpath** (e.g. `https://example.com/accessibility/`): Add this inside `<head>` in both `public/index.html` and `public/loading.html`:
  ```html
  <meta name="accessibility-app-base" content="/accessibility">
  ```
  Replace `/accessibility` with your actual base path (no trailing slash). This makes API and report URLs use that path.

- **Frontend on one host, API on Render** (e.g. form at `https://wcag.about-us.be/`, API at `https://accessibility-tests.onrender.com`): You do **not** run `npm install` / `npm start` yourself — Render runs the app when you deploy (via your Dockerfile or Build/Start commands). In the **copy of `index.html`** that you host on wcag.about-us.be, add inside `<head>`:
  ```html
  <meta name="accessibility-app-base" content="https://accessibility-tests.onrender.com">
  ```
  Use your real Render service URL. Then the form will post to Render, and after submit users are redirected to Render for the loading page and report. The server allows cross-origin requests by default, so the form on wcag.about-us.be can call the Render API.

  **Render memory limits:** The test runner launches Chromium (Playwright), which uses a lot of RAM. On Render’s free tier the service may hit the instance memory limit and restart. To reduce memory use:
  - Set **`MAX_URLS_PER_RUN`** (e.g. `5` or `10`) in the Render environment. The server will run tests only for the first N URLs per run, which keeps each run shorter and lowers peak memory.
  - Set **`URL_CONCURRENCY`** (recommended `1-2` on small instances, `2-4` on larger machines) to control how many URLs are scanned in parallel.
  - Keep **`WAIT_FOR_NETWORKIDLE=false`** (default) for faster runs on tracker-heavy sites. Set it to `true` only when you specifically need network-idle settling.
  - Set **`ENABLE_CONTRAST_CHECKS=false`** to skip custom text/non-text contrast checks for faster runs (axe contrast rules still run).
  - Consider **upgrading the instance type** on Render if you need to test many URLs per run.
  - The runner already uses Chromium flags and explicit cleanup (page/context/browser close) to limit memory.

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

## Output

- **`reports/accessibility-results.json`** – Raw test results (axe violations + custom checks)
- **`reports/accessibility-report.html`** – Client-ready HTML report
- **`reports/accessibility-developers.html`** – Developer guide (issues + fix snippets)
- **`reports/accessibility-client.html`** – Client presentation (stats + phased plan)
- **`reports/accessibility-statement.html`** – Draft accessibility statement (customize before publishing)

Each report includes links to these deliverables. When served by the web server, open the report at `/report/{id}/` (trailing slash required for relative links to work), then use the links in the header to open each deliverable.

## What is tested

- **axe-core (Deque)** – WCAG 2.x automated rules (contrast, ARIA, semantics, forms, etc.)
- **Custom checks** – Semantic structure, page title, lang, landmarks, headings, links, images, forms, responsive layout, multimedia, input methods, dynamic content

Some checklist items require manual verification (e.g., meaningful link text, audio description quality). The report includes pass/warn/fail status and references to the Deque PDFs for full criteria.
