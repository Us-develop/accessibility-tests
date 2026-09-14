#!/usr/bin/env node
/**
 * Accessibility Test Runner
 * Usage:
 *   node run-tests.js [--report] [--urls "url1,url2,..."] [--output-id <id>]
 *   node run-tests.js [--report] [--urls="url1,url2,..."] [--output-id=<id>]
 * URLs can also be loaded from urls.config.js when --urls is not provided.
 */

import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { CHECKLIST_CHAPTERS, getPrimaryChapterForAxeViolation } from './checklists.js';
import { runSemanticChecks } from './tests/chapter1-semantics.js';
import { runImageChecks } from './tests/chapter2-images.js';
import { runVisualChecks } from './tests/chapter3-visual.js';
import { runResponsiveChecks } from './tests/chapter4-responsive.js';
import { runMultimediaChecks } from './tests/chapter5-multimedia.js';
import { runInputMethodChecks } from './tests/chapter6-input-methods.js';
import { runFormChecks } from './tests/chapter7-forms.js';
import { runDynamicChecks } from './tests/chapter8-dynamic.js';
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { lookup as dnsLookup } from 'dns/promises';
import { isIP } from 'net';
import { isBlockedHostname, isBlockedIp, scannerUserAgent, stripBrackets } from './server/url-guard.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPORTS_BASE = process.env.REPORTS_BASE?.trim() || join(__dirname, 'reports');

/** @type {Map<string, Promise<{ address: string }[]>>} */
const hostLookupCache = new Map();

async function lookupHostCached(hostname) {
  const host = stripBrackets(hostname).toLowerCase();
  if (hostLookupCache.has(host)) return hostLookupCache.get(host);
  const pending = dnsLookup(host, { all: true })
    .then((records) => (Array.isArray(records) ? records : [records]))
    .catch((err) => {
      hostLookupCache.delete(host);
      throw err;
    });
  hostLookupCache.set(host, pending);
  return pending;
}

async function httpUrlIsBlocked(raw) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return true;
  }
  if (parsed.protocol === 'data:' || parsed.protocol === 'blob:' || parsed.protocol === 'about:') {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return true;
  }
  const hostname = stripBrackets(parsed.hostname);
  if (isBlockedHostname(hostname)) return true;
  if (isIP(hostname)) return isBlockedIp(hostname);
  try {
    const records = await lookupHostCached(hostname);
    const addresses = records.map((row) => (typeof row === 'string' ? row : row.address)).filter(Boolean);
    return !addresses.length || addresses.some((addr) => isBlockedIp(addr));
  } catch {
    return true;
  }
}

function originOf(raw) {
  try {
    return new URL(raw).origin;
  } catch {
    return '';
  }
}

async function requestChainLeavesAllowlist(request, pageOrigin) {
  let current = request;
  const seen = new Set();
  while (current && !seen.has(current)) {
    seen.add(current);
    const raw = current.url();
    // The page under test may itself be loopback (scripts/self-scan.mjs). Allow
    // that origin; still block other private/reserved hosts.
    if (pageOrigin && originOf(raw) === pageOrigin) {
      current = current.redirectedFrom();
      continue;
    }
    if (await httpUrlIsBlocked(raw)) return true;
    current = current.redirectedFrom();
  }
  return false;
}

function parseUrlsFromArgs() {
  const urlsArg = process.argv.find((a) => a.startsWith('--urls='));
  if (urlsArg) {
    const value = urlsArg.replace('--urls=', '').trim();
    return value
      .split(/[\n,\s]+/)
      .map((u) => u.trim())
      .filter((u) => u && u.startsWith('http'));
  }
  const idx = process.argv.indexOf('--urls');
  if (idx !== -1 && process.argv[idx + 1]) {
    const value = String(process.argv[idx + 1]).trim();
    return value
      .split(/[\n,\s]+/)
      .map((u) => u.trim())
      .filter((u) => u && u.startsWith('http'));
  }
  return null;
}

