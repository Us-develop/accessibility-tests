# Configuration reference

Every setting is an environment variable. [`.env.example`](../.env.example) lists them all with a one-line note each; this page explains the ones that need more than a line.

## Where settings come from

| Where you run | Settings are read from |
| --- | --- |
| Locally (`NODE_ENV` not `production`) | `.env`, then `.env.local`, then `web/.env` and `web/.env.local`, all in the repo. Copy `.env.example` to `.env.local` to start. |
| Production (`NODE_ENV=production`) | Only the process environment. On the VPS that is `/etc/accessibility.env`, loaded by systemd. No dotenv file is read. |

Locally, a value in a dotenv file **overrides** the same variable set in your shell, except `PORT` and `NODE_ENV`. So `AUTH_ENABLED=false npm run serve` has no effect if `.env.local` sets `AUTH_ENABLED=true`. Set `WCAG_DOTENV_OVERRIDE=0` to make the shell win.

The server prints which files it loaded on startup (`[env] loaded …`).

## Authentication and accounts

The server defaults to `AUTH_ENABLED=true` and **requires** `APP_PASSWORD` (≥12 characters) and `SESSION_SECRET` (≥32 characters). It **exits on start** if either is missing or too short. For **local development** only, start with `AUTH_ENABLED=false` (see the README quick start).

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
| `COMPANY_PHONE` | no | Phone number in the site footer. Hidden when empty. |
| `COMPANY_WEBSITE` | no | Company website for the "Discover more about Us" button in the footer. Hidden when empty. |
| `COMPANY_LINKEDIN_URL` | no | LinkedIn page linked from the footer. Hidden when empty. |
| `VAT_RATE_DISPLAY` | no (default `0.21`) | Belgian VAT rate used only to show VAT-inclusive catalog prices. Stripe Tax calculates the live amount. |

The public homepage stays the free 1-page **Gratis snapshot** (one per person, guest or signed-in — not both) unless someone is actually signed in with remaining tokens or Pro. Complimentary token is spent first, then **Pro** (300 pages/month), then prepaid **tokens** (1 token = 1 URL, 12-month expiry). Customer `/api/run` validates URLs first, then consumes tokens inside a per-user lock (one queued/running scan per account). A second scan while one is queued or running returns 409. Empty Pro pages and tokens return 429 with buy / subscribe / Us-diensten CTAs. A customer scan that ends in `error` (or is dropped after `SCAN_JOB_TTL_MS`, default 24h) refunds that entitlement once. Pricing is at `/pricing` (VAT-inclusive primary figures). Legal pages: `/terms`, `/privacy`, `/cookies`, `/legal/subprocessors`, `/accessibility`. Those eight URLs (home, pricing, limitations, and the legal set) are the indexable set; `/signup`, `/forgot`, `/reset`, `/loading`, `/teaser/*`, and signed-in surfaces send `noindex`. `GET /robots.txt` allows `/` and disallows `/api/`, `/report/`, `/audits`, `/admin/`, `/account`, and `/teaser/`, and points at `/sitemap.xml`. Fonts are self-hosted woff2 under `web/public/fonts/` (Public Sans, Archivo; optional Adobe Owners files in `web/public/fonts/owners/`). Caddy already gzip/zstd-encodes responses.

## Postgres

Required in production: with `NODE_ENV=production` the process exits at startup without `DATABASE_URL`. Optional locally, where accounts fall back to JSON files.

To store run status/results/manual checklist progress **and** customer accounts (users, projects, plans, usage) in Postgres:

- Set **`DATABASE_URL`** in `/etc/accessibility.env` on the VPS (loaded by the systemd unit — not `Environment=` with a password that contains `*` or `%`).
- Optional for SSL-required connections: **`DATABASE_SSL=true`**. With SSL on, the pool uses `rejectUnauthorized: true` and, if set, **`DATABASE_CA`** (path to a PEM file). Localhost Postgres does **not** need SSL.

When `DATABASE_URL` is set, the server creates `runs`, `leads`, `users`, `projects`, `plans`, `subscriptions`, `usage`, `payments`, `token_lots`, `consents`, and `stripe_events` tables. Duplicate Stripe webhook deliveries are ignored (`stripe_events` primary key). `payments.stripe_payment_intent_id` and `subscriptions.stripe_subscription_id` / `stripe_customer_id` are unique when set. Existing `reports/_saas/users.json` and `projects.json` are **inserted once** (`ON CONFLICT DO NOTHING`, never overwriting a DB `password_hash`) and then renamed to `*.imported`. Scan HTML/screenshots stay on disk under `reports/<domain>/<runId>/`.

If `DATABASE_URL` is not set, accounts fall back to those JSON files (fine for local tests; not safe for a campaign).

## Scan settings

All optional. Defaults suit a small VPS.

