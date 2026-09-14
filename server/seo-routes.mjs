import { LEGAL_PRIVACY_VERSION, LEGAL_TERMS_VERSION } from './legal-versions.mjs';
import { publicBaseUrl } from './config.mjs';
import { INDEXABLE_PATHS, isIndexablePath } from './indexable-paths.mjs';

const ROBOTS_DISALLOW = ['/api/', '/report/', '/audits', '/admin/', '/account', '/teaser/'];

function originFromHost(host = publicBaseUrl()) {
  return String(host || '').replace(/\/$/, '');
}

export function robotsTxt(host = publicBaseUrl()) {
  const origin = originFromHost(host);
  return [
    'User-agent: *',
    'Allow: /',
    ...ROBOTS_DISALLOW.map((path) => `Disallow: ${path}`),
    '',
    `Sitemap: ${origin}/sitemap.xml`,
    '',
  ].join('\n');
}

function lastmodForPath(path) {
  if (path === '/terms') return LEGAL_TERMS_VERSION;
  if (path === '/privacy' || path === '/cookies') return LEGAL_PRIVACY_VERSION;
  return LEGAL_TERMS_VERSION >= LEGAL_PRIVACY_VERSION ? LEGAL_TERMS_VERSION : LEGAL_PRIVACY_VERSION;
}

export function sitemapXml(host = publicBaseUrl()) {
  const origin = originFromHost(host);
  const urls = INDEXABLE_PATHS.map((path) => {
    const loc = path === '/' ? `${origin}/` : `${origin}${path}`;
    return [
      '  <url>',
      `    <loc>${loc}</loc>`,
      `    <lastmod>${lastmodForPath(path)}</lastmod>`,
      '  </url>',
    ].join('\n');
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

export function registerSeoRoutes(app) {
  app.use((req, res, next) => {
    if (!isIndexablePath(req.originalUrl || req.path)) {
      res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet, noimageindex');
    }
    next();
  });
  app.get('/robots.txt', (_req, res) => {
    res.type('text/plain');
    res.send(robotsTxt());
  });
  app.get('/sitemap.xml', (_req, res) => {
    res.type('application/xml');
    res.send(sitemapXml());
  });
}
