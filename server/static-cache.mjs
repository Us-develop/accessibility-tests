/**
 * Cache-Control for Astro static files served by web/run-server.mjs.
 * @param {import('express').Response} res
 * @param {string} filePath
 */
export function setStaticAssetHeaders(res, filePath) {
  const p = String(filePath || '').replace(/\\/g, '/');
  if (p.includes('/_astro/')) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    return;
  }
  if (/\.(png|webp|woff2|svg)$/i.test(p)) {
    res.setHeader('Cache-Control', 'public, max-age=2592000');
  }
}
