import pg from 'pg';

const { Pool } = pg;

function parseBooleanEnv(name, defaultValue = false) {
  const raw = process.env[name];
  if (raw == null) return defaultValue;
  const value = String(raw).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(value)) return true;
  if (['0', 'false', 'no', 'off'].includes(value)) return false;
  return defaultValue;
}

const DATABASE_URL = process.env.DATABASE_URL || '';
const DB_SSL = parseBooleanEnv('DATABASE_SSL', false);

export const dbPool = DATABASE_URL
  ? new Pool({
      connectionString: DATABASE_URL,
      ssl: DB_SSL ? { rejectUnauthorized: false } : undefined,
    })
  : null;

/**
 * Schema: one row per (domain, run_id). We migrate from the legacy single-row-per-domain
 * shape (PRIMARY KEY id) to a composite key while keeping the original `id` column for
 * back-compat. After migration `id` is treated as the domain.
 */
export async function initDb() {
  if (!dbPool) return;
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT NOT NULL,
      run_id TEXT,
      status TEXT NOT NULL,
      urls INTEGER,
      processed_urls INTEGER,
      requested_urls INTEGER,
      truncated BOOLEAN DEFAULT FALSE,
      error TEXT,
      notify_requested BOOLEAN DEFAULT FALSE,
      notify_email TEXT,
      statement_meta_json JSONB,
      result_json JSONB,
      manual_progress_json JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  // Add run_id if upgrading an existing legacy table.
  await dbPool.query(`ALTER TABLE runs ADD COLUMN IF NOT EXISTS run_id TEXT`);
  // Drop the old primary key (id) if it still exists.
  await dbPool.query(`
    DO $$ BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'runs_pkey'
      ) THEN
        ALTER TABLE runs DROP CONSTRAINT runs_pkey;
      END IF;
    END $$;
  `);
  // Back-fill run_id for legacy rows so the unique key is satisfiable.
  await dbPool.query(`
    UPDATE runs
    SET run_id = COALESCE(
      run_id,
      to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24-MI-SS"Z"') || '-' || substr(md5(id || updated_at::text), 1, 4)
    )
    WHERE run_id IS NULL
  `);
  await dbPool.query(`ALTER TABLE runs ALTER COLUMN run_id SET NOT NULL`);
  await dbPool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'runs_domain_run_pkey'
      ) THEN
        ALTER TABLE runs ADD CONSTRAINT runs_domain_run_pkey PRIMARY KEY (id, run_id);
      END IF;
    END $$;
  `);
  await dbPool.query(
    `CREATE INDEX IF NOT EXISTS runs_id_updated_idx ON runs (id, updated_at DESC)`
  );
  await dbPool.query(`ALTER TABLE runs ADD COLUMN IF NOT EXISTS tier TEXT`);
  await dbPool.query(`ALTER TABLE runs ADD COLUMN IF NOT EXISTS guest_token TEXT`);
  await dbPool.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS runs_guest_token_uidx ON runs (guest_token) WHERE guest_token IS NOT NULL`
  );
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS leads (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      company TEXT,
      email TEXT NOT NULL,
      phone TEXT,
      message TEXT,
      scanned_url TEXT,
      domain TEXT,
      run_token TEXT,
      score INTEGER,
      source TEXT,
      cta TEXT,
      emailed BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await dbPool.query(`CREATE INDEX IF NOT EXISTS leads_created_idx ON leads (created_at DESC)`);
}

/**
 * Upsert one run. domain + runId together are the primary key.
 * Legacy callers that only pass `id` (the domain) still work via dbUpsertLegacy.
 */
export async function dbUpsertRun(domain, runId, patch = {}) {
  if (!dbPool || !domain || !runId) return;
  const status = patch.status || 'running';
  await dbPool.query(
    `
      INSERT INTO runs (
        id, run_id, status, urls, processed_urls, requested_urls, truncated, error,
        notify_requested, notify_email, statement_meta_json, result_json, manual_progress_json,
        tier, guest_token
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9, $10, $11::jsonb, $12::jsonb, $13::jsonb,
        $14, $15
      )
      ON CONFLICT (id, run_id) DO UPDATE SET
        status = COALESCE(EXCLUDED.status, runs.status),
        urls = COALESCE(EXCLUDED.urls, runs.urls),
        processed_urls = COALESCE(EXCLUDED.processed_urls, runs.processed_urls),
        requested_urls = COALESCE(EXCLUDED.requested_urls, runs.requested_urls),
        truncated = COALESCE(EXCLUDED.truncated, runs.truncated),
        error = COALESCE(EXCLUDED.error, runs.error),
        notify_requested = COALESCE(EXCLUDED.notify_requested, runs.notify_requested),
        notify_email = COALESCE(EXCLUDED.notify_email, runs.notify_email),
        statement_meta_json = COALESCE(EXCLUDED.statement_meta_json, runs.statement_meta_json),
        result_json = COALESCE(EXCLUDED.result_json, runs.result_json),
        manual_progress_json = COALESCE(EXCLUDED.manual_progress_json, runs.manual_progress_json),
        tier = COALESCE(EXCLUDED.tier, runs.tier),
        guest_token = COALESCE(EXCLUDED.guest_token, runs.guest_token),
        updated_at = NOW()
    `,
    [
      domain,
      runId,
      status,
      patch.urls ?? null,
      patch.processedUrls ?? null,
      patch.requestedUrls ?? null,
      patch.truncated ?? null,
      patch.error ?? null,
      patch.notifyRequested ?? null,
      patch.notifyEmail ?? null,
      patch.statementMeta ? JSON.stringify(patch.statementMeta) : null,
      patch.resultJson ? JSON.stringify(patch.resultJson) : null,
      patch.manualProgress ? JSON.stringify(patch.manualProgress) : null,
      patch.tier ?? null,
      patch.guestToken ?? null,
    ]
  );
}

function mapRunRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    domain: row.id,
    runId: row.run_id,
    status: row.status,
    urls: row.urls ?? 0,
    processedUrls: row.processed_urls ?? row.urls ?? 0,
    requestedUrls: row.requested_urls ?? row.urls ?? 0,
    truncated: !!row.truncated,
    error: row.error || null,
    notifyRequested: !!row.notify_requested,
    notifyEmail: row.notify_email || null,
    resultJson: row.result_json || null,
    manualProgress: row.manual_progress_json || null,
    updatedAt: row.updated_at || null,
    tier: row.tier || null,
    guestToken: row.guest_token || null,
  };
}

/** Fetch one specific run. */
export async function dbGetRun(domain, runId) {
  if (!dbPool || !domain || !runId) return null;
  const { rows } = await dbPool.query(
    `SELECT id, run_id, status, urls, processed_urls, requested_urls, truncated, error,
            notify_requested, notify_email, result_json, manual_progress_json, updated_at,
            tier, guest_token
       FROM runs WHERE id = $1 AND run_id = $2 LIMIT 1`,
    [domain, runId]
  );
  return mapRunRow(rows[0]);
}

/** Fetch the latest run for a domain (by updated_at). */
export async function dbGetLatestRun(domain) {
  if (!dbPool || !domain) return null;
  const { rows } = await dbPool.query(
    `SELECT id, run_id, status, urls, processed_urls, requested_urls, truncated, error,
            notify_requested, notify_email, result_json, manual_progress_json, updated_at,
            tier, guest_token
       FROM runs
      WHERE id = $1
      ORDER BY updated_at DESC
      LIMIT 1`,
    [domain]
  );
  return mapRunRow(rows[0]);
}

/** List all runs for a domain newest first. */
export async function dbListRunsForDomain(domain, limit = 100) {
  if (!dbPool || !domain) return [];
  const { rows } = await dbPool.query(
    `SELECT id, run_id, status, urls, processed_urls, requested_urls, truncated, error,
            notify_requested, notify_email, result_json, manual_progress_json, updated_at,
            tier, guest_token
       FROM runs
      WHERE id = $1
      ORDER BY updated_at DESC
      LIMIT $2`,
    [domain, limit]
  );
  return rows.map(mapRunRow);
}

/** Look up a guest teaser run by unguessable token. */
export async function dbGetRunByGuestToken(token) {
  if (!dbPool || !token) return null;
  const { rows } = await dbPool.query(
    `SELECT id, run_id, status, urls, processed_urls, requested_urls, truncated, error,
            notify_requested, notify_email, result_json, manual_progress_json, updated_at,
            tier, guest_token
       FROM runs WHERE guest_token = $1 LIMIT 1`,
    [token]
  );
  return mapRunRow(rows[0]);
}

function mapLeadRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    company: row.company || '',
    email: row.email,
    phone: row.phone || '',
    message: row.message || '',
    scannedUrl: row.scanned_url || '',
    domain: row.domain || '',
    runToken: row.run_token || '',
    score: row.score == null ? null : Number(row.score),
    source: row.source || '',
    cta: row.cta || '',
    emailed: !!row.emailed,
    createdAt: row.created_at || null,
  };
}

export async function dbInsertLead(row) {
  if (!dbPool) return null;
  const { rows } = await dbPool.query(
    `INSERT INTO leads (
       name, company, email, phone, message, scanned_url, domain, run_token, score, source, cta, emailed
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING id, name, company, email, phone, message, scanned_url, domain, run_token, score, source, cta, emailed, created_at`,
    [
      row.name,
      row.company || '',
      row.email,
      row.phone || '',
      row.message || '',
      row.scannedUrl || '',
      row.domain || '',
      row.runToken || '',
      row.score ?? null,
      row.source || 'scan-teaser',
      row.cta || 'wcag-services',
      !!row.emailed,
    ]
  );
  return mapLeadRow(rows[0]);
}

export async function dbListLeads(limit = 200) {
  if (!dbPool) return [];
  const { rows } = await dbPool.query(
    `SELECT id, name, company, email, phone, message, scanned_url, domain, run_token, score, source, cta, emailed, created_at
       FROM leads
      ORDER BY created_at DESC
      LIMIT $1`,
    [limit]
  );
  return rows.map(mapLeadRow);
}

