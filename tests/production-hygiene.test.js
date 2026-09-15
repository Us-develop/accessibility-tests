import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const tmp = mkdtempSync(join(tmpdir(), 'wcag-hygiene-'));
process.env.REPORTS_BASE = tmp;
process.env.AUTH_ENABLED = 'true';
process.env.APP_USERNAME = 'root';
process.env.APP_PASSWORD = 'staff-secret-pass';
process.env.SESSION_SECRET = 'unit-test-session-secret-32chars!!';
process.env.WCAG_DISABLE_RATE_LIMIT = '1';
process.env.AUTH_EMAIL_VERIFY = 'auto';
process.env.DEFER_ROOT_LOGIN_TO_SHELL = 'true';
delete process.env.FTP_HOST;
delete process.env.FTP_USER;

const { loadAllAppEnv } = await import('../server/load-env.mjs');
const { buildDbPoolConfig, migrateJsonStoresToPostgres } = await import('../server/db.js');
const { writeJsonStore, saasFile } = await import('../server/json-store.mjs');
const { createAccessibilityApp } = await import('../server/create-app.mjs');
const { assertProductionDatabaseUrl } = await import('../server/config.mjs');

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

after(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function withEnv(patch, fn) {
  const prev = {};
  for (const key of Object.keys(patch)) {
    prev[key] = Object.prototype.hasOwnProperty.call(process.env, key) ? process.env[key] : undefined;
    if (patch[key] === undefined) delete process.env[key];
    else process.env[key] = patch[key];
  }
  try {
    return fn();
  } finally {
    for (const key of Object.keys(patch)) {
      if (prev[key] === undefined) delete process.env[key];
      else process.env[key] = prev[key];
    }
  }
}

describe('load-env production precedence', () => {
  it('lets host-injected env win over every dotenv file', () => {
    const root = mkdtempSync(join(tmpdir(), 'wcag-dotenv-'));
    mkdirSync(join(root, 'web'));
    writeFileSync(join(root, '.env'), 'HOST_WINS=from-env\nFROM_ENV=env\n');
    writeFileSync(join(root, '.env.local'), 'HOST_WINS=from-local\nFROM_LOCAL=local\n');
    writeFileSync(join(root, 'web', '.env'), 'HOST_WINS=from-web\nFROM_WEB=web\n');
    writeFileSync(join(root, 'web', '.env.local'), 'HOST_WINS=from-web-local\nFROM_WEB_LOCAL=weblocal\n');
    const logs = [];
    const originalLog = console.log;
    console.log = (...args) => {
      logs.push(args.map(String).join(' '));
    };
    try {
      withEnv(
        {
          NODE_ENV: 'production',
          HOST_WINS: 'from-host',
          FROM_ENV: undefined,
          FROM_LOCAL: undefined,
          FROM_WEB: undefined,
          FROM_WEB_LOCAL: undefined,
        },
        () => {
          const result = loadAllAppEnv(root);
          assert.equal(result.production, true);
          assert.equal(result.override, false);
          assert.equal(process.env.HOST_WINS, 'from-host');
          assert.equal(process.env.FROM_ENV, 'env');
          assert.equal(process.env.FROM_LOCAL, 'local');
          assert.equal(process.env.FROM_WEB, 'web');
          assert.equal(process.env.FROM_WEB_LOCAL, 'weblocal');
          assert.equal(result.loaded.length, 4);
          assert.ok(logs.some((line) => line.includes('[env] loaded') && line.includes('.env')));
        }
      );
    } finally {
      console.log = originalLog;
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('db pool options', () => {
  it('returns null without DATABASE_URL and sets pool/ssl options when configured', () => {
    assert.equal(buildDbPoolConfig({}), null);
    const plain = buildDbPoolConfig({ DATABASE_URL: 'postgres://wcag@127.0.0.1/wcag' });
    assert.equal(plain.connectionString, 'postgres://wcag@127.0.0.1/wcag');
    assert.equal(plain.max, 10);
    assert.equal(plain.idleTimeoutMillis, 30000);
    assert.equal(plain.connectionTimeoutMillis, 5000);
    assert.equal(plain.statement_timeout, 30000);
    assert.equal(plain.ssl, undefined);

    const caFile = join(tmp, 'db-ca.pem');
    writeFileSync(caFile, '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n');
    const ssl = buildDbPoolConfig({
      DATABASE_URL: 'postgres://wcag@example/wcag',
      DATABASE_SSL: 'true',
      DATABASE_CA: caFile,
    });
    assert.equal(ssl.ssl.rejectUnauthorized, true);
    assert.ok(Buffer.isBuffer(ssl.ssl.ca) || typeof ssl.ssl.ca === 'string');
    assert.equal(String(ssl.ssl.ca), readFileSync(caFile, 'utf8'));
  });
});

describe('migrateJsonStoresToPostgres', () => {
  it('does not change an existing password_hash and archives JSON as *.imported', async () => {
    const hashes = new Map([['user-1', 'existing-hash']]);
    const queries = [];
    async function query(sql, values) {
      queries.push({ sql, values });
      if (/INSERT INTO users/i.test(sql)) {
        const id = values[0];
        const nextHash = values[4];
        if (hashes.has(id)) return { rowCount: 0, rows: [] };
        hashes.set(id, nextHash);
        return { rowCount: 1, rows: [{}] };
      }
      return { rowCount: 1, rows: [{}] };
    }
    writeJsonStore('users.json', {
      users: [{ id: 'user-1', email: 'a@example.com', passwordHash: 'json-hash-should-not-win' }],
    });
    writeJsonStore('projects.json', { projects: [] });
    const result = await migrateJsonStoresToPostgres({ query });
    assert.equal(hashes.get('user-1'), 'existing-hash');
    assert.equal(result.users, 0);
    assert.ok(queries.some((q) => /ON CONFLICT DO NOTHING/i.test(q.sql)));
    assert.ok(!queries.some((q) => /password_hash\s*=\s*EXCLUDED/i.test(q.sql)));
    assert.equal(existsSync(saasFile('users.json')), false);
    assert.equal(existsSync(saasFile('users.json.imported')), true);
    assert.equal(existsSync(saasFile('projects.json')), false);
    assert.equal(existsSync(saasFile('projects.json.imported')), true);
  });
});

describe('production startup mail', () => {
  it('refuses MAIL_FROM=noreply@localhost in production', () => {
    withEnv(
      {
        NODE_ENV: 'production',
        AUTH_ENABLED: 'false',
        MAIL_FROM: 'noreply@localhost',
        PUBLIC_BASE_URL: 'https://wcag.example',
        COMPANY_LEGAL_NAME: 'Example BV',
        COMPANY_KBO: '0123.456.789',
        COMPANY_VAT: 'BE0123456789',
        COMPANY_ADDRESS: 'Example street 1, 1000 Brussels',
        COMPANY_EMAIL: 'privacy@example.com',
      },
      () => {
        assert.throws(
          () => createAccessibilityApp(repoRoot),
          /MAIL_FROM is required in production and must not end with @localhost/
        );
      }
    );
  });
});

describe('production database', () => {
  it('throws when NODE_ENV=production and DATABASE_URL is unset', () => {
    withEnv({ NODE_ENV: 'production', DATABASE_URL: undefined }, () => {
      assert.throws(() => assertProductionDatabaseUrl(), /DATABASE_URL is required in production/);
    });
  });

  it('does not throw when DATABASE_URL is set', () => {
    withEnv(
      { NODE_ENV: 'production', DATABASE_URL: 'postgres://wcag:wcag@127.0.0.1/wcag' },
      () => {
        assert.doesNotThrow(() => assertProductionDatabaseUrl());
      }
    );
  });

  it('is called from both production entrypoints', () => {
    const runServer = readFileSync(join(repoRoot, 'web/run-server.mjs'), 'utf8');
    const serverJs = readFileSync(join(repoRoot, 'server.js'), 'utf8');
    assert.match(runServer, /assertProductionDatabaseUrl\(\)/);
    assert.match(serverJs, /assertProductionDatabaseUrl\(\)/);
    const deploy = readFileSync(join(repoRoot, 'deploy/README.md'), 'utf8');
    assert.match(deploy, /DATABASE_URL/);
    assert.match(deploy, /exits at startup/);
  });
});