| Variable | Default | What it does |
| --- | --- | --- |
| `SCAN_MAX_CONCURRENT` | `3` | Scans (scanner processes) running at the same time. Others wait in the queue. |
| `URL_CONCURRENCY` | `1` (1 to 8) | Pages scanned in parallel inside one scan. |
| `MAX_URLS_PER_RUN` | unset | Cap on pages per staff scan. Unset means no cap. Customers are always capped at 50 pages per scan and guests at 1. |
| `PAGE_GOTO_TIMEOUT_MS` | `90000` (30000 to 300000) | How long a page may take to load. |
| `PAGE_SCAN_TIMEOUT_MS` | `240000` | Budget for one page: loading, axe and all custom checks. Never less than the load timeout plus one minute. A page over budget is recorded as a load failure and the scan continues. |
| `SCAN_PROCESS_TIMEOUT_MS` | pages ÷ `URL_CONCURRENCY` × page budget + 2 minutes | Wall-clock limit for a whole scan. The server stops a scanner that runs longer. |
| `SCAN_JOB_TTL_MS` | `86400000` (24 h) | Queued scans older than this are dropped and a customer's tokens are returned. |
| `WAIT_FOR_NETWORKIDLE` | `false` | Also wait (up to 7 s) for the network to go quiet after load. |
| `BLOCK_MEDIA_REQUESTS` | `true` | Skip video and audio downloads. |
| `ENABLE_CONTRAST_CHECKS` | `true` | Run the custom contrast check (axe's contrast rule always runs). |
| `AUTO_DISABLE_CONTRAST_ON_LARGE_DOM` | `true` | Skip the custom contrast check on very large pages. |
| `LARGE_DOM_THRESHOLD` | `6000` (1000 to 100000) | Number of elements above which a page counts as very large. |
| `SCANNER_NO_SANDBOX` | `false` | Start Chromium without its sandbox. Only for hosts that cannot run it otherwise. Leave unset on the VPS. |
| `PLAYWRIGHT_BROWSERS_PATH` | Playwright's default | Where Chromium is installed. |
| `REPORTS_BASE` | `./reports` | Where reports, the scan queue and the JSON stores live. |

## Mail

Without `SMTP_HOST` no mail is sent; the server logs that it skipped the message. Verification still works locally because `AUTH_EMAIL_VERIFY` defaults to `auto` outside production.

| Variable | What it does |
| --- | --- |
| `SMTP_HOST`, `SMTP_PORT` (default `587`), `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD` | Outgoing mail server. |
| `MAIL_FROM` | Sender address. Required in production. |
| `ACCESS_REQUEST_TO` | Where "talk to an expert" requests go. Default `info@about-us.be`. |

## Optional integrations

| Integration | Variables | Without it |
| --- | --- | --- |
| Cloudflare Turnstile (captcha on guest scans) | `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, `TURNSTILE_SEND_IP` | No captcha locally. Required in production. |
| Jira (create tickets from a report, staff only) | `ATLASSIAN_CLIENT_ID`, `ATLASSIAN_CLIENT_SECRET`, `ATLASSIAN_REDIRECT_URI` | The Jira buttons report "not connected". |
| Anthropic (written summary on the WCAG coverage page) | `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | The page shows a structured summary instead. |
| Stripe | See [billing.md](billing.md) | Checkout and the billing portal answer 503; the pricing page still works. |

## FTP storage (optional)

To persist the manual/assistive-tech checklist state on FTP, set these environment variables before starting the server:

| Variable | Description |
|----------|-------------|
| `FTP_HOST` | FTP host (e.g. `ftp.yourdomain.com`) |
| `FTP_USER` | FTP username |
| `FTP_PASSWORD` | FTP password |
| `FTP_SECURE` | FTPS (TLS). Default `true`. Production refuses plaintext FTP. |
| `FTP_REMOTE_PATH` | Optional. Base path on the server (e.g. `reports` or `accessibility/reports`) |

Progress is stored per run as `{FTP_REMOTE_PATH}/{domain}/{runId}/manual-progress.json` (and `runs.manual_progress_json` in Postgres). Domain-level `manual-progress.json` files are no longer written. Migrate leftovers with `node scripts/migrate-manual-progress.mjs --apply`. If FTP variables are not set, progress is stored only on the server’s local disk (and in the browser).

## Serving the UI and the API from different origins

Normal use is one origin, and nothing needs setting. If the pages are served from another host than the API, set `PUBLIC_APP_BASE` to the API origin (no trailing slash) at build time; the layout turns it into the `accessibility-app-base` meta tag the scripts read. For `astro dev`, `PUBLIC_DEV_API_URL` does the same and wins over `PUBLIC_APP_BASE`, and `RELAX_CORS_LOCALHOST=true` lets the API accept the dev origin.

## Monitoring endpoints

- `GET /api/health/db`: database health (`up`, `down` or `disabled`). **Staff only**: an unauthenticated request gets 401.
- `GET /api/report/:domain/:runId/urls`: the URLs stored for a run.
- `GET /api/audits/:domain/runs`: the runs of a domain the viewer may see.
