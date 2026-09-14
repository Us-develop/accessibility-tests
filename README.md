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

The server defaults to `AUTH_ENABLED=true` and **requires** `APP_PASSWORD` (≥12 characters) and `SESSION_SECRET` (≥32 characters). It **exits on start** if either is missing or too short. For **local development** only, use:

```bash
AUTH_ENABLED=false npm start
```

Staff sign in with `APP_USERNAME` / `APP_PASSWORD` (cookie session only — no HTTP Basic or `X-App-Password` headers). Customers sign up at `/signup` (email + hashed password, signed `wcag_sid` session, CSRF). Guest 1-page snapshots can attach to the new account (`/signup?guest=TOKEN`). Account deletion (`POST /api/account/delete`) requires the current password, cancels Stripe, and removes that customer's runs, leads, consents (except a deletion tombstone), and guest bindings. `PUT /api/account/email` confirms the new address before switching. A retention job (`node scripts/retention.mjs`, every 6 hours from `web/run-server.mjs`) prunes guest tokens/runs, old leads, expired auth tokens, aged token lots, and `_queue` files.

| Variable | Required in production | Purpose |
| --- | --- | --- |
| `AUTH_ENABLED` | yes (keep `true`) | `false` only for local demos. |
| `APP_USERNAME` | yes | Staff login username. No default. |
| `APP_PASSWORD` | yes | Staff login password, ≥12 characters. Server exits if missing when auth is on. |
| `SESSION_SECRET` | yes | HMAC key for `wcag_sid`, ≥32 characters, and HKDF input for encrypting `reports/<domain>/jira-oauth.json` at rest. Server exits if missing when auth is on or `NODE_ENV=production`. |
| `STAFF_SESSION_VERSION` | no (default `1`) | Bump to invalidate all staff sessions after rotating `APP_PASSWORD`. |
| `DEBUG_ENDPOINTS` | no (default off) | Set `true` to enable staff-only `/api/debug/*` routes. Default off; staff still get 404 when unset. |
| `AUTH_COOKIE_SECURE` | yes (`true` on HTTPS) | Cookie `Secure` flag. Forced `true` when `NODE_ENV=production`; may be `false` only outside production. |
| `TRUST_PROXY_HOPS` | no (default `1`) | Express `trust proxy` hop count (Caddy sits in front). |
| `AUTH_EMAIL_VERIFY` | no (default `required` in production, `auto` otherwise) | `required` sends a verification link and grants the free scan token only after the address is confirmed. |
| `TURNSTILE_SEND_IP` | no (default off) | When `true`, guest captcha verification includes the client IP. Default omits `remoteip`. |
| `GUEST_IP_HASH_SALT` | no (falls back to `SESSION_SECRET`) | Salt for SHA-256 hashes of guest IPs stored in `_guest-tokens/*.json`. |
| `LEAD_RETENTION_DAYS` | no (default `365`) | Retention job (`node scripts/retention.mjs`, every 6 hours in `web/run-server.mjs`) deletes leads older than this. |
| `GUEST_RUN_RETENTION_DAYS` | no (default `30`) | Retention job deletes guest-owned runs, token files, and FTP copies older than this. |
| `WCAG_DISABLE_RATE_LIMIT` | no | Set `1` only in automated tests. Do not set in production. |
| `SCANNER_NO_SANDBOX` | no (default off) | Set `true` only if Chromium cannot start because the host forbids the process sandbox (user namespaces / seccomp). Leave unset on the VPS. |
| `MAIL_FROM` | yes | Envelope From for SMTP. Server exits in production if unset or if it ends with `@localhost`. |
| `PUBLIC_BASE_URL` | yes | Public origin, e.g. `https://wcag.about-us.be`. Server exits in production if unset or if it contains `localhost`. |
| `DATABASE_CA` | no | Path to a PEM CA bundle when `DATABASE_SSL=true` and the server cert is not in the system trust store. |
| `COMPANY_LEGAL_NAME` | yes | Legal name shown in the footer, privacy, terms, and Stripe pack invoice footer. Server exits in production if empty. |
| `COMPANY_KBO` | yes | Crossroads Bank for Enterprises number. Server exits in production if empty. |
| `COMPANY_VAT` | yes | VAT number (for example `BE0123456789`). Server exits in production if empty. Also printed on pack invoices. |
| `COMPANY_ADDRESS` | yes | Registered address. Server exits in production if empty. |
| `COMPANY_EMAIL` | yes | Privacy/contact email for data-subject requests. Server exits in production if empty. |
| `VAT_RATE_DISPLAY` | no (default `0.21`) | Belgian VAT rate used only to show VAT-inclusive catalog prices. Stripe Tax calculates the live amount. |

