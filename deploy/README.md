# Production deploy (OVH VPS + systemd + Caddy)

Single deploy story: **Node on the OVH VPS behind Caddy**, managed by **systemd**. There is no Docker, Render, or Combell path.

## Facts

- SSH: `debian@135.125.226.198`
- App path: `/srv/accessibility-tests`
- Git and npm user: `deploy` (`sudo -u deploy` / `sudo -H -u deploy`)
- Branch: **`development`**
- systemd unit: **`accessibility.service`** (this directory; not `accessibility-tests.service`)
- Reverse proxy: Caddy on 80/443 → `127.0.0.1:3000`. In production the app listens on loopback only, so it cannot be reached except through Caddy.
- Env file: `/etc/accessibility.env` (`chmod 600`)
- Never run `npm` as `debian` (EACCES on `node_modules`)
- Node.js **22.12 or newer** on the VPS (Astro 7 will not build or start on Node 20). Check with `node -v` before the first deploy after the Astro upgrade, and upgrade Node first if needed.
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

Create `/etc/accessibility.env` (`chmod 600`) with every production variable from the root [`.env.example`](../.env.example). At minimum: `PORT=3000`, `NODE_ENV=production` (also set by the unit), `SESSION_SECRET`, `APP_PASSWORD`, `MAIL_FROM`, `PUBLIC_BASE_URL=https://wcag.about-us.be`, company identity, Stripe keys, and **`DATABASE_URL`**. The process **exits at startup** when `NODE_ENV=production` and `DATABASE_URL` is unset (JSON-store fallback is not used in production).

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

## Applying a change to the unit or the Caddyfile

A `git pull` does not touch `/etc`. When `deploy/accessibility.service` or `deploy/Caddyfile` changes, copy it over and reload:

```bash
sudo cp /srv/accessibility-tests/deploy/accessibility.service /etc/systemd/system/accessibility.service
sudo systemctl daemon-reload
sudo systemctl restart accessibility.service

sudo cp /srv/accessibility-tests/deploy/Caddyfile /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile && sudo systemctl reload caddy
```

`sudo cp … /etc/caddy/Caddyfile` replaces the whole Caddy configuration. That is right while this is the only site on the machine.

### Before the first restart with the network rule

The unit's `IPAddressDeny=` line stops everything in the service, Chromium included, from connecting to private address ranges. If the machine's DNS resolver sits in one of those ranges, names stop resolving and every scan fails. Check first:

```bash
resolvectl status | grep -i 'dns server' || cat /etc/resolv.conf
```

- `127.0.0.53`, `127.0.0.1` or a public address (OVH's is `213.186.33.99`): fine.
- An address starting with `10.`, `172.16.` to `172.31.`, `192.168.` or `169.254.`: do not enable the rule as it is. Add that single address to the unit, on a line `IPAddressAllow=<address>` above `IPAddressDeny=`, then restart.

After the restart, run one scan of a public page and confirm it completes.

### If scans fail with "Executable doesn't exist"

The unit sets `ProtectHome=true`, which hides `/home`. Playwright installs Chromium under the user's home by default. If the service cannot find it, install it inside the app folder and tell the app where it is:

```bash
cd /srv/accessibility-tests
sudo -H -u deploy env PLAYWRIGHT_BROWSERS_PATH=/srv/accessibility-tests/.playwright npx playwright install chromium
echo 'PLAYWRIGHT_BROWSERS_PATH=/srv/accessibility-tests/.playwright' | sudo tee -a /etc/accessibility.env
sudo systemctl restart accessibility.service
```

## Monitoring

- **Is it up:** `GET https://wcag.about-us.be/api/health` answers `{"ok":true}` without a login. Point an uptime monitor at it.
- **Database:** see "Health and Postgres" below.
- **Restarts:** the unit restarts the app five seconds after any exit, for ever. `systemctl status accessibility.service` shows how often; `journalctl -u accessibility.service -n 100` shows why.

## Rolling back

```bash
cd /srv/accessibility-tests
sudo -u deploy git log --oneline -5              # find the last good commit
sudo -u deploy git checkout <commit>
sudo -H -u deploy npm ci && sudo -H -u deploy npm ci --prefix web   # only if a lockfile differs
sudo -H -u deploy npm run build --prefix web
sudo systemctl restart accessibility.service
```

Return to normal with `sudo -u deploy git checkout development`. The database schema only ever gains tables and columns, so an older version of the code runs against a newer database.

## Health and Postgres

```bash
sudo ss -lntp | grep -E '3000|MainThread'
sudo journalctl -u accessibility.service -n 20 --no-pager | grep -i postgres
```

Expect the line `Postgres persistence enabled (runs table ready).` in the journal. A bad password crash-loops the unit (`password authentication failed for user "wcag"`).

`/api/health/db` reports `{"ok":true,"db":"up"}`, but only to a signed-in staff user: open it in the browser after signing in at `/auth/staff`. A plain `curl` gets 401.

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

### Reports folder

`reports/` holds everything that is not in Postgres: scan results, the HTML reports and screenshots, reviewed marks, manual checklist progress, the scan queue, guest links and the encrypted Jira connection. Back it up too:

```bash
sudo mkdir -p /var/backups/wcag-reports
sudo tee /etc/cron.daily/wcag-reports-backup >/dev/null <<'EOF'
#!/bin/sh
set -e
umask 077
FILE=/var/backups/wcag-reports/reports-$(date +%F).tar.gz
tar -czf "$FILE" -C /srv/accessibility-tests reports
find /var/backups/wcag-reports -name 'reports-*.tar.gz' -mtime +14 -delete
EOF
sudo chmod +x /etc/cron.daily/wcag-reports-backup
```

Screenshots make this folder grow; check `du -sh /srv/accessibility-tests/reports` and the free disk space now and then.

### Keep a copy somewhere else

Both backups above are on the same disk as the data. A disk failure or a deleted VPS takes them all. Copy `/var/backups/wcag-pg` and `/var/backups/wcag-reports` to another place every day: OVH Object Storage or another S3-compatible bucket with `rclone`, or a second machine with `rsync`. This is not set up yet.

### Restoring

```bash
# Database, into an empty database
gunzip -c /var/backups/wcag-pg/wcag-YYYY-MM-DD.sql.gz | sudo -u postgres psql wcag

# Reports
sudo systemctl stop accessibility.service
sudo -u deploy tar -xzf /var/backups/wcag-reports/reports-YYYY-MM-DD.tar.gz -C /srv/accessibility-tests
sudo systemctl start accessibility.service
```

Try a restore once before go-live. A backup that has never been restored is a guess.

RAM: watch **MemAvailable**, not “used %”. Chromium scans are the risk. Alert when available memory is under ~400 MB (cron + the same `SMTP_*` the app uses). OVH ping checks do not warn about RAM.

Before the first accounts publish, set **`SESSION_SECRET`** (≥32 random characters), **`APP_PASSWORD`** (≥12 characters), **`MAIL_FROM`** (not `@localhost`), and **`PUBLIC_BASE_URL=https://wcag.about-us.be`**. Staff login still uses **`APP_USERNAME` / `APP_PASSWORD`**.

The app **must** be served by Node — the UI is rendered by the Astro shell at `web/` and is built with `npm run build --prefix web`. Static hosting alone is not enough (`/api/run`, `/api/status/:domain/:runId`, reports).
