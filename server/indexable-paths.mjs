/** Public marketing URLs that search engines may index. */

export const INDEXABLE_PATHS = [
  '/',
  '/pricing',
  '/limitations',
  '/terms',
  '/privacy',
  '/cookies',
  '/accessibility',
  '/legal/subprocessors',
];

const INDEXABLE_SET = new Set(INDEXABLE_PATHS);

/**
 * Drop query strings and trailing slashes so `/pricing/?utm=1` matches `/pricing`.
 * @param {string} pathname
 */
export function normalizeIndexablePath(pathname) {
  const raw = String(pathname || '');
  const noQuery = raw.split('#')[0].split('?')[0];
  if (!noQuery || noQuery === '/') return '/';
  const trimmed = noQuery.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

const INDEXABLE_RE =
  /^\/$|^\/(pricing|limitations|terms|privacy|cookies|accessibility|legal\/subprocessors)$/;

/** Prefix/regex match over the indexable set after path normalization. */
export function isIndexablePath(pathname) {
  const p = normalizeIndexablePath(pathname);
  return INDEXABLE_SET.has(p) && INDEXABLE_RE.test(p);
}
