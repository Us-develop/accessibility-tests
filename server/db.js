import pg from 'pg';
import { readJsonStore } from './json-store.mjs';
import { DEFAULT_PLANS } from './plan-catalog.mjs';

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

  await dbPool.query(`ALTER TABLE runs ADD COLUMN IF NOT EXISTS user_id TEXT`);
  await dbPool.query(
    `CREATE INDEX IF NOT EXISTS runs_user_created_idx ON runs (user_id, created_at DESC)`
  );

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT,
      role TEXT NOT NULL DEFAULT 'customer',
      password_hash TEXT NOT NULL,
      email_verified BOOLEAN DEFAULT FALSE,
      verify_token TEXT,
      verify_expires_at TIMESTAMPTZ,
      reset_token TEXT,
      reset_expires_at TIMESTAMPTZ,
      phone TEXT,
      company TEXT,
      vat_number TEXT,
      address_line1 TEXT,
      address_line2 TEXT,
      city TEXT,
      postal_code TEXT,
      country TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await dbPool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT`);
  await dbPool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS company TEXT`);
  await dbPool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS vat_number TEXT`);
  await dbPool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS address_line1 TEXT`);
  await dbPool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS address_line2 TEXT`);
  await dbPool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS city TEXT`);
  await dbPool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS postal_code TEXT`);
  await dbPool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS country TEXT`);

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS plans (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      max_pages_per_scan INT,
      max_scans_per_month INT,
      max_pages_per_month INT,
      max_projects INT,
      features JSONB,
      price_cents INT,
      yearly_price_cents INT,
      billing_interval TEXT,
      active BOOLEAN DEFAULT TRUE
    )
  `);
  await dbPool.query(`ALTER TABLE plans ADD COLUMN IF NOT EXISTS max_pages_per_month INT`);
  await dbPool.query(`ALTER TABLE plans ADD COLUMN IF NOT EXISTS yearly_price_cents INT`);
  await dbPool.query(`ALTER TABLE plans ADD COLUMN IF NOT EXISTS billing_interval TEXT`);

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      domain TEXT NOT NULL,
      name TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, domain)
    )
  `);
  await dbPool.query(`CREATE INDEX IF NOT EXISTS projects_user_idx ON projects (user_id)`);

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      plan_id TEXT NOT NULL REFERENCES plans(id),
      status TEXT NOT NULL,
      current_period_start TIMESTAMPTZ,
      current_period_end TIMESTAMPTZ,
      stripe_subscription_id TEXT,
      stripe_customer_id TEXT,
      cancel_at_period_end BOOLEAN DEFAULT FALSE,
      billing_interval TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await dbPool.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_user_uidx ON subscriptions (user_id)`
  );
  await dbPool.query(
    `ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN DEFAULT FALSE`
  );
  await dbPool.query(`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS billing_interval TEXT`);

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS usage (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      period TEXT NOT NULL,
      scans_used INT DEFAULT 0,
      pages_scanned INT DEFAULT 0,
      UNIQUE (user_id, period)
    )
  `);

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      amount_cents INT NOT NULL,
      currency TEXT DEFAULT 'eur',
      status TEXT,
      description TEXT,
      stripe_payment_intent_id TEXT,
      invoice_url TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await dbPool.query(
    `CREATE INDEX IF NOT EXISTS payments_user_created_idx ON payments (user_id, created_at DESC)`
  );

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS token_lots (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      pack_id TEXT,
      tokens_granted INT NOT NULL,
      tokens_remaining INT NOT NULL,
      purchased_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      stripe_checkout_session_id TEXT,
      stripe_payment_intent_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await dbPool.query(`CREATE INDEX IF NOT EXISTS token_lots_user_exp_idx ON token_lots (user_id, expires_at)`);
  await dbPool.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS token_lots_checkout_uidx
       ON token_lots (stripe_checkout_session_id)
     WHERE stripe_checkout_session_id IS NOT NULL`
  );

  await seedDefaultPlans();
  await migrateJsonStoresToPostgres();
  await backfillRunUserIds();
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
        tier, guest_token, user_id
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9, $10, $11::jsonb, $12::jsonb, $13::jsonb,
        $14, $15, $16
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
        user_id = COALESCE(EXCLUDED.user_id, runs.user_id),
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
      patch.userId ?? null,
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
    userId: row.user_id || null,
  };
}

/** Fetch one specific run. */
export async function dbGetRun(domain, runId) {
  if (!dbPool || !domain || !runId) return null;
  const { rows } = await dbPool.query(
    `SELECT id, run_id, status, urls, processed_urls, requested_urls, truncated, error,
            notify_requested, notify_email, result_json, manual_progress_json, updated_at,
            tier, guest_token, user_id
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
            tier, guest_token, user_id
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
            tier, guest_token, user_id
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
            tier, guest_token, user_id
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

function isoOrNull(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function mapUserRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.name || '',
    role: row.role || 'customer',
    passwordHash: row.password_hash,
    emailVerified: !!row.email_verified,
    verifyToken: row.verify_token || null,
    verifyExpiresAt: isoOrNull(row.verify_expires_at),
    resetToken: row.reset_token || null,
    resetExpiresAt: isoOrNull(row.reset_expires_at),
    phone: row.phone || '',
    company: row.company || '',
    vatNumber: row.vat_number || '',
    addressLine1: row.address_line1 || '',
    addressLine2: row.address_line2 || '',
    city: row.city || '',
    postalCode: row.postal_code || '',
    country: row.country || '',
    createdAt: isoOrNull(row.created_at),
    updatedAt: isoOrNull(row.updated_at),
  };
}

