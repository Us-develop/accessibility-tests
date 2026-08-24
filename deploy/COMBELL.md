# Combell deployment (shared web hosting + Node.js)

This repo is a **single Node process**: Express API + Astro SSR (`web/run-server.mjs`). Combell expects root `[package.json](../package.json)` scripts `**build`** and `**serve`**.

References: [Combell — Getting started with Node.js](https://www.combell.com/en/help/kb/getting-started-with-node-js/)

## 1. Open a support ticket before going live

You must confirm hosting allows this workload:

**Copy/paste for Combell:**

> Our Node app runs accessibility audits using **Microsoft Playwright with headless Chromium** (`playwright install chromium`). The HTTP server `**spawn`s a child Node process** (`run-tests.js`) that launches Chromium against customer URLs (headless).
>
> Questions:
>
> 1. Is Playwright/Chromium automation supported inside your **Node.js add-on**, including **child processes** and enough **RAM/disk** for Chromium?
> 2. Which **Linux** image/distribution backs the Node instance (for native deps)?
> 3. Which directory paths are **writable persistently** for application data? Our app defaults to `./reports`; we can set `**REPORTS_BASE`** to a writable path you provide.

If Chromium or `spawn` is not allowed, use Combell **VPS** or another runtime where you control the OS (`playwright install --with-deps chromium`).

## 2. Repository and pipeline

1. Push this repository to GitHub/GitLab/Bitbucket (private is fine).
2. Combell: **My Products → Web hosting → Manage hosting → Node.js → Add instance**
3. Set **repository URL**, add Combell **deploy key** (read-only) to the Git remote.
4. Choose a **Node.js version** aligned with `"type": "module"` (Node 18+ recommended; match what you develop on).
5. **Run pipeline** after each push (or rely on CI trigger if configured).
6. **Websites & SSL → Manage website → Change website backend → Node.js** and select this instance.

**DNS:** Ensure the domain points at the hosting package ([Combell help](https://www.combell.com/en/help/kb/how-do-i-link-my-domain-name-to-my-hosting/)).

Pipeline typically runs `**npm install`** (`npm ci` if documented) then `**npm run build`**. This repo’s `**build`** installs `web/` dependencies, installs Chromium browsers, runs `astro build`. `**serve**` only starts the server (already built):

```bash
npm run serve
```

(equivalent: `node web/run-server.mjs` from repo root.)

## 3. Environment variables (control panel)

Set these in Combell’s environment configuration (names may vary by UI). Never commit secrets to Git.


| Variable                      | When / why                                                                                                                                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PORT`                        | Usually **injected** by host; defaults to `3456` only if unset. **If both the host sets `PORT` and you have local `web/.env`**, the host wins (`[server/load-env.mjs](../server/load-env.mjs)`). |
| `AUTH_COOKIE_SECURE`          | `**true**` when the site is served over HTTPS.                                                                                                                                                   |
| `APP_USERNAME`                | Optional login user (defaults exist).                                                                                                                                                            |
| `APP_PASSWORD`                | **Required** when `AUTH_ENABLED=true` (default). Strong secret in production.                                                                                                                    |
| `AUTH_ENABLED`                | `false` only for demos; enable in production.                                                                                                                                                    |
| `DATABASE_URL`                | Optional Postgres connection string for run persistence.                                                                                                                                         |
| `DATABASE_SSL`                | `true` if the DB requires TLS (often external managed Postgres).                                                                                                                                 |
| `REPORTS_BASE`                | Absolute path to a **writable** directory if `./reports` is not persistent on hosting.                                                                                                           |
| `SMTP_`* / `ACCESS_REQUEST_`* | Optional mail for access-request and teaser-scan leads (see `web/.env.example` and server code). |
| `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | Optional Cloudflare Turnstile for guest scans. If the secret is set, guests must pass captcha. |
| `GUEST_SCANS_PER_HOUR` / `GUEST_SCANS_PER_DAY` | Guest rate limits (defaults 3 / hour, 10 / day). |
| `SCAN_MAX_CONCURRENT` | Max simultaneous Playwright scans (default 3). |


Root and `web/` `**.env`** / `**.env.local`** files are merged at startup (`[server/load-env.mjs](../server/load-env.mjs)`); production should prefer host-managed env vars.

## 4. Post-deploy smoke test

After SSL and DNS work:

1. Open `https://your-domain/` (or HTTP if no SSL yet — then keep `AUTH_COOKIE_SECURE` aligned).
2. As a **guest** (logged out), run a **single-URL** snapshot against a trivial public page you control, then submit the WCAG services form.
3. Log in and run a full audit (sitemap/CSV still available). Confirm `/report/...` loads and `**REPORTS_BASE`** (or `./reports`) contains new artifact folders.

Failures at „Run audit“ with Chromium errors usually mean unsupported Playwright/OS on shared hosting; escalate with support or migrate to VPS.