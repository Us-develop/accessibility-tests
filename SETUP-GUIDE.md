# Setup guide — run locally first

Use this checklist on your machine. **No cloud host (Render or otherwise) is required.**

Full detail lives in [README.md](README.md).

---

## Prerequisites

- **Node.js** 18 or newer (`node -v`)
- **npm**

---

## Steps

### 1. Install JavaScript dependencies

```bash
cd accessibility-tests
npm install
```

### 2. Install Chromium for Playwright (~250 MB)

```bash
npx playwright install chromium
```

### 3. Start the server (pick one auth mode)

The server requires either a password **or** disabled auth.

**Easiest for local development** (no login screen):

```bash
AUTH_ENABLED=false npm start
```

**Or** keep login and set your own password and session secret (both required when `AUTH_ENABLED` is true):

```bash
APP_PASSWORD='choose-a-password' SESSION_SECRET='at-least-32-characters-long-secret' npm start
```

If `AUTH_ENABLED` is true (the default) and `APP_PASSWORD` is shorter than 12 characters or `SESSION_SECRET` is shorter than 32 characters, the server exits immediately — that is intentional.

### 4. Open the app

In your browser go to:

**[http://localhost:3456](http://localhost:3456)**

(Use another port only if you set `PORT` in the environment.)

### 5. Run a test

- Paste one or more URLs (same guidelines as in README: typically **one domain** per run).
- Submit the form and wait for the report.

Reports are written under `reports/` and are also served under `/report/...` while the server runs.

---

## CLI only (no web UI)

```bash
npm run test:report
```

(URL list in `urls.config.js`), or:

```bash
node run-tests.js --report --urls="https://example.com"
```

---

## Troubleshooting


| Issue                                 | What to try                                                                                                          |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Playwright “executable doesn’t exist” | Run `npx playwright install chromium` again                                                                          |
| Server exits on start                 | Set `APP_PASSWORD` (≥12 chars) and `SESSION_SECRET` (≥32 chars), or `AUTH_ENABLED=false`                              |
| Form says API missing JSON            | Ensure `npm start` is running and you did **not** open `index.html` as a `file://` URL — use `http://localhost:3456` |


---

## Production / hosted deploy

Do this **later** when you have a Node-capable host (VPS, Combell Node, etc.): install deps, install Chromium on the server, set `APP_PASSWORD`, `PORT`, optional `DATABASE_URL`. If the browser UI is served from a **different origin** than the API, configure `<meta name="accessibility-app-base" ...>` as described in [README.md](README.md).