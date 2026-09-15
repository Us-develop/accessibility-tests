import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const tmp = mkdtempSync(join(tmpdir(), 'wcag-seo-'));
process.env.REPORTS_BASE = tmp;
process.env.AUTH_ENABLED = 'true';
process.env.APP_USERNAME = 'root';
process.env.APP_PASSWORD = 'staff-secret-pass';
process.env.SESSION_SECRET = 'unit-test-session-secret-32chars!!';
process.env.WCAG_DISABLE_RATE_LIMIT = '1';
process.env.AUTH_EMAIL_VERIFY = 'auto';
process.env.DEFER_ROOT_LOGIN_TO_SHELL = 'true';
process.env.PUBLIC_BASE_URL = 'https://wcag.example';

const { createAccessibilityApp } = await import('../server/create-app.mjs');
const { INDEXABLE_PATHS, isIndexablePath, normalizeIndexablePath } = await import(
  '../server/indexable-paths.mjs'
);
const { robotsTxt, sitemapXml } = await import('../server/seo-routes.mjs');
const { setStaticAssetHeaders } = await import('../server/static-cache.mjs');
const { LEGAL_PRIVACY_VERSION, LEGAL_TERMS_VERSION } = await import('../server/legal-versions.mjs');

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

after(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function listen(app) {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({ server, origin: `http://127.0.0.1:${addr.port}` });
    });
  });
}

const FONT_CDN_RE = /typekit\.net|fonts\.googleapis\.com|fonts\.gstatic\.com/i;
const TEXT_EXTS = new Set(['.html', '.css', '.js', '.mjs', '.cjs', '.json', '.svg', '.xml', '.txt', '.map']);

function walkFiles(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walkFiles(full, out);
    else out.push(full);
  }
  return out;
}

describe('indexable paths', () => {
  it('normalizes trailing slashes and query strings', () => {
    assert.equal(normalizeIndexablePath('/pricing/?utm=1'), '/pricing');
    assert.equal(normalizeIndexablePath('/privacy/'), '/privacy');
    assert.equal(normalizeIndexablePath('/?ref=home'), '/');
    assert.equal(normalizeIndexablePath('/legal/subprocessors?x=1'), '/legal/subprocessors');
  });

  it('indexes only the public marketing set', () => {
    for (const path of INDEXABLE_PATHS) {
      assert.equal(isIndexablePath(path), true, path);
      assert.equal(isIndexablePath(`${path}/`), true, `${path}/`);
    }
    assert.equal(isIndexablePath('/teaser/abc'), false);
    assert.equal(isIndexablePath('/signup'), false);
    assert.equal(isIndexablePath('/verify'), false);
    assert.equal(isIndexablePath('/forgot'), false);
    assert.equal(isIndexablePath('/reset'), false);
    assert.equal(isIndexablePath('/loading'), false);
    assert.equal(isIndexablePath('/account'), false);
    assert.equal(isIndexablePath('/audits'), false);
  });
});

describe('robots, sitemap, and X-Robots-Tag', () => {
  it('lists Allow /, the six Disallow prefixes, and a sitemap line', () => {
    const body = robotsTxt('https://wcag.example');
    assert.match(body, /User-agent: \*/);
    assert.match(body, /^Allow: \/$/m);
    assert.match(body, /^Disallow: \/api\/$/m);
    assert.match(body, /^Disallow: \/report\/$/m);
    assert.match(body, /^Disallow: \/audits$/m);
    assert.match(body, /^Disallow: \/admin\/$/m);
    assert.match(body, /^Disallow: \/account$/m);
    assert.match(body, /^Disallow: \/teaser\/$/m);
    assert.match(body, /^Sitemap: https:\/\/wcag\.example\/sitemap\.xml$/m);
    assert.doesNotMatch(body, /Allow: \/teaser\//);
  });

  it('sitemaps only the indexable set with legal lastmod dates', () => {
    const xml = sitemapXml('https://wcag.example');
    for (const path of INDEXABLE_PATHS) {
      const loc = path === '/' ? 'https://wcag.example/' : `https://wcag.example${path}`;
      assert.match(xml, new RegExp(`<loc>${loc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</loc>`));
    }
    assert.doesNotMatch(xml, /\/teaser\//);
    assert.doesNotMatch(xml, /\/signup/);
    assert.match(xml, new RegExp(`<lastmod>${LEGAL_TERMS_VERSION}</lastmod>`));
    assert.match(xml, new RegExp(`<lastmod>${LEGAL_PRIVACY_VERSION}</lastmod>`));
  });

  it('serves robots, sitemap, and noindex headers over HTTP', async () => {
    const app = createAccessibilityApp(repoRoot);
    const { server, origin } = await listen(app);
    try {
      const robots = await fetch(`${origin}/robots.txt`);
      assert.equal(robots.status, 200);
      const robotsBody = await robots.text();
      assert.match(robotsBody, /Sitemap: https:\/\/wcag\.example\/sitemap\.xml/);
      assert.match(robotsBody, /Disallow: \/teaser\//);

      const sitemap = await fetch(`${origin}/sitemap.xml`);
      assert.equal(sitemap.status, 200);
      const xml = await sitemap.text();
      assert.match(xml, /<loc>https:\/\/wcag\.example\/pricing<\/loc>/);
      assert.doesNotMatch(xml, /\/teaser\//);

      const teaser = await fetch(`${origin}/teaser/not-a-real-token`, { redirect: 'manual' });
      assert.match(String(teaser.headers.get('x-robots-tag') || ''), /noindex/);

      const home = await fetch(`${origin}/`, { redirect: 'manual' });
      assert.equal(home.headers.get('x-robots-tag'), null);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

describe('static cache headers', () => {
  it('marks hashed Astro assets immutable and media for 30 days', () => {
    const headers = {};
    const res = { setHeader(name, value) { headers[name] = value; } };
    setStaticAssetHeaders(res, '/var/app/web/dist/client/_astro/index.abc123.js');
    assert.equal(headers['Cache-Control'], 'public, max-age=31536000, immutable');

    const media = {};
    setStaticAssetHeaders({ setHeader(name, value) { media[name] = value; } }, '/var/app/web/dist/client/fonts/public-sans-400-normal.woff2');
    assert.equal(media['Cache-Control'], 'public, max-age=2592000');

    const other = {};
    setStaticAssetHeaders({ setHeader(name, value) { other[name] = value; } }, '/var/app/web/dist/client/index.html');
    assert.equal(other['Cache-Control'], undefined);
  });
});

describe('page SEO markup', () => {
  it('gives every Astro page a description and noindex marketing pages correctly', () => {
    const pagesDir = join(repoRoot, 'web/src/pages');
    const pages = walkFiles(pagesDir).filter((file) => file.endsWith('.astro'));
    assert.ok(pages.length >= 8);
    for (const file of pages) {
      const text = readFileSync(file, 'utf8');
      assert.match(text, /description=/, file.replace(repoRoot + '/', ''));
    }
    const teaser = readFileSync(join(pagesDir, 'teaser/[token].astro'), 'utf8');
    assert.match(teaser, /noindex=\{true\}/);
    assert.match(teaser, /Astro\.response\.status = 404/);
    assert.match(teaser, /client:visible/);
    assert.doesNotMatch(teaser, /GuestLeadForm client:load/);
  });
});

describe('self-hosted fonts', () => {
  it('does not request Typekit or Google Fonts from shipped sources', () => {
    const sources = [
      join(repoRoot, 'web/src/layouts/Layout.astro'),
      join(repoRoot, 'web/public/styles/tokens.css'),
      join(repoRoot, 'server/create-app.mjs'),
      join(repoRoot, 'report-brand.js'),
      join(repoRoot, 'generate-deliverables.js'),
    ];
    for (const file of sources) {
      const text = readFileSync(file, 'utf8');
      assert.equal(FONT_CDN_RE.test(text), false, file);
    }
  });

  it('fails if the built web/dist still references font CDNs', () => {
    const dist = join(repoRoot, 'web/dist');
    assert.equal(existsSync(dist), true, 'web/dist is missing — run npm run build --prefix web');
    const hits = [];
    for (const file of walkFiles(dist)) {
      if (!TEXT_EXTS.has(extname(file).toLowerCase())) continue;
      const text = readFileSync(file, 'utf8');
      if (FONT_CDN_RE.test(text)) hits.push(file.replace(repoRoot + '/', ''));
    }
    assert.deepEqual(hits, []);
  });
});