const USER_COLUMNS = `id, email, name, role, password_hash, email_verified, verify_token, verify_expires_at,
            reset_token, reset_expires_at, phone, company, vat_number, address_line1, address_line2,
            city, postal_code, country, created_at, updated_at`;

export async function dbGetUserById(id) {
  if (!dbPool || !id) return null;
  const { rows } = await dbPool.query(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1 LIMIT 1`, [id]);
  return mapUserRow(rows[0]);
}

export async function dbGetUserByEmail(email) {
  if (!dbPool || !email) return null;
  const needle = String(email).trim().toLowerCase();
  const { rows } = await dbPool.query(`SELECT ${USER_COLUMNS} FROM users WHERE email = $1 LIMIT 1`, [needle]);
  return mapUserRow(rows[0]);
}

export async function dbUpsertUser(user) {
  if (!dbPool || !user?.id) return null;
  const { rows } = await dbPool.query(
    `
      INSERT INTO users (
        id, email, name, role, password_hash, email_verified, verify_token, verify_expires_at,
        reset_token, reset_expires_at, phone, company, vat_number, address_line1, address_line2,
        city, postal_code, country, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9, $10, $11, $12, $13, $14, $15,
        $16, $17, $18, COALESCE($19::timestamptz, NOW()), NOW()
      )
      ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        name = EXCLUDED.name,
        role = EXCLUDED.role,
        password_hash = EXCLUDED.password_hash,
        email_verified = EXCLUDED.email_verified,
        verify_token = EXCLUDED.verify_token,
        verify_expires_at = EXCLUDED.verify_expires_at,
        reset_token = EXCLUDED.reset_token,
        reset_expires_at = EXCLUDED.reset_expires_at,
        phone = EXCLUDED.phone,
        company = EXCLUDED.company,
        vat_number = EXCLUDED.vat_number,
        address_line1 = EXCLUDED.address_line1,
        address_line2 = EXCLUDED.address_line2,
        city = EXCLUDED.city,
        postal_code = EXCLUDED.postal_code,
        country = EXCLUDED.country,
        updated_at = NOW()
      RETURNING ${USER_COLUMNS}
    `,
    [
      user.id,
      String(user.email || '').trim().toLowerCase(),
      user.name || '',
      user.role || 'customer',
      user.passwordHash,
      user.emailVerified === true,
      user.verifyToken || null,
      user.verifyExpiresAt || null,
      user.resetToken || null,
      user.resetExpiresAt || null,
      user.phone || '',
      user.company || '',
      user.vatNumber || '',
      user.addressLine1 || '',
      user.addressLine2 || '',
      user.city || '',
      user.postalCode || '',
      user.country || '',
      user.createdAt || null,
    ]
  );
  return mapUserRow(rows[0]);
}

export async function dbDeleteUser(id) {
  if (!dbPool || !id) return;
  await dbPool.query(`DELETE FROM users WHERE id = $1`, [id]);
}

function mapProjectRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    domain: row.domain,
    name: row.name || row.domain,
    runIds: Array.isArray(row.run_ids) ? row.run_ids : [],
    createdAt: isoOrNull(row.created_at),
    updatedAt: isoOrNull(row.updated_at),
  };
}

export async function dbUpsertProject(project) {
  if (!dbPool || !project?.id || !project.userId || !project.domain) return null;
  const { rows } = await dbPool.query(
    `
      INSERT INTO projects (id, user_id, domain, name, created_at, updated_at)
      VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, NOW()), NOW())
      ON CONFLICT (user_id, domain) DO UPDATE SET
        name = COALESCE(EXCLUDED.name, projects.name),
        updated_at = NOW()
      RETURNING id, user_id, domain, name, created_at, updated_at
    `,
    [
      project.id,
      project.userId,
      String(project.domain).toLowerCase(),
      project.name || project.domain,
      project.createdAt || null,
    ]
  );
  const mapped = mapProjectRow(rows[0]);
  if (mapped) mapped.runIds = Array.isArray(project.runIds) ? project.runIds : [];
  return mapped;
}

export async function dbListProjectsForUser(userId) {
  if (!dbPool || !userId) return [];
  const { rows } = await dbPool.query(
    `SELECT id, user_id, domain, name, created_at, updated_at FROM projects WHERE user_id = $1 ORDER BY updated_at DESC`,
    [userId]
  );
  const projects = rows.map(mapProjectRow);
  const runRows = await dbPool.query(
    `SELECT id AS domain, run_id FROM runs WHERE user_id = $1 ORDER BY updated_at DESC`,
    [userId]
  );
  const byDomain = new Map();
  for (const row of runRows.rows) {
    if (!byDomain.has(row.domain)) byDomain.set(row.domain, []);
    byDomain.get(row.domain).push(row.run_id);
  }
  return projects.map((p) => ({ ...p, runIds: byDomain.get(p.domain) || p.runIds || [] }));
}

export async function dbFindProjectByDomain(userId, domain) {
  if (!dbPool || !userId || !domain) return null;
  const { rows } = await dbPool.query(
    `SELECT id, user_id, domain, name, created_at, updated_at FROM projects WHERE user_id = $1 AND domain = $2 LIMIT 1`,
    [userId, String(domain).toLowerCase()]
  );
  const project = mapProjectRow(rows[0]);
  if (!project) return null;
  const runRows = await dbPool.query(
    `SELECT run_id FROM runs WHERE user_id = $1 AND id = $2 ORDER BY updated_at DESC`,
    [userId, project.domain]
  );
  project.runIds = runRows.rows.map((r) => r.run_id);
  return project;
}

export async function dbGetProject(id) {
  if (!dbPool || !id) return null;
  const { rows } = await dbPool.query(
    `SELECT id, user_id, domain, name, created_at, updated_at FROM projects WHERE id = $1 LIMIT 1`,
    [id]
  );
  return mapProjectRow(rows[0]);
}

export async function dbDeleteProjectsForUser(userId) {
  if (!dbPool || !userId) return;
  await dbPool.query(`DELETE FROM projects WHERE user_id = $1`, [userId]);
}

export async function dbSetRunUserId(domain, runId, userId) {
  if (!dbPool || !domain || !runId || !userId) return;
  await dbPool.query(
    `UPDATE runs SET user_id = $3 WHERE id = $1 AND run_id = $2 AND user_id IS NULL`,
    [domain, runId, userId]
  );
}

const PLAN_SELECT = `id, name, max_pages_per_scan, max_scans_per_month, max_pages_per_month, max_projects, features, price_cents, yearly_price_cents, billing_interval, active`;
const SUB_SELECT = `id, user_id, plan_id, status, current_period_start, current_period_end,
            stripe_subscription_id, stripe_customer_id, cancel_at_period_end, billing_interval, created_at, updated_at`;

function mapPlanRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    maxPagesPerScan: row.max_pages_per_scan == null ? null : Number(row.max_pages_per_scan),
    maxScansPerMonth: row.max_scans_per_month == null ? null : Number(row.max_scans_per_month),
    maxPagesPerMonth: row.max_pages_per_month == null ? null : Number(row.max_pages_per_month),
    maxProjects: row.max_projects == null ? null : Number(row.max_projects),
    features: row.features && typeof row.features === 'object' ? row.features : {},
    priceCents: row.price_cents == null ? 0 : Number(row.price_cents),
    yearlyPriceCents: row.yearly_price_cents == null ? 0 : Number(row.yearly_price_cents),
    billingInterval: row.billing_interval || null,
    active: row.active !== false,
  };
}

export async function dbGetPlan(id) {
  if (!dbPool || !id) return null;
  const { rows } = await dbPool.query(`SELECT ${PLAN_SELECT} FROM plans WHERE id = $1 LIMIT 1`, [id]);
  return mapPlanRow(rows[0]);
}

export async function dbListPlans() {
  if (!dbPool) return [];
  const { rows } = await dbPool.query(
    `SELECT ${PLAN_SELECT} FROM plans WHERE active = TRUE ORDER BY price_cents ASC`
  );
  return rows.map(mapPlanRow);
}

export async function dbUpsertPlan(plan) {
  if (!dbPool || !plan?.id) return null;
  const { rows } = await dbPool.query(
    `
      INSERT INTO plans (
        id, name, max_pages_per_scan, max_scans_per_month, max_pages_per_month, max_projects, features,
        price_cents, yearly_price_cents, billing_interval, active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        max_pages_per_scan = EXCLUDED.max_pages_per_scan,
        max_scans_per_month = EXCLUDED.max_scans_per_month,
        max_pages_per_month = EXCLUDED.max_pages_per_month,
        max_projects = EXCLUDED.max_projects,
        features = EXCLUDED.features,
        price_cents = EXCLUDED.price_cents,
        yearly_price_cents = EXCLUDED.yearly_price_cents,
        billing_interval = EXCLUDED.billing_interval,
        active = EXCLUDED.active
      RETURNING ${PLAN_SELECT}
    `,
    [
      plan.id,
      plan.name,
      plan.maxPagesPerScan,
      plan.maxScansPerMonth,
      plan.maxPagesPerMonth,
      plan.maxProjects,
      JSON.stringify(plan.features || {}),
      plan.priceCents ?? 0,
      plan.yearlyPriceCents ?? 0,
      plan.billingInterval || null,
      plan.active !== false,
    ]
  );
  return mapPlanRow(rows[0]);
}

function mapSubscriptionRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    planId: row.plan_id,
    status: row.status,
    currentPeriodStart: isoOrNull(row.current_period_start),
    currentPeriodEnd: isoOrNull(row.current_period_end),
    stripeSubscriptionId: row.stripe_subscription_id || null,
    stripeCustomerId: row.stripe_customer_id || null,
    cancelAtPeriodEnd: Boolean(row.cancel_at_period_end),
    billingInterval: row.billing_interval || null,
    createdAt: isoOrNull(row.created_at),
    updatedAt: isoOrNull(row.updated_at),
  };
}

export async function dbGetSubscription(userId) {
  if (!dbPool || !userId) return null;
  const { rows } = await dbPool.query(`SELECT ${SUB_SELECT} FROM subscriptions WHERE user_id = $1 LIMIT 1`, [
    userId,
  ]);
  return mapSubscriptionRow(rows[0]);
}

export async function dbGetSubscriptionByStripeCustomer(customerId) {
  if (!dbPool || !customerId) return null;
  const { rows } = await dbPool.query(
    `SELECT ${SUB_SELECT} FROM subscriptions WHERE stripe_customer_id = $1 LIMIT 1`,
    [customerId]
  );
  return mapSubscriptionRow(rows[0]);
}

export async function dbGetSubscriptionByStripeSubscription(subscriptionId) {
  if (!dbPool || !subscriptionId) return null;
  const { rows } = await dbPool.query(
    `SELECT ${SUB_SELECT} FROM subscriptions WHERE stripe_subscription_id = $1 LIMIT 1`,
    [subscriptionId]
  );
  return mapSubscriptionRow(rows[0]);
}

export async function dbUpsertSubscription(sub) {
  if (!dbPool || !sub?.id || !sub.userId) return null;
  const { rows } = await dbPool.query(
    `
      INSERT INTO subscriptions (
        id, user_id, plan_id, status, current_period_start, current_period_end,
        stripe_subscription_id, stripe_customer_id, cancel_at_period_end, billing_interval,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, COALESCE($11::timestamptz, NOW()), NOW())
      ON CONFLICT (user_id) DO UPDATE SET
        plan_id = EXCLUDED.plan_id,
        status = EXCLUDED.status,
        current_period_start = EXCLUDED.current_period_start,
        current_period_end = EXCLUDED.current_period_end,
        stripe_subscription_id = COALESCE(EXCLUDED.stripe_subscription_id, subscriptions.stripe_subscription_id),
        stripe_customer_id = COALESCE(EXCLUDED.stripe_customer_id, subscriptions.stripe_customer_id),
        cancel_at_period_end = EXCLUDED.cancel_at_period_end,
        billing_interval = COALESCE(EXCLUDED.billing_interval, subscriptions.billing_interval),
        updated_at = NOW()
      RETURNING ${SUB_SELECT}
    `,
    [
      sub.id,
      sub.userId,
      sub.planId || 'none',
      sub.status || 'active',
      sub.currentPeriodStart || null,
      sub.currentPeriodEnd || null,
      sub.stripeSubscriptionId || null,
      sub.stripeCustomerId || null,
      Boolean(sub.cancelAtPeriodEnd),
      sub.billingInterval || null,
      sub.createdAt || null,
    ]
  );
  return mapSubscriptionRow(rows[0]);
}

function mapUsageRow(row) {
  if (!row) return { scansUsed: 0, pagesScanned: 0, period: null };
  return {
    userId: row.user_id,
    period: row.period,
    scansUsed: Number(row.scans_used || 0),
    pagesScanned: Number(row.pages_scanned || 0),
  };
}

export async function dbGetUsage(userId, period) {
  if (!dbPool || !userId || !period) return { userId, period, scansUsed: 0, pagesScanned: 0 };
  const { rows } = await dbPool.query(
    `SELECT user_id, period, scans_used, pages_scanned FROM usage WHERE user_id = $1 AND period = $2 LIMIT 1`,
    [userId, period]
  );
  if (!rows[0]) return { userId, period, scansUsed: 0, pagesScanned: 0 };
  return mapUsageRow(rows[0]);
}

export async function dbIncrementUsage(userId, period, scans = 1, pages = 0) {
  if (!dbPool || !userId || !period) return dbGetUsage(userId, period);
  const { rows } = await dbPool.query(
    `
      INSERT INTO usage (user_id, period, scans_used, pages_scanned)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (user_id, period) DO UPDATE SET
        scans_used = usage.scans_used + EXCLUDED.scans_used,
        pages_scanned = usage.pages_scanned + EXCLUDED.pages_scanned
      RETURNING user_id, period, scans_used, pages_scanned
    `,
    [userId, period, Number(scans) || 0, Number(pages) || 0]
  );
  return mapUsageRow(rows[0]);
}

function mapPaymentRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    amountCents: Number(row.amount_cents || 0),
    currency: row.currency || 'eur',
    status: row.status || '',
    description: row.description || '',
    stripePaymentIntentId: row.stripe_payment_intent_id || null,
    invoiceUrl: row.invoice_url || null,
    createdAt: isoOrNull(row.created_at),
  };
}

export async function dbInsertPayment(payment) {
  if (!dbPool || !payment?.id || !payment.userId) return null;
  const { rows } = await dbPool.query(
    `
      INSERT INTO payments (
        id, user_id, amount_cents, currency, status, description, stripe_payment_intent_id, invoice_url, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9::timestamptz, NOW()))
      RETURNING id, user_id, amount_cents, currency, status, description, stripe_payment_intent_id, invoice_url, created_at
    `,
    [
      payment.id,
      payment.userId,
      payment.amountCents ?? 0,
      payment.currency || 'eur',
      payment.status || 'paid',
      payment.description || '',
      payment.stripePaymentIntentId || null,
      payment.invoiceUrl || null,
      payment.createdAt || null,
    ]
  );
  return mapPaymentRow(rows[0]);
}

export async function dbFindPaymentByStripeIntent(intentId) {
  if (!dbPool || !intentId) return null;
  const { rows } = await dbPool.query(
    `SELECT id, user_id, amount_cents, currency, status, description, stripe_payment_intent_id, invoice_url, created_at
       FROM payments WHERE stripe_payment_intent_id = $1 LIMIT 1`,
    [intentId]
  );
  return mapPaymentRow(rows[0]);
}

export async function dbListPayments(userId, limit = 50) {
  if (!dbPool || !userId) return [];
  const { rows } = await dbPool.query(
    `SELECT id, user_id, amount_cents, currency, status, description, stripe_payment_intent_id, invoice_url, created_at
       FROM payments WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [userId, limit]
  );
  return rows.map(mapPaymentRow);
}

function mapTokenLotRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    packId: row.pack_id || null,
    tokensGranted: Number(row.tokens_granted || 0),
    tokensRemaining: Number(row.tokens_remaining || 0),
    purchasedAt: isoOrNull(row.purchased_at),
    expiresAt: isoOrNull(row.expires_at),
    stripeCheckoutSessionId: row.stripe_checkout_session_id || null,
    stripePaymentIntentId: row.stripe_payment_intent_id || null,
    createdAt: isoOrNull(row.created_at),
  };
}

export async function dbListTokenLots(userId) {
  if (!dbPool || !userId) return [];
  const { rows } = await dbPool.query(
    `SELECT id, user_id, pack_id, tokens_granted, tokens_remaining, purchased_at, expires_at,
            stripe_checkout_session_id, stripe_payment_intent_id, created_at
       FROM token_lots
      WHERE user_id = $1
      ORDER BY expires_at ASC`,
    [userId]
  );
  return rows.map(mapTokenLotRow);
}

export async function dbGetTokenLotByCheckoutSession(sessionId) {
  if (!dbPool || !sessionId) return null;
  const { rows } = await dbPool.query(
    `SELECT id, user_id, pack_id, tokens_granted, tokens_remaining, purchased_at, expires_at,
            stripe_checkout_session_id, stripe_payment_intent_id, created_at
       FROM token_lots WHERE stripe_checkout_session_id = $1 LIMIT 1`,
    [sessionId]
  );
  return mapTokenLotRow(rows[0]);
}

