# Production deploy (OVH VPS + systemd + Caddy)

Single deploy story: **Node on the OVH VPS behind Caddy**, managed by **systemd**. There is no Docker, Render, or Combell path.

## Facts

- SSH: `debian@135.125.226.198`
- App path: `/srv/accessibility-tests`
- Git and npm user: `deploy` (`sudo -u deploy` / `sudo -H -u deploy`)
- Branch: **`development`**
- systemd unit: **`accessibility.service`** (this directory; not `accessibility-tests.service`)
- Reverse proxy: Caddy on 80/443 → `localhost:3000`
- Env file: `/etc/accessibility.env` (`chmod 600`)
- Never run `npm` as `debian` (EACCES on `node_modules`)
- Never `pm2`

The Node process listens on **port 3000**. Set `PORT=3000` in `/etc/accessibility.env`. Caddy serves 80/443. In `ss` the process name is **`MainThread`**, not `node`, so `grep node` is empty even when the app is healthy.

## First-time install

As `debian` on the VPS, after the repo is cloned to `/srv/accessibility-tests` and owned by `deploy`:

```bash
sudo cp /srv/accessibility-tests/deploy/accessibility.service /etc/systemd/system/accessibility.service
sudo cp /srv/accessibility-tests/deploy/Caddyfile /etc/caddy/Caddyfile
sudo systemctl daemon-reload
sudo systemctl enable accessibility.service
```

Create `/etc/accessibility.env` (`chmod 600`) with every production variable from the root [`.env.example`](../.env.example). At minimum: `PORT=3000`, `NODE_ENV=production` (also set by the unit), `SESSION_SECRET`, `APP_PASSWORD`, `MAIL_FROM`, `PUBLIC_BASE_URL=https://wcag.about-us.be`, company identity, Stripe keys, and **`DATABASE_URL`**. The process **exits at startup** when `NODE_ENV=production` and `DATABASE_URL` is unset (JSON-store fallback is not used in production). Set `BREVO_API_KEY` and the `BREVO_TEMPLATE_*` ids for transactional mail; `SMTP_*` can be removed once Brevo templates cover every kind.

If a drop-in still loads `/etc/accessibility-db.env`, merge those values into `/etc/accessibility.env` and remove the drop-in so there is one file.

```bash
sudo -H -u deploy npm ci
sudo -H -u deploy npm ci --prefix web
sudo -u deploy npx playwright install chromium
sudo -H -u deploy npm run build --prefix web
sudo systemctl restart accessibility.service
sudo systemctl reload caddy
```

## Publish / update (after merge to `development`)

Log in as **`debian`**, then run git, `npm`, and the Astro build as **`deploy`**.

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

## Health and Postgres

```bash
sudo ss -lntp | grep -E '3000|MainThread'
sudo journalctl -u accessibility.service -n 20 --no-pager | grep -i postgres
curl -sS http://127.0.0.1:3000/api/health/db
```

Expect `{"ok":true,"db":"up"}` when Postgres is wired. `db: "disabled"` means `DATABASE_URL` is not loaded. A bad password crash-loops the unit (`password authentication failed for user "wcag"`).

`DATABASE_URL` must be an env file, not a systemd `Environment=` line (passwords with `*` or `%` break `Environment=`):

```
# /etc/accessibility.env (chmod 600)
PORT=3000
DATABASE_URL=postgresql://wcag:HEXPASSWORD@127.0.0.1:5432/wcag
```

Test the role without a URI (special characters in passwords break URLs):

```bash
PGPASSWORD='HEXPASSWORD' psql -h 127.0.0.1 -U wcag -d wcag -c 'SELECT 1;'
```

Browse tables: `sudo -u postgres psql -d wcag` then `\dt` and `\d users`. From a laptop, Beekeeper Studio → PostgreSQL, SSH tunnel to `debian@135.125.226.198`, host `127.0.0.1`, port `5432`, database `wcag`, user `wcag`, SSL off.

Daily dump:

```bash
sudo mkdir -p /var/backups/wcag-pg
sudo chown postgres:postgres /var/backups/wcag-pg
sudo tee /etc/cron.daily/wcag-pg-dump >/dev/null <<'EOF'
#!/bin/sh
set -e
umask 077
FILE=/var/backups/wcag-pg/wcag-$(date +%F).sql.gz
sudo -u postgres pg_dump wcag | gzip > "$FILE"
find /var/backups/wcag-pg -name 'wcag-*.sql.gz' -mtime +14 -delete
EOF
sudo chmod +x /etc/cron.daily/wcag-pg-dump
```

RAM: watch **MemAvailable**, not “used %”. Chromium scans are the risk. Alert when available memory is under ~400 MB (cron + the same `SMTP_*` the app uses). OVH ping checks do not warn about RAM.

Before the first accounts publish, set **`SESSION_SECRET`** (≥32 random characters), **`APP_PASSWORD`** (≥12 characters), **`MAIL_FROM`** (not `@localhost`), and **`PUBLIC_BASE_URL=https://wcag.about-us.be`**. Staff login still uses **`APP_USERNAME` / `APP_PASSWORD`**.

The app **must** be served by Node — the UI is rendered by the Astro shell at `web/` and is built with `npm run build --prefix web`. Static hosting alone is not enough (`/api/run`, `/api/status/:domain/:runId`, reports).