The public homepage stays the free 1-page **Gratis snapshot** (one per person, guest or signed-in — not both) unless someone is actually signed in with remaining tokens or Pro. Complimentary token is spent first, then **Pro** (300 pages/month), then prepaid **tokens** (1 token = 1 URL, 12-month expiry). Customer `/api/run` validates URLs first, then consumes tokens inside a per-user lock (one queued/running scan per account). A second scan while one is queued or running returns 409. Empty Pro pages and tokens return 429 with buy / subscribe / Us-diensten CTAs. A customer scan that ends in `error` (or is dropped after `SCAN_JOB_TTL_MS`, default 24h) refunds that entitlement once. Pricing is at `/pricing` (VAT-inclusive primary figures). Legal pages: `/terms`, `/privacy`, `/cookies`, `/legal/subprocessors`, `/accessibility`. `/signup`, `/forgot`, and `/reset` are `noindex`.

### How scans work (and limitations)

- **Page load:** URLs open with `domcontentloaded` (see `PAGE_GOTO_TIMEOUT_MS`, optional `WAIT_FOR_NETWORKIDLE` in the test runner and server-spawned runs).
- **Public URLs only:** Every scan URL (guest, customer, staff textarea, CSV, sitemap, other file) is checked with `assertPublicHttpUrl` before it is accepted. Private, loopback, link-local, metadata, and other reserved addresses are dropped with a per-URL reason. The Playwright child re-checks DNS before navigation and aborts requests (including redirect chains) that leave that allowlist.
- **Scanner UA / motion:** Pages load as `AccessibilityScanner/1.0 (+https://<PUBLIC_BASE_URL>)` with `prefers-reduced-motion: reduce` and animations/transitions disabled before axe runs.
- **Media:** `BLOCK_MEDIA_REQUESTS` (default `true`) skips video/audio fetches, which can change layout or behavior on media-heavy pages.
- **Assisted review:** The suite combines axe-core (WCAG 2.2 A/AA tags), custom heuristics, and a manual checklist. It is **not** a complete WCAG audit or legal sign-off. See `/limitations` in the web UI. The product’s own statement is `/accessibility`. `node scripts/self-scan.mjs` builds the app and fails if public pages still have critical/serious axe violations or a `no-horizontal-scroll` fail at 320px or 1280px.
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
  `/report/example.com/2026-05-04T13-45-12Z-ab12cd34ef56/`).
- `/report/<domain>/` redirects to the latest run the **viewer owns** (staff: latest on the domain; a customer: their own latest, or 404). Two customers on the same domain never see each other's runs.
- `/report/<domain>/history` lists runs the viewer may see. Customers only see scans attached to their account; staff see the full domain.
- Each run must contain URLs from a **single domain**.
- Re-running tests for the same domain creates a new run row and a new
  on-disk folder under `reports/<domain>/<runId>/`. A second scan for the **same owner** while one is queued or running returns 409; a guest scan does not block a customer scan of that domain.

### Optional: Postgres persistence

To store run status/results/manual checklist progress **and** customer accounts (users, projects, plans, usage) in Postgres:

- Set **`DATABASE_URL`** in `/etc/accessibility.env` on the VPS (loaded by the systemd unit — not `Environment=` with a password that contains `*` or `%`).
- Optional for SSL-required connections: **`DATABASE_SSL=true`**. With SSL on, the pool uses `rejectUnauthorized: true` and, if set, **`DATABASE_CA`** (path to a PEM file). Localhost Postgres does **not** need SSL.

When `DATABASE_URL` is set, the server creates `runs`, `leads`, `users`, `projects`, `plans`, `subscriptions`, `usage`, `payments`, `token_lots`, `consents`, and `stripe_events` tables. Duplicate Stripe webhook deliveries are ignored (`stripe_events` primary key). `payments.stripe_payment_intent_id` and `subscriptions.stripe_subscription_id` / `stripe_customer_id` are unique when set. Existing `reports/_saas/users.json` and `projects.json` are **inserted once** (`ON CONFLICT DO NOTHING`, never overwriting a DB `password_hash`) and then renamed to `*.imported`. Scan HTML/screenshots stay on disk under `reports/<domain>/<runId>/`.

If `DATABASE_URL` is not set, accounts fall back to those JSON files (fine for local tests; not safe for a campaign).

### Stripe billing

Sellable Stripe items are **one Product each**: token pack 10, pack 50, pack 100, and **one** Pro product with monthly + yearly Prices. Do not put pack prices on the Pro product. Token packs use Checkout `mode: 'payment'`; Pro uses `mode: 'subscription'`. Fulfilment is from **webhooks**, not the success page. Prefer a [restricted API key](https://docs.stripe.com/keys.md#manage-your-api-keys) (`rk_`) over `sk_`. Never commit secrets.

On the VPS, put these in `/etc/accessibility.env` (see **[deploy/README.md](deploy/README.md)**) and restart `accessibility.service`:

| Variable | Purpose |
| --- | --- |
| `STRIPE_SECRET_KEY` | Restricted sandbox key first (`rk_test_…`). |
| `STRIPE_WEBHOOK_SECRET` | Signing secret for `POST /api/stripe/webhook`. |
| `STRIPE_PRICE_PACK_10` / `_50` / `_100` | One-time pack Price IDs. |
| `STRIPE_PRICE_PRO_MONTHLY` / `STRIPE_PRICE_PRO_YEARLY` | Pro Price IDs on the single Pro product. |
| `STRIPE_AUTOMATIC_TAX` | Default `true`. Checkout in `NODE_ENV=production` returns **503** if this is `false`. Requires Tax Settings with a **head office** and **Collecting** registrations (Belgium domestic + Union OSS — confirm with your advisor). |
| `STRIPE_TAX_CODE` | Product tax code (catalog script default `txcd_10103001`). The server logs a warning at boot if unset. |
| `PUBLIC_BASE_URL` | Public origin (`https://wcag.about-us.be`). Required in production. |
| `SCAN_JOB_TTL_MS` | Optional. Default `86400000` (24h). Queued jobs older than this are dropped and consumed customer tokens are refunded. Not required in production. |

Create sandbox Products with `node scripts/stripe-catalog.mjs` (uses placeholder tax code `txcd_10103001` SaaS – Business Use until the advisor confirms). Point a webhook at `https://wcag.about-us.be/api/stripe/webhook` for `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `customer.subscription.*`, `invoice.paid`, `invoice.payment_failed`, `charge.refunded`, `charge.refund.updated`, `charge.dispute.created`. Duplicate deliveries of the same event id return 200 without granting again. Out-of-order `customer.subscription.deleted` events for an old subscription id are ignored when a newer id is already stored.

Pack Checkout sessions enable `invoice_creation` and print `COMPANY_LEGAL_NAME` / `COMPANY_VAT` on the invoice footer. **Set the subscription invoice template once in the Stripe Dashboard** (Settings → Billing → Invoices); the API does not attach that footer to `mode: 'subscription'` sessions.

Customer Portal: allow card update, monthly/yearly switch, and **cancel at period end**. Do not enable pause. Until keys are set, checkout and portal return **503**. `/pricing` still lists the catalog. Checkout requires the immediate-delivery withdrawal waiver and Stripe `consent_collection.terms_of_service`.

Us-diensten (manual AT, remediation, training) has **no Stripe SKU** — link to https://about-us.be/contact/.

After this change is merged to `development`, publish as **`deploy`** (not `debian`). Follow **[deploy/README.md](deploy/README.md)** (git pull, optional `npm ci`, Astro build, `systemctl restart accessibility.service`).

1. Put the Stripe variables above plus `COMPANY_LEGAL_NAME`, `COMPANY_KBO`, `COMPANY_VAT`, `COMPANY_ADDRESS`, and `COMPANY_EMAIL` in `/etc/accessibility.env` (`chmod 600`). Keep `STRIPE_AUTOMATIC_TAX=true` once Tax Settings have a Belgian head office and Collecting registrations. Production checkout refuses to start if automatic tax is off. Do not open Postgres `5432` to the internet.
2. In Stripe Dashboard → Developers → Webhooks, add `https://wcag.about-us.be/api/stripe/webhook` for the events listed above. Copy the signing secret into `STRIPE_WEBHOOK_SECRET`.
3. Dashboard → Tax: set the Belgian head office. Ask the advisor to record **Belgium domestic + Union OSS**. Dashboard → Settings → Billing → Invoices: set the subscription invoice footer to the company legal name and VAT. Threshold monitoring starts at the first **live** payment. Live Products/Prices and live `rk_` only after that confirmation.

Monitoring:

- `GET /api/health/db` → DB health (`up`, `down`, or `disabled`). No login required.
- `GET /api/report/:domain/:runId/urls` → list URLs stored for a run.
- `GET /api/audits/:domain/runs` → runs for a given domain the viewer may see (history page; customers are filtered to their own `user_id`).

### Publish to the live VPS (OVH)

Install, update, Caddy, systemd, and Postgres env-file commands live in **[deploy/README.md](deploy/README.md)**. The production app pulls the **`development`** branch and restarts **`accessibility.service`**.

**Different origin for HTML vs API:** If users load the form from another host, add inside `<head>` of the Astro layout (`web/src/layouts/Layout.astro`):

```html
<meta name="accessibility-app-base" content="https://your-node-api-host.example">
```

(no trailing slash). Omit this meta when the UI and API are the **same** origin (normal local use).

**Subpath on one host:** If the app lives under e.g. `/accessibility`, use:

```html
<meta name="accessibility-app-base" content="/accessibility">
```

**Heavy scans:** On small instances, tune **`MAX_URLS_PER_RUN`**, **`URL_CONCURRENCY`** (often `1`), and related env vars documented elsewhere in this README.

### Optional: store manual checklist progress on FTP

To persist the manual/assistive-tech checklist state on FTP, set these environment variables before starting the server:

| Variable | Description |
|----------|-------------|
| `FTP_HOST` | FTP host (e.g. `ftp.yourdomain.com`) |
| `FTP_USER` | FTP username |
| `FTP_PASSWORD` | FTP password |
| `FTP_SECURE` | FTPS (TLS). Default `true`. Production refuses plaintext FTP. |
| `FTP_REMOTE_PATH` | Optional. Base path on the server (e.g. `reports` or `accessibility/reports`) |

Progress is stored per run as `{FTP_REMOTE_PATH}/{domain}/{runId}/manual-progress.json` (and `runs.manual_progress_json` in Postgres). Domain-level `manual-progress.json` files are no longer written. Migrate leftovers with `node scripts/migrate-manual-progress.mjs --apply`. If FTP variables are not set, progress is stored only on the server’s local disk (and in the browser).

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