function parseOutputId() {
  const arg = process.argv.find((a) => a.startsWith('--output-id='));
  if (arg) return arg.replace('--output-id=', '').trim();
  const idx = process.argv.indexOf('--output-id');
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  return null;
}

function parseViewportFromArgs() {
  const arg = process.argv.find((a) => a.startsWith('--viewport='));
  let raw = null;
  if (arg) raw = arg.replace('--viewport=', '').trim();
  else {
    const idx = process.argv.indexOf('--viewport');
    if (idx !== -1 && process.argv[idx + 1]) raw = String(process.argv[idx + 1]).trim();
  }
  if (raw) {
    const match = raw.match(/^(\d+)\s*x\s*(\d+)$/i);
    if (match) {
      return { width: Number(match[1]), height: Number(match[2]) };
    }
  }
  return { width: 1366, height: 768 };
}

function parseBooleanEnv(name, defaultValue) {
  const raw = process.env[name];
  if (raw === undefined) return defaultValue;
  const value = String(raw).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(value)) return true;
  if (['0', 'false', 'no', 'off'].includes(value)) return false;
  return defaultValue;
}

function parseIntEnv(name, defaultValue, min, max) {
  const raw = process.env[name];
  if (raw === undefined) return defaultValue;
  const n = parseInt(String(raw), 10);
  if (!Number.isFinite(n)) return defaultValue;
  return Math.min(Math.max(n, min), max);
}

async function getUrls() {
  const fromArgs = parseUrlsFromArgs();
  if (fromArgs && fromArgs.length > 0) return fromArgs;
  try {
    const { urls } = await import('./urls.config.js');
    return urls || [];
  } catch {
    return [];
  }
}

async function runAxeScan(page, url) {
  await page.addStyleTag({
    content: '* { animation: none !important; transition: none !important; }',
  });
  const builder = new AxeBuilder({ page }).withTags([
    'wcag2a',
    'wcag2aa',
    'wcag21a',
    'wcag21aa',
    'wcag22a',
    'wcag22aa',
  ]);
  const includeAxePasses = parseBooleanEnv('ENABLE_AXE_PASSES', false);
  if (!includeAxePasses) {
    builder.options({
      resultTypes: ['violations', 'incomplete'],
    });
  }
  const results = await builder.analyze();

  const byChapter = {};
  Object.keys(CHECKLIST_CHAPTERS).forEach((ch) => {
    byChapter[ch] = { violations: [], incomplete: [], passes: [] };
  });

  (results.violations || []).forEach((v) => {
    const ch = getPrimaryChapterForAxeViolation(v);
    if (byChapter[ch]) byChapter[ch].violations.push(v);
  });
  (results.incomplete || []).forEach((v) => {
    const ch = getPrimaryChapterForAxeViolation(v);
    if (byChapter[ch]) byChapter[ch].incomplete.push(v);
  });
  if (includeAxePasses) {
    (results.passes || []).forEach((v) => {
      const ch = getPrimaryChapterForAxeViolation(v);
      if (byChapter[ch]) byChapter[ch].passes.push(v);
    });
  }

  return {
    url,
    timestamp: new Date().toISOString(),
    violations: results.violations,
    incomplete: results.incomplete,
    passes: includeAxePasses ? results.passes : [],
    byChapter,
  };
}

async function runCustomChecks(page, url, options = {}) {
  const allResults = [];

  const chapters = [
    ['semantics', runSemanticChecks],
    ['images', runImageChecks],
    ['visualDesign', async (p) => runVisualChecks(p, { enableContrastChecks: options.enableContrastChecks !== false })],
    ['responsive', async (p) => runResponsiveChecks(p, { width: 320, height: 568 })],
    ['multimedia', runMultimediaChecks],
    ['inputMethods', runInputMethodChecks],
    ['forms', runFormChecks],
    ['dynamicUpdates', runDynamicChecks],
  ];

  for (const [chapterId, fn] of chapters) {
    try {
      const results = await fn(page);
      allResults.push(...results.map((r) => ({ ...r, url })));
    } catch (err) {
      allResults.push({
        id: `${chapterId}-error`,
        rule: `${chapterId} checks`,
        status: 'fail',
        message: err.message,
        chapter: chapterId,
        url,
      });
    }
  }

  return allResults;
}

