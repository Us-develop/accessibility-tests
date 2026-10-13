# Us accessibility scanner

A web app that scans public web pages for accessibility problems against WCAG 2.2 A and AA, scores them, and turns the findings into reports: a dashboard, a client presentation, a developer fix list and a draft accessibility statement. Built and run by [Us](https://about-us.be), live at `https://wcag.about-us.be`.

It combines [axe-core](https://github.com/dequelabs/axe-core), a set of custom checks, and a manual checklist. It is an assisted review, **not** a complete WCAG audit or legal sign-off; the app says so on every report and on its `/limitations` page.

## Contents

- [Who uses it](#who-uses-it)
- [How it fits together](#how-it-fits-together)
- [Quick start](#quick-start)
- [Run modes](#run-modes)
- [Configuration](#configuration)
- [Signing in locally](#signing-in-locally)
- [Running a scan](#running-a-scan)
- [Tests](#tests)
- [How the score works](#how-the-score-works)
- [Benchmarks in the report](#benchmarks-in-the-report)
- [How scans work, and their limits](#how-scans-work-and-their-limits)
- [What is tested](#what-is-tested)
- [Deploying](#deploying)
- [Branches and contributing](#branches-and-contributing)
- [Troubleshooting](#troubleshooting)

## Who uses it

| Who | Signs in with | What they can do |
| --- | --- | --- |
| **Guest** | Nothing | One free scan of one page. Sees the score, the counts and the top three issues; the rest of the report is shown locked. Can turn the scan into an account. |
| **Customer** | Email and password (`/signup`) | Scans up to 50 pages of one site at a time, paid with tokens (1 token = 1 page) or a Pro subscription (300 pages a month). Sees only their own scans. |
| **Staff** | `APP_USERNAME` / `APP_PASSWORD` | Unlimited scans, sitemap and CSV upload, every report, leads, Jira tickets. |

## How it fits together

```
Browser ──> Caddy (TLS, production only)
              │
              ▼
        web/run-server.mjs          one Node process
        ├─ Express API              server/create-app.mjs  (/api, /auth, /report files)
        ├─ static assets            web/dist/client
        └─ Astro pages (SSR)        web/src/pages, Svelte components
              │
              │ queue (reports/_queue), up to 3 scans at once
              ▼
        run-tests.js                one child process per scan
        └─ Chromium (Playwright) + axe-core + custom checks
              │
              ▼
        reports/<domain>/<runId>/   results JSON, HTML reports, screenshots
        Postgres (optional locally) accounts, runs, tokens, payments
```

- A scan request is validated (public addresses only), queued, and run in a separate process with a stripped-down environment, so a scanned page never shares a process with the server's secrets.
- Report files live on disk under `reports/`. Accounts, runs, tokens and payments live in Postgres in production; without `DATABASE_URL` they fall back to JSON files under `reports/_saas/`, which is fine for local work only.

### Where things are

| Path | What it is |
| --- | --- |
| `server/` | The API: routes (`create-app.mjs`), accounts and sessions, billing, the scan queue, the database layer (`db.js`), the address guard for scans (`url-guard.mjs`). |
| `web/` | The Astro app: pages in `web/src/pages`, Svelte components in `web/src/components`, styles in `web/public/styles`. `web/run-server.mjs` starts everything. |
| `run-tests.js` | The scanner. Run by the server for each scan, or by hand from the command line. |
| `tests/chapter1-…` to `chapter8-….js`, `tests/describe-els.js` | The scanner's custom checks. Despite the folder name these are production code. |
| `tests/*.test.js` | The unit tests. |
| `scoring.js`, `score-model.js` | The score. |
| `generate-report.js`, `generate-deliverables.js`, `report-*.js` | Build the static HTML report, the client and developer deliverables, and the data for the dashboard. |
| `checklists.js`, `manual-checklist.js`, `remediation-data.js`, `wcag-coverage.js`, `wcag-sc-labels.js`, `benchmarks.js` | Reference data: checklist chapters, the manual checks, fix advice and WCAG mappings, coverage of success criteria, published benchmark figures. |
| `server.js` | Starts the API alone, without the pages. Only useful together with `npm run dev:web`. |
| `scripts/` | Maintenance scripts: retention, Stripe catalog, self-scan of the product, one-off migrations. |
| `deploy/` | Production setup: systemd unit, Caddyfile, deploy guide. |
| `docs/` | [Configuration reference](docs/configuration.md), [billing](docs/billing.md), subprocessors. |

## Quick start

You need **Node.js 22.12 or newer** and npm. Nothing else: no database and no accounts with outside services.

```bash
git clone git@github.com:Us-develop/accessibility-tests.git
cd accessibility-tests
git switch development          # the working branch

npm run build                   # installs both packages, downloads Chromium (about 250 MB), builds the pages
AUTH_ENABLED=false npm run serve
```

Open **http://localhost:3456**. With `AUTH_ENABLED=false` there is no login and you are treated as staff. Paste a public URL and start a scan.

`npm run build` reinstalls both `node_modules` folders from the lockfiles each time. After the first run, `npm run build:web` is enough to rebuild the pages.

## Run modes

| Command | What starts | Port | Use it for |
| --- | --- | --- | --- |
| `npm run serve` | The whole app from the last build: API, pages, queue | 3456 | Normal local use, and what production runs. Rebuild with `npm run build:web` after changing anything under `web/`. |
| `npm start` | The API only. There are no pages, so opening it in a browser gives a 404. | 3456 | The backend half of the next row. |
| `npm run dev:web` | Astro's dev server with hot reload. It forwards `/api`, `/auth` and `/report` to port 3456. | 4321 | Working on pages and components. Run `npm start` in a second terminal first. Report pages are served without the API's access checks in this mode, so use it for development only. |

Set `PORT` to change 3456.

## Configuration

Everything is set through environment variables.

```bash
cp .env.example .env.local      # then uncomment what you need
```

`.env.local` is ignored by git and read on startup when `NODE_ENV` is not `production`. Locally, a value in it **overrides** the same variable given on the command line (except `PORT` and `NODE_ENV`).

The full reference, including authentication, Postgres, scan limits, mail and the optional integrations, is in **[docs/configuration.md](docs/configuration.md)**. Stripe is in **[docs/billing.md](docs/billing.md)**.

Do not set `NODE_ENV=production` locally: it makes Postgres, the company details and a public base URL mandatory, and skips `.env.local`.

## Signing in locally

- **No login:** `AUTH_ENABLED=false`. Every request counts as staff. Guest and customer behaviour cannot be tried in this mode.
- **Real logins:** set these in `.env.local` and start without `AUTH_ENABLED=false`:

  ```
  APP_USERNAME=admin
  APP_PASSWORD=at-least-12-characters
  SESSION_SECRET=at-least-32-characters-of-random-text
  ```

  The server refuses to start if `APP_PASSWORD` is shorter than 12 characters or `SESSION_SECRET` shorter than 32.
  - Staff: sign in at `/auth/staff` with the username and password above.
  - Customer: create an account at `/signup`. Locally the email address is accepted without a confirmation mail. A new account gets one free token.
  - Guest: open the home page signed out.
- **Password reset** needs working mail (`SMTP_*`), because the link is only sent by email.
- **Paying** needs Stripe sandbox keys: see [docs/billing.md](docs/billing.md). Without them the pricing page works and checkout answers 503.

## Running a scan

**In the app:** paste one or more URLs of the same site and start. Staff can also upload a sitemap or CSV. The loading page follows progress and opens the report when it is ready.

- A report lives at `/report/<domain>/<runId>/`, with its history at `/report/<domain>/history`.
- Every scan gets its own folder, `reports/<domain>/<runId>/`.
- One scan covers one site (one host name).
- An account can have one scan queued or running at a time; a second request answers 409.
- Only public addresses can be scanned. Private, loopback and internal addresses are refused, so the scanner cannot be pointed at another app on your machine.

**From the command line**, without the app:

```bash
npm run scan:report -- --urls="https://example.com,https://example.com/contact"
```

This writes to `reports/latest/`:

| File | What it is |
| --- | --- |
| `accessibility-results.json` | Raw results: axe findings and custom checks |
| `accessibility-report.html` | The static report |
| `accessibility-client.html` | Client presentation |
| `accessibility-developers.html` | Developer fix list |
| `accessibility-statement.html` | Draft accessibility statement, to be edited before publishing |

Without `--urls`, the scanner uses the list in `urls.config.js`. `npm run report` rebuilds the HTML files from an existing `reports/latest/accessibility-results.json`.

## Tests

```bash
npm run build:web     # once, and after changing web/: one test inspects the built files
npm test              # all unit tests
```

- The tests use Node's built-in test runner and need Chromium, which `npm run build` installed. Some start the API on a random port; none need the network.
- `tests/scanner-checks.test.js` runs the custom checks against small HTML pages in a real browser.
- Tests that need Postgres are in `tests/postgres.test.js` and are skipped without `DATABASE_URL`. To run them, point `DATABASE_URL` at an **empty throwaway** database; they write rows and do not clean up.

  ```bash
  DATABASE_URL=postgres://user:pass@localhost:5432/scratch node --test tests/postgres.test.js
  ```
- CI (`.github/workflows/test.yml`) runs both on every push and pull request.
- `node scripts/self-scan.mjs` builds the app and scans its own public pages; it fails if they have serious accessibility problems.

## How the score works

One overall score out of 100, made of three parts. The model is in `score-model.js`; `scoring.js` turns a scan result into its inputs.

| Part | Weight | What it measures | 100 when |
| --- | --- | --- | --- |
| Errors | 60% | Automated failures (axe violations and failed custom checks) | No automated failure remains |
| To review | 15% | Warnings: findings the tool cannot decide by itself | Every warning is fixed or marked as reviewed |
| Manual checks | 25% | The human checklist | Every item is ticked |

- **Errors, per page:** 100 x weight of rules that passed / weight of rules that passed or failed. A rule counts once per page however many elements fail it. Weights by severity: critical 10, serious 7, moderate 3, minor 1 (for axe rules, the rule's own severity in axe-core). The site figure is the average over the scanned pages.
- **Overall** is 100 only when all three parts are 100, and stays at 79 or below while a critical failure remains.
- **Points to gain:** each failing rule shows how many overall points fixing it everywhere is worth. This is exact, not an estimate.
- Guests and the static HTML report show the Errors score, because they have no manual or review state.
- **Marking a warning as reviewed:** in the dashboard, open a warning and choose "Mark as reviewed" (or "on all pages"). Marks are stored per run in `reports/<domain>/<runId>/reviewed.json` and saved through `PUT /api/report/:domain/:runId/reviewed`. When the same owner scans the site again, marks carry over for every warning that is still there (`server/reviewed.mjs`).
- 100 means nothing is left that this tool can find and the manual checks are done. It is not WCAG conformance.

The scanner always records which axe rules passed (rule ids only), because the Errors part needs them. The former `ENABLE_AXE_PASSES` setting is gone.

## Benchmarks in the report

The static report shows published reference figures next to a run's own findings, in the section "How common are these problems? (indicative)". They come from [The WebAIM Million](https://webaim.org/projects/million/) and live in `benchmarks.js` together with the edition they were taken from.

- They are for indication only. WebAIM uses a different tool (WAVE) on home pages only, so the figures are not a ranking and cannot be compared directly with this scanner's score. The report says so next to the table.
- The report contains no percentile rankings, industry averages or projected scores of our own: we have no data behind such numbers yet.
- WebAIM publishes a new edition each spring. Update `edition`, `retrieved` and all figures in `benchmarks.js` together.
- Planned: once enough scans exist in our own database, add percentiles computed from them alongside the published figures.

## How scans work, and their limits

- **Page load:** URLs open with `domcontentloaded` (see `PAGE_GOTO_TIMEOUT_MS`, optional `WAIT_FOR_NETWORKIDLE` in the test runner and server-spawned runs).
- **Public URLs only:** Every scan URL (guest, customer, staff textarea, CSV, sitemap, other file) is checked with `assertPublicHttpUrl` before it is accepted. Private, loopback, link-local, metadata, and other reserved addresses are dropped with a per-URL reason. The Playwright child re-checks DNS before navigation and aborts requests (including redirect chains) that leave that allowlist.
- **Scanner UA / motion:** Pages load as `AccessibilityScanner/1.0 (+https://<PUBLIC_BASE_URL>)` with `prefers-reduced-motion: reduce` and animations/transitions disabled before axe runs.
- **Media:** `BLOCK_MEDIA_REQUESTS` (default `true`) skips video/audio fetches, which can change layout or behavior on media-heavy pages.
- **Assisted review:** The suite combines axe-core (WCAG 2.2 A/AA tags), custom heuristics, and a manual checklist. It is **not** a complete WCAG audit or legal sign-off. See `/limitations` in the web UI. The product’s own statement is `/accessibility`. `node scripts/self-scan.mjs` builds the app and fails if public pages still have critical/serious axe violations or a `no-horizontal-scroll` fail at 320px or 1280px.
- **Reports:** Axe results are placed in **one primary checklist chapter** per rule (so chapter charts do not double-count the same axe issue). Use the per-page violation list for the canonical axe finding list.

## What is tested

- **axe-core (Deque)** – WCAG 2.x automated rules (contrast, ARIA, semantics, forms, etc.); each finding is shown once under a **primary** chapter in charts.
- **Custom checks** – Semantic structure, page title, lang, landmarks, headings, links (including image/SVG name heuristics), images, forms, responsive layout, multimedia, input methods, dynamic content.
- **Custom result statuses** – `pass` / `fail` / `warn` / `info` (informational; `info` does not count as a warning in summary totals).

Some checklist items require manual verification (e.g., audio description quality, full 1.4.10 reflow). The report includes pass/warn/fail/info and references to the Deque PDFs for full criteria.

### Checklist chapters

The custom checks follow the Deque University checklists:

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

## Deploying

Production is one Node process on a VPS behind Caddy, managed by systemd, with Postgres on the same machine. Everything about it is in **[deploy/README.md](deploy/README.md)**: first install, the env file, publishing an update, backups.

## Branches and contributing

- **`development`** is the working branch and the one production is deployed from.
- **`master`** is the repository's default branch and is kept equal to `development` by fast-forward. Do not commit to it directly.
- Work on a branch off `development` and open a pull request into `development`. CI must pass.
- Commit messages follow `type(scope): summary`, for example `fix(billing): …`, `feat(score): …`, `docs: …`.
- A change to behaviour comes with a test. `npm test` must pass before you open the pull request.

## Troubleshooting

| What you see | What to do |
| --- | --- |
| `Cannot find module …/web/dist/server/entry.mjs` on `npm run serve` | The pages are not built. Run `npm run build:web`. |
| A 404 at `http://localhost:3456` | You started `npm start` (API only). Use `npm run serve`. |
| The server exits at once with a message about `APP_PASSWORD` or `SESSION_SECRET` | Set them (12 and 32 characters or more), or start with `AUTH_ENABLED=false`. |
| `AUTH_ENABLED=false` seems ignored | `.env.local` sets it to `true` and wins. Change it there. |
| Playwright says the browser executable does not exist | `npx playwright install chromium` |
| The build fails on an Astro or Vite error about the Node version | Node must be 22.12 or newer: `node -v`. |
| "We can't scan … yet" | The host name cannot be used as a folder name (trailing dot, underscore, raw IP address). Use the plain host name. |
| A scan of `localhost` or an internal address is refused | By design: only public addresses are scanned. |
| One test fails with "web/dist is missing" | Run `npm run build:web` first. |
