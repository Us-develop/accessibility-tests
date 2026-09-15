#!/usr/bin/env node
/**
 * Build the web app, serve it on a free loopback port, and run run-tests.js
 * against every indexable page (plus a minted teaser) at 320px and 1280px.
 * Fails if any axe violation is critical/serious or if no-horizontal-scroll FAILs.
 * Writes results under a temp dir (never reports/).
 *
 * Sets SELF_SCAN_ALLOW_LOOPBACK=1 only on the scanner child — never on the server.
 * Sets WCAG_DOTENV_OVERRIDE=0 so .env.local cannot clobber the harness env.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { INDEXABLE_PATHS } from '../server/indexable-paths.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const TEASER_TOKEN = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const TEASER_RUN_ID = '2026-09-15T00-00-00Z-selfscanaaaa';
const TEASER_DOMAIN = 'self-scan.example';
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

function collectFailures(report, expectedUrls = []) {
  const failures = [];
  for (const expected of expectedUrls) {
    if (!report.axeResults?.[expected]) {
      failures.push(`${expected}: no axe results (page did not load)`);
    }
  }
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
    if (row.id === 'page-load' && row.status === 'fail') {
      failures.push(`${row.url || ''}: page-load FAIL — ${row.message || ''}`);
    }
  }
  return failures;
}

function mintTeaser(work) {
  const tokenDir = join(work, '_guest-tokens');
  const runFolder = join(work, TEASER_DOMAIN, TEASER_RUN_ID);
  mkdirSync(tokenDir, { recursive: true });
  mkdirSync(runFolder, { recursive: true });
  const createdAt = new Date().toISOString();
  writeFileSync(
    join(tokenDir, `${TEASER_TOKEN}.json`),
    JSON.stringify(
      {
        domain: TEASER_DOMAIN,
        runId: TEASER_RUN_ID,
        url: `https://${TEASER_DOMAIN}/`,
        ip: null,
        createdAt,
        expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      },
      null,
      2
    ),
    'utf8'
  );
  writeFileSync(
    join(runFolder, 'accessibility-results.json'),
    JSON.stringify({
      generatedAt: createdAt,
      urls: [`https://${TEASER_DOMAIN}/`],
      axeResults: {},
      customResults: [],
      summary: { pass: 0, fail: 0, warn: 0, info: 0 },
    }),
    'utf8'
  );
}

/**
 * Open the login dialog and Tab 30 times. Focus must stay inside the overlay
 * (skip link, header, footer, and main are inert).
 */
async function assertLoginDialogTabLoop(origin) {
  const browser = await chromium.launch({
    headless: true,
    args: process.env.SCANNER_NO_SANDBOX === 'true' ? ['--no-sandbox'] : [],
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      serviceWorkers: 'block',
    });
    const page = await context.newPage();
    await page.goto(`${origin}/pricing`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.locator('#wcag-header-login').click();
    await page.locator('#wcag-login-dialog').waitFor({ state: 'visible', timeout: 10000 });
    for (let i = 0; i < 30; i += 1) {
      await page.keyboard.press('Tab');
      const inside = await page.evaluate(() => {
        const overlay = document.getElementById('wcag-login-modal');
        const el = document.activeElement;
        return Boolean(overlay && el && overlay.contains(el));
      });
      if (!inside) {
        throw new Error(`Tab press ${i + 1} of 30 left the login dialog`);
      }
    }
    await context.close();
  } finally {
    await browser.close();
  }
}

async function main() {
  const work = mkdtempSync(join(tmpdir(), 'wcag-self-scan-'));
  mintTeaser(work);
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const paths = [...INDEXABLE_PATHS, `/teaser/${TEASER_TOKEN}`];
  const urls = paths.map((p) => origin + p);

  console.log('Building web app…');
  const build = await run('npm', ['run', 'build', '--prefix', 'web']);
  if (build.code !== 0) {
    rmSync(work, { recursive: true, force: true });
    process.exit(build.code);
  }

  const serverEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    NODE: process.env.NODE,
    NODE_ENV: 'test',
    PORT: String(port),
    AUTH_ENABLED: 'true',
    APP_USERNAME: 'root',
    APP_PASSWORD: 'self-scan-pass-12',
    SESSION_SECRET: 'self-scan-session-secret-32chars!!',
    DEFER_ROOT_LOGIN_TO_SHELL: 'true',
    ASTRO_NODE_AUTOSTART: 'disabled',
    WCAG_DISABLE_RATE_LIMIT: '1',
    WCAG_DOTENV_OVERRIDE: '0',
    AUTH_EMAIL_VERIFY: 'auto',
    REPORTS_BASE: work,
    COMPANY_EMAIL: 'a11y@example.com',
    SCANNER_NO_SANDBOX: 'true',
    PUBLIC_BASE_URL: origin,
  };

  const server = spawn('node', ['web/run-server.mjs'], {
    cwd: repoRoot,
    env: serverEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (chunk) => process.stdout.write(chunk));
  server.stderr.on('data', (chunk) => process.stderr.write(chunk));

  let failed = false;
  try {
    await waitForHttp(`${origin}/`);
    console.log('\nDialog Tab loop (30 presses)…');
    await assertLoginDialogTabLoop(origin);

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
          SELF_SCAN_ALLOW_LOOPBACK: '1',
          PUBLIC_BASE_URL: origin,
        }
      );
      if (scan.code !== 0) {
        allFailures.push(`run-tests.js exited ${scan.code} at ${outputId}`);
        continue;
      }
      const resultsPath = join(work, outputId, 'accessibility-results.json');
      const report = JSON.parse(readFileSync(resultsPath, 'utf8'));
      allFailures.push(...collectFailures(report, urls).map((line) => `[${outputId}] ${line}`));
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
