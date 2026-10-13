/**
 * True for a same-site relative path that is safe to redirect to.
 *
 * Browsers read `\` as `/` and drop tabs and newlines inside URLs, so `/\evil.com`
 * and `/<TAB>/evil.com` both resolve to `//evil.com`, another site. No backslash
 * or control character is allowed anywhere, on top of the leading `//` check.
 *
 * Pure and dependency-free: imported by the server and by browser scripts.
 * @param {unknown} raw
 */
export function isSafeRelativePath(raw) {
  if (typeof raw !== 'string') return false;
  if (!raw.startsWith('/') || raw.startsWith('//')) return false;
  return !/[\\\u0000-\u001f\u007f]/.test(raw);
}