async function runWithConcurrency(items, concurrency, taskFn) {
  let cursor = 0;
  async function worker() {
    while (true) {
      const current = cursor;
      cursor += 1;
      if (current >= items.length) return;
      await taskFn(items[current], current);
    }
  }
  const workerCount = Math.min(concurrency, Math.max(items.length, 1));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
}

async function main() {
  const urls = await getUrls();
  const outputId = parseOutputId();
  const viewport = parseViewportFromArgs();
  const generateReport = process.argv.includes('--report');
  const urlConcurrency = parseIntEnv('URL_CONCURRENCY', 1, 1, 8);
  const waitForNetworkIdle = parseBooleanEnv('WAIT_FOR_NETWORKIDLE', false);
  const enableContrastChecks = parseBooleanEnv('ENABLE_CONTRAST_CHECKS', true);
  const blockMediaRequests = parseBooleanEnv('BLOCK_MEDIA_REQUESTS', true);
  const pageGotoTimeoutMs = parseIntEnv('PAGE_GOTO_TIMEOUT_MS', 90000, 30000, 300000);
  const autoDisableContrastOnLargeDom = parseBooleanEnv('AUTO_DISABLE_CONTRAST_ON_LARGE_DOM', true);
  const largeDomThreshold = parseIntEnv('LARGE_DOM_THRESHOLD', 6000, 1000, 100000);

  if (!urls || urls.length === 0) {
    console.error('No URLs. Use --urls="url1,url2" or configure urls.config.js');
    process.exit(1);
  }

  const OUTPUT_DIR = outputId ? join(REPORTS_BASE, outputId) : join(REPORTS_BASE, 'latest');
  const RESULTS_FILE = join(OUTPUT_DIR, 'accessibility-results.json');

  if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log('Starting accessibility tests...');
  console.log(`Viewport: ${viewport.width}x${viewport.height}`);
  console.log(`URL concurrency: ${urlConcurrency}`);
  console.log(`Wait for networkidle: ${waitForNetworkIdle ? 'enabled' : 'disabled'}`);
  console.log(`Contrast checks: ${enableContrastChecks ? 'enabled' : 'disabled'}`);
  console.log(`Block media requests: ${blockMediaRequests ? 'enabled' : 'disabled'}`);
  console.log(`Page goto timeout: ${pageGotoTimeoutMs}ms`);
  console.log(`Auto-disable contrast on large DOM: ${autoDisableContrastOnLargeDom ? `enabled (>${largeDomThreshold} nodes)` : 'disabled'}`);

  const report = {
    generatedAt: new Date().toISOString(),
    urls: [],
    axeResults: {},
    customResults: [],
    summary: { pass: 0, fail: 0, warn: 0, info: 0 },
    screenshots: {},
  };

  const chromiumArgs = [
    '--disable-blink-features=AutomationControlled',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--disable-software-rasterizer',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-default-apps',
    '--disable-sync',
    '--metrics-recording-only',
    '--mute-audio',
    '--no-first-run',
  ];
  // Chromium's sandbox needs user namespaces / seccomp. The Docker image runs as
  // USER node so the sandbox can stay on. Set SCANNER_NO_SANDBOX=true only when
  // the host forbids namespaced sandboxes (legacy root containers, some PaaS).
  if (parseBooleanEnv('SCANNER_NO_SANDBOX', false)) {
    chromiumArgs.push('--no-sandbox');
  }

  const browser = await chromium.launch({
    headless: true,
    args: chromiumArgs,
  });

  let completed = 0;
  try {
    await runWithConcurrency(urls, urlConcurrency, async (url) => {
      console.log(`\nTesting: ${url}`);
      const context = await browser.newContext({
        userAgent: scannerUserAgent(),
        viewport,
      });
      const page = await context.newPage();
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.route('**/*', async (route) => {
        const request = route.request();
        if (await requestChainLeavesAllowlist(request, originOf(url))) {
          return route.abort('blockedbyclient');
        }
        if (blockMediaRequests && request.resourceType() === 'media') {
          return route.abort();
        }
        return route.continue();
      });

      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: pageGotoTimeoutMs });
        if (waitForNetworkIdle) {
          await page.waitForLoadState('networkidle', { timeout: 7000 }).catch(() => {});
        }

        const axeData = await runAxeScan(page, url);
        report.axeResults[url] = axeData;
        if (!report.urls.includes(url)) report.urls.push(url);

        let contrastChecksEnabledForPage = enableContrastChecks;
        if (autoDisableContrastOnLargeDom && enableContrastChecks) {
          const domNodeCount = await page.evaluate(() => document.querySelectorAll('*').length);
          if (domNodeCount > largeDomThreshold) {
            contrastChecksEnabledForPage = false;
            console.warn(
              `  Large DOM detected (${domNodeCount} nodes); skipping custom contrast (axe color-contrast still runs).`
            );
            report.customResults.push({
              id: 'contrast-not-run',
              rule: 'Custom contrast checks skipped on a large DOM',
              status: 'info',
              message: `This page has ${domNodeCount} nodes. Custom contrast was skipped to avoid timeouts; axe WCAG contrast rules still ran.`,
              chapter: 'visualDesign',
              url,
            });
            report.summary.info++;
          }
        }

        const customData = await runCustomChecks(page, url, { enableContrastChecks: contrastChecksEnabledForPage });
        report.customResults.push(...customData);

        customData.forEach((r) => {
          if (r.status === 'pass') report.summary.pass++;
          else if (r.status === 'fail') report.summary.fail++;
          else if (r.status === 'warn') report.summary.warn++;
          else if (r.status === 'info') report.summary.info++;
          else report.summary.warn++;
        });
      } catch (err) {
        console.error(`  Error: ${err.message}`);
        report.customResults.push({
          id: 'page-load',
          rule: 'Page load',
          status: 'fail',
          message: err.message,
          url,
        });
        report.summary.fail++;
      } finally {
        completed += 1;
        console.log(JSON.stringify({ type: 'progress', done: completed, total: urls.length, url }));
        await page.close().catch(() => {});
        await context.close();
      }
    });
  } finally {
    await browser.close();
  }

  const prevFile = join(OUTPUT_DIR, 'accessibility-results-previous.json');
  if (existsSync(RESULTS_FILE)) {
    try {
      const current = readFileSync(RESULTS_FILE, 'utf8');
      writeFileSync(prevFile, current, 'utf8');
    } catch (_) {}
  }
  writeFileSync(RESULTS_FILE, JSON.stringify(report, null, 2), 'utf8');
  console.log(`\nResults saved to ${RESULTS_FILE}`);

  if (generateReport) {
    const { generateReport: genReport } = await import('./generate-report.js');
    genReport(report, { outputDir: OUTPUT_DIR });
    console.log(`HTML report generated in ${OUTPUT_DIR}`);
  }

  const totalViolations = Object.values(report.axeResults).reduce(
    (sum, r) => sum + (r.violations?.length || 0),
    0
  );
  console.log(
    `\nSummary: ${report.summary.pass} pass, ${report.summary.warn} warn, ${report.summary.fail} fail, ${report.summary.info || 0} info`
  );
  console.log(`Axe violations: ${totalViolations}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
