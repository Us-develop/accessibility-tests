/**
 * Shared process env helpers. Keep create-app.mjs from growing more copies of these.
 */

export function publicBaseUrl() {
  const fromEnv = String(process.env.PUBLIC_BASE_URL || '').trim().replace(/\/$/, '');
  if (fromEnv) return fromEnv;
  return `http://localhost:${process.env.PORT || 3456}`;
}

/**
 * Production must advertise a real public origin (emails, Stripe redirects, scanner UA).
 */
export function assertProductionPublicBaseUrl() {
  if (process.env.NODE_ENV !== 'production') return;
  const raw = String(process.env.PUBLIC_BASE_URL || '');
  if (!raw.trim() || /localhost/i.test(raw)) {
    throw new Error(
      'PUBLIC_BASE_URL is required in production and must not contain localhost (see .env.example).'
    );
  }
}

/**
 * Production persistence is Postgres. JSON-store fallback is for local/tests only.
 */
export function assertProductionDatabaseUrl() {
  if (process.env.NODE_ENV !== 'production') return;
  if (!String(process.env.DATABASE_URL || '').trim()) {
    throw new Error(
      'DATABASE_URL is required in production (see deploy/README.md and .env.example).'
    );
  }
}
