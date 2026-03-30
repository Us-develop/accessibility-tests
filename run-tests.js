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
import { CHECKLIST_CHAPTERS, AXE_TAG_TO_CHAPTER } from './checklists.js';
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

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPORTS_BASE = join(__dirname, 'reports');

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

function categorizeAxeViolation(violation) {
  const tags = violation.tags || [];
  const chapters = new Set();
  tags.forEach((tag) => {
    const ch = AXE_TAG_TO_CHAPTER[tag];
    if (ch) ch.forEach((c) => chapters.add(c));
  });
  if (chapters.size === 0) chapters.add('semantics');
  return Array.from(chapters);
}

async function runAxeScan(page, url) {
  const builder = new AxeBuilder({ page });
  const results = await builder.analyze();

  const byChapter = {};
  Object.keys(CHECKLIST_CHAPTERS).forEach((ch) => {
    byChapter[ch] = { violations: [], incomplete: [], passes: [] };
  });

  (results.violations || []).forEach((v) => {
    const chapters = categorizeAxeViolation(v);
    chapters.forEach((ch) => {
      if (byChapter[ch]) byChapter[ch].violations.push(v);
    });
  });
  (results.incomplete || []).forEach((v) => {
    const chapters = categorizeAxeViolation(v);
    chapters.forEach((ch) => {
      if (byChapter[ch]) byChapter[ch].incomplete.push(v);
    });
  });
  (results.passes || []).forEach((v) => {
    const chapters = categorizeAxeViolation(v);
    chapters.forEach((ch) => {
      if (byChapter[ch]) byChapter[ch].passes.push(v);
    });
  });

  return {
    url,
    timestamp: new Date().toISOString(),
    violations: results.violations,
    incomplete: results.incomplete,
    passes: results.passes,
    byChapter,
  };
}

async function runCustomChecks(page, url) {
  const allResults = [];

  const chapters = [
    ['semantics', runSemanticChecks],
    ['images', runImageChecks],
    ['visualDesign', runVisualChecks],
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
  const generateReport = process.argv.includes('--report');
  const urlConcurrency = parseIntEnv('URL_CONCURRENCY', 2, 1, 8);
  const waitForNetworkIdle = parseBooleanEnv('WAIT_FOR_NETWORKIDLE', false);

  if (!urls || urls.length === 0) {
    console.error('No URLs. Use --urls="url1,url2" or configure urls.config.js');
    process.exit(1);
  }

  const OUTPUT_DIR = outputId ? join(REPORTS_BASE, outputId) : join(REPORTS_BASE, 'latest');
  const RESULTS_FILE = join(OUTPUT_DIR, 'accessibility-results.json');

  if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log('Starting accessibility tests...');
  console.log(`URLs to test: ${urls.length}`);
  console.log(`URL concurrency: ${urlConcurrency}`);
  console.log(`Wait for networkidle: ${waitForNetworkIdle ? 'enabled' : 'disabled'}`);

  const report = {
    generatedAt: new Date().toISOString(),
    urls: [],
    axeResults: {},
    customResults: [],
    summary: { pass: 0, fail: 0, warn: 0 },
    screenshots: {},
  };

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
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
    ],
  });

  try {
    await runWithConcurrency(urls, urlConcurrency, async (url) => {
      console.log(`\nTesting: ${url}`);
      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport: { width: 1366, height: 768 },
      });
      const page = await context.newPage();

      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        if (waitForNetworkIdle) {
          await page.waitForLoadState('networkidle', { timeout: 7000 }).catch(() => {});
        }

        const axeData = await runAxeScan(page, url);
        report.axeResults[url] = axeData;
        if (!report.urls.includes(url)) report.urls.push(url);

        const customData = await runCustomChecks(page, url);
        report.customResults.push(...customData);

        customData.forEach((r) => {
          if (r.status === 'pass') report.summary.pass++;
          else if (r.status === 'fail') report.summary.fail++;
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
  console.log(`\nSummary: ${report.summary.pass} pass, ${report.summary.warn} warn, ${report.summary.fail} fail`);
  console.log(`Axe violations: ${totalViolations}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
