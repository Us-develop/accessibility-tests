#!/usr/bin/env node
/**
 * Accessibility Test Runner
 * Usage: node run-tests.js [--report] [--urls "url1,url2,..."] [--output-id <id>]
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
  return null;
}

function parseOutputId() {
  const arg = process.argv.find((a) => a.startsWith('--output-id='));
  if (arg) return arg.replace('--output-id=', '').trim();
  const idx = process.argv.indexOf('--output-id');
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  return null;
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

async function applyConsentForScreenshots(page, url) {
  try {
    const u = new URL(url);
    const domain = u.hostname.replace(/^www\./, '');
    // Common Cookiebot consent cookie payload (allows all categories).
    const consentValue = encodeURIComponent(
      JSON.stringify({
        stamp: 'automated-a11y-run',
        necessary: true,
        preferences: true,
        statistics: true,
        marketing: true,
        method: 'explicit',
        ver: 1,
        utc: new Date().toISOString(),
        region: 'all',
      })
    );
    await page.context().addCookies([
      {
        name: 'CookieConsent',
        value: consentValue,
        domain: `.${domain}`,
        path: '/',
        secure: true,
        httpOnly: false,
        sameSite: 'Lax',
      },
    ]);
  } catch {
    // Non-fatal: some hosts/URLs may not accept cookie injection.
  }

  // Fallback: try clicking common "accept all" selectors for consent managers.
  const selectors = [
    '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
    '#CybotCookiebotDialogBodyButtonAccept',
    'button[data-cookiebanner="accept_button"]',
    '[data-testid="uc-accept-all-button"]',
    '#onetrust-accept-btn-handler',
    'button[aria-label*="Accept"]',
    'button:has-text("Accept all")',
    'button:has-text("Allow all")',
    'button:has-text("I agree")',
  ];
  for (const sel of selectors) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 1000 })) {
        await btn.click({ timeout: 1500 });
        break;
      }
    } catch {
      // Ignore and try next selector.
    }
  }
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

async function main() {
  const urls = await getUrls();
  const outputId = parseOutputId();
  const generateReport = process.argv.includes('--report');

  if (!urls || urls.length === 0) {
    console.error('No URLs. Use --urls="url1,url2" or configure urls.config.js');
    process.exit(1);
  }

  const OUTPUT_DIR = outputId ? join(REPORTS_BASE, outputId) : join(REPORTS_BASE, 'latest');
  const RESULTS_FILE = join(OUTPUT_DIR, 'accessibility-results.json');

  if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log('Starting accessibility tests...');
  console.log(`URLs to test: ${urls.length}`);

  const report = {
    generatedAt: new Date().toISOString(),
    urls: [],
    axeResults: {},
    customResults: [],
    summary: { pass: 0, fail: 0, warn: 0 },
    screenshots: {},
  };

  const SCREENSHOTS_DIR = join(OUTPUT_DIR, 'screenshots');
  const SCREENSHOT_VIEWPORT = { width: 1366, height: 768, label: 'Desktop', suffix: 'desktop' };

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
    for (const url of urls) {
      console.log(`\nTesting: ${url}`);
      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport: { width: VIEWPORTS[0].width, height: VIEWPORTS[0].height },
      });
      const page = await context.newPage();

      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForLoadState('networkidle').catch(() => {});

        const axeData = await runAxeScan(page, url);
        report.axeResults[url] = axeData;
        report.urls.push(url);

        const customData = await runCustomChecks(page, url);
        report.customResults.push(...customData);

        customData.forEach((r) => {
          if (r.status === 'pass') report.summary.pass++;
          else if (r.status === 'fail') report.summary.fail++;
          else report.summary.warn++;
        });

        const hasIssues =
          (axeData.violations && axeData.violations.length > 0) ||
          customData.some((r) => r.status === 'fail' || r.status === 'warn');
        if (hasIssues) {
          if (!existsSync(SCREENSHOTS_DIR)) mkdirSync(SCREENSHOTS_DIR, { recursive: true });
          const urlIndex = report.urls.length - 1;
          try {
            await applyConsentForScreenshots(page, url);
            await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
            await page.waitForLoadState('networkidle').catch(() => {});
            await page.setViewportSize({ width: SCREENSHOT_VIEWPORT.width, height: SCREENSHOT_VIEWPORT.height });
            const screenshotFile = `screenshot-${urlIndex}-${SCREENSHOT_VIEWPORT.suffix}.png`;
            const screenshotPath = join(SCREENSHOTS_DIR, screenshotFile);
            await page.screenshot({ path: screenshotPath, fullPage: false });
            report.screenshots[url] = {
              file: screenshotFile,
              label: `${SCREENSHOT_VIEWPORT.label} (${SCREENSHOT_VIEWPORT.width}×${SCREENSHOT_VIEWPORT.height})`,
            };
          } catch (e) {
            console.error(`  Screenshot failed: ${e.message}`);
          }
        }
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
    }
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
