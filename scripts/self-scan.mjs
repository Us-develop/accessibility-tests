#!/usr/bin/env node
/**
 * Build the web app, serve it on a free loopback port, and run run-tests.js
 * against public product pages at 320px and 1280px.
 * Fails if any axe violation is critical/serious or if no-horizontal-scroll FAILs.
 * Writes results under a temp dir (never reports/).
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const TEASER_TOKEN = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 1280, height: 800 },
];

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
    server.on('error', reject);
  });
}

function run(command, args, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      env: { ...process.env, ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      process.stdout.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      process.stderr.write(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

function waitForHttp(url, timeoutMs = 60000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const res = await fetch(url, { redirect: 'manual' });
        if (res.status > 0) {
          resolve();
          return;
        }
      } catch {
        /* still booting */
      }
      if (Date.now() - started > timeoutMs) {
        reject(new Error(`Timed out waiting for ${url}`));
        return;
      }
      setTimeout(tick, 400);
    };
    tick();
  });
}

function collectFailures(report) {
  const failures = [];
  for (const [url, axe] of Object.entries(report.axeResults || {})) {
    for (const v of axe.violations || []) {
      if (v.impact === 'critical' || v.impact === 'serious') {
        failures.push(`${url}: axe ${v.impact} ${v.id}`);
      }
    }
  }
  for (const row of report.customResults || []) {
    if (row.id === 'no-horizontal-scroll' && row.status === 'fail') {
      failures.push(`${row.url || ''}: no-horizontal-scroll FAIL — ${row.message || ''}`);
    }
  }
  return failures;
}

async function main() {
  const work = mkdtempSync(join(tmpdir(), 'wcag-self-scan-'));
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const paths = ['/', '/pricing', '/signup', '/limitations', '/privacy', `/teaser/${TEASER_TOKEN}`];
  const urls = paths.map((p) => origin + p);

  console.log('Building web app…');
  const build = await run('npm', ['run', 'build', '--prefix', 'web']);
  if (build.code !== 0) {
    rmSync(work, { recursive: true, force: true });
    process.exit(build.code);
  }

  const serverEnv = {
    PORT: String(port),
    AUTH_ENABLED: 'true',
    APP_USERNAME: 'root',
    APP_PASSWORD: 'self-scan-pass-12',
    SESSION_SECRET: 'self-scan-session-secret-32chars!!',
    DEFER_ROOT_LOGIN_TO_SHELL: 'true',
    ASTRO_NODE_AUTOSTART: 'disabled',
    WCAG_DISABLE_RATE_LIMIT: '1',
    AUTH_EMAIL_VERIFY: 'auto',
    REPORTS_BASE: work,
    COMPANY_EMAIL: 'a11y@example.com',
    SCANNER_NO_SANDBOX: 'true',
  };

  const server = spawn('node', ['web/run-server.mjs'], {
    cwd: repoRoot,
    env: { ...process.env, ...serverEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (chunk) => process.stdout.write(chunk));
  server.stderr.on('data', (chunk) => process.stderr.write(chunk));

  let failed = false;
  try {
    await waitForHttp(`${origin}/`);
    const allFailures = [];
    for (const vp of VIEWPORTS) {
      const outputId = `${vp.width}x${vp.height}`;
      console.log(`\nSelf-scan ${vp.width}x${vp.height}…`);
      const scan = await run(
        'node',
        ['run-tests.js', `--urls=${urls.join(',')}`, `--output-id=${outputId}`, `--viewport=${vp.width}x${vp.height}`],
        {
          REPORTS_BASE: work,
          SCANNER_NO_SANDBOX: 'true',
          ENABLE_CONTRAST_CHECKS: 'false',
          BLOCK_MEDIA_REQUESTS: 'true',
        }
      );
      if (scan.code !== 0) {
        allFailures.push(`run-tests.js exited ${scan.code} at ${outputId}`);
        continue;
      }
      const resultsPath = join(work, outputId, 'accessibility-results.json');
      const report = JSON.parse(readFileSync(resultsPath, 'utf8'));
      allFailures.push(...collectFailures(report).map((line) => `[${outputId}] ${line}`));
    }
    if (allFailures.length) {
      console.error('\nSelf-scan failed:');
      for (const line of allFailures) console.error(`  ${line}`);
      failed = true;
    } else {
      console.log('\nSelf-scan passed at 320px and 1280px.');
    }
  } catch (err) {
    console.error(err);
    failed = true;
  } finally {
    server.kill('SIGTERM');
    await new Promise((resolve) => {
      const t = setTimeout(resolve, 4000);
      server.on('close', () => {
        clearTimeout(t);
        resolve();
      });
    });
    rmSync(work, { recursive: true, force: true });
  }
  process.exit(failed ? 1 : 0);
}

main();