export async function dbInsertTokenLot(lot) {
  if (!dbPool || !lot?.id || !lot.userId) return null;
  const { rows } = await dbPool.query(
    `
      INSERT INTO token_lots (
        id, user_id, pack_id, tokens_granted, tokens_remaining, purchased_at, expires_at,
        stripe_checkout_session_id, stripe_payment_intent_id, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE($10::timestamptz, NOW()))
      ON CONFLICT (stripe_checkout_session_id) WHERE stripe_checkout_session_id IS NOT NULL DO NOTHING
      RETURNING id, user_id, pack_id, tokens_granted, tokens_remaining, purchased_at, expires_at,
                stripe_checkout_session_id, stripe_payment_intent_id, created_at
    `,
    [
      lot.id,
      lot.userId,
      lot.packId || null,
      lot.tokensGranted,
      lot.tokensRemaining,
      lot.purchasedAt || null,
      lot.expiresAt,
      lot.stripeCheckoutSessionId || null,
      lot.stripePaymentIntentId || null,
      lot.createdAt || null,
    ]
  );
  if (rows[0]) return mapTokenLotRow(rows[0]);
  return dbGetTokenLotByCheckoutSession(lot.stripeCheckoutSessionId);
}

export async function dbConsumeTokens(userId, amount) {
  if (!dbPool || !userId) return { consumed: 0 };
  const needed = Number(amount) || 0;
  if (needed <= 0) return { consumed: 0 };
  const client = await dbPool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT id, tokens_remaining
         FROM token_lots
        WHERE user_id = $1 AND tokens_remaining > 0 AND expires_at > NOW()
        ORDER BY expires_at ASC
        FOR UPDATE`,
      [userId]
    );
    let left = needed;
    for (const row of rows) {
      if (left <= 0) break;
      const take = Math.min(Number(row.tokens_remaining || 0), left);
      await client.query(`UPDATE token_lots SET tokens_remaining = tokens_remaining - $2 WHERE id = $1`, [
        row.id,
        take,
      ]);
      left -= take;
    }
    await client.query('COMMIT');
    return { consumed: needed - left };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function dbClawbackTokenLotByPaymentIntent(intentId) {
  if (!dbPool || !intentId) return null;
  const { rows } = await dbPool.query(
    `UPDATE token_lots SET tokens_remaining = 0
      WHERE stripe_payment_intent_id = $1
      RETURNING id, user_id, pack_id, tokens_granted, tokens_remaining, purchased_at, expires_at,
                stripe_checkout_session_id, stripe_payment_intent_id, created_at`,
    [intentId]
  );
  return mapTokenLotRow(rows[0]);
}

export async function dbSumTokenBalance(userId) {
  if (!dbPool || !userId) return 0;
  const { rows } = await dbPool.query(
    `SELECT COALESCE(SUM(tokens_remaining), 0) AS tokens
       FROM token_lots
      WHERE user_id = $1 AND tokens_remaining > 0 AND expires_at > NOW()`,
    [userId]
  );
  return Number(rows[0]?.tokens || 0);
}

export async function dbListRunsForUser(userId, limit = 200) {
  if (!dbPool || !userId) return [];
  const { rows } = await dbPool.query(
    `SELECT id, run_id, status, urls, processed_urls, requested_urls, result_json, updated_at, user_id, tier
       FROM runs
      WHERE user_id = $1
      ORDER BY updated_at DESC
      LIMIT $2`,
    [userId, limit]
  );
  return rows.map((row) => ({
    domain: row.id,
    runId: row.run_id,
    status: row.status,
    pages: Array.isArray(row.result_json?.urls)
      ? row.result_json.urls.length
      : Number(row.processed_urls || row.requested_urls || row.urls || 0),
    updatedAt: row.updated_at,
    resultJson: row.result_json || null,
    userId: row.user_id,
    tier: row.tier || null,
  }));
}

async function seedDefaultPlans() {
  if (!dbPool) return;
  for (const plan of DEFAULT_PLANS) {
    await dbUpsertPlan(plan);
  }
  await dbPool.query(
    `UPDATE subscriptions SET plan_id = 'none' WHERE plan_id IN ('free', 'starter', 'agency')`
  );
  await dbPool.query(`UPDATE plans SET active = FALSE WHERE id IN ('free', 'starter', 'agency')`);
}

async function migrateJsonStoresToPostgres() {
  if (!dbPool) return;
  const userData = readJsonStore('users.json', { users: [] });
  const users = Array.isArray(userData.users) ? userData.users : [];
  for (const user of users) {
    if (!user?.id || !user.email) continue;
    try {
      await dbUpsertUser(user);
    } catch (err) {
      console.error(`[migrate] user ${user.id} failed:`, err.message);
    }
  }
  const projectData = readJsonStore('projects.json', { projects: [] });
  const projects = Array.isArray(projectData.projects) ? projectData.projects : [];
  for (const project of projects) {
    if (!project?.id || !project.userId || !project.domain) continue;
    try {
      await dbUpsertProject(project);
    } catch (err) {
      console.error(`[migrate] project ${project.id} failed:`, err.message);
    }
  }
}

async function backfillRunUserIds() {
  if (!dbPool) return;
  await dbPool.query(`
    UPDATE runs r
       SET user_id = p.user_id
      FROM projects p
     WHERE r.user_id IS NULL
       AND r.id = p.domain
  `);
}


