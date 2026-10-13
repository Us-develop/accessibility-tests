/**
 * Helpers shared by the scan parent (server/create-app.mjs) and the Playwright
 * child (run-tests.js): how URLs are handed over, how long a scan may take, and
 * how redirect hops are checked.
 */

function intEnv(env, name, defaultValue, min, max) {
  const n = parseInt(String(env[name] ?? ''), 10);
  if (!Number.isFinite(n)) return defaultValue;
  return Math.min(Math.max(n, min), max);
}

/**
 * URL list typed on the command line (`--urls="a,b c"`): commas, spaces and
 * newlines all separate. Only for humans; the server never uses this path
 * because a comma is legal inside a URL.
 * @param {string} text
 */
export function parseCliUrlList(text) {
  return String(text || '')
    .split(/[\n,\s]+/)
    .map((u) => u.trim())
    .filter((u) => u && u.startsWith('http'));
}

/**
 * URL list sent by the server on stdin: a JSON array, used exactly as given.
 * Each entry was validated by the server, so it must not be split again.
 * @param {string} text
 */
export function parseUrlsJson(text) {
  let parsed;
  try {
    parsed = JSON.parse(String(text || ''));
  } catch {
    throw new Error('Scan URL list on stdin is not valid JSON.');
  }
  if (!Array.isArray(parsed) || parsed.some((u) => typeof u !== 'string')) {
    throw new Error('Scan URL list on stdin must be a JSON array of strings.');
  }
  return parsed.filter((u) => /^https?:\/\//i.test(u));
}

/** @param {NodeJS.ReadableStream} stream */
export async function readStream(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Budget for one page in the child: navigation plus axe plus every custom check.
 * Always leaves at least a minute after the navigation timeout.
 * @param {NodeJS.ProcessEnv} [env]
 */
export function pageScanTimeoutMs(env = process.env) {
  const goto = intEnv(env, 'PAGE_GOTO_TIMEOUT_MS', 90_000, 30_000, 300_000);
  const budget = intEnv(env, 'PAGE_SCAN_TIMEOUT_MS', 240_000, 60_000, 900_000);
  return Math.max(budget, goto + 60_000);
}

/**
 * Wall-clock limit for the whole child process, enforced by the parent.
 * Default: every page uses its full budget, plus two minutes for browser start
 * and report generation. SCAN_PROCESS_TIMEOUT_MS overrides it.
 * @param {number} urlCount
 * @param {NodeJS.ProcessEnv} [env]
 */
export function scanProcessTimeoutMs(urlCount, env = process.env) {
  const override = parseInt(String(env.SCAN_PROCESS_TIMEOUT_MS ?? ''), 10);
  if (Number.isFinite(override) && override > 0) return Math.max(override, 1000);
  const concurrency = intEnv(env, 'URL_CONCURRENCY', 1, 1, 8);
  const rounds = Math.ceil(Math.max(1, Number(urlCount) || 1) / concurrency);
  return rounds * pageScanTimeoutMs(env) + 120_000;
}

/**
 * Reject with `message` if `promise` has not settled after `ms`.
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @param {string} message
 * @returns {Promise<T>}
 */
export function withDeadline(promise, ms, message) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

export const BLOCKED_REDIRECT_MESSAGE =
  'Blocked: this page redirected a request to a non-public address, so it was not scanned.';

/**
 * Playwright only runs route handlers for the first request of a chain; later
 * redirect hops are followed by the browser without asking. This watches the
 * `request` event instead, checks every hop, and remembers the first one that
 * leaves the public internet so the page can be dropped before anything from
 * it reaches the report.
 *
 * @param {(url: string) => Promise<boolean>} isBlocked
 */
export function createRedirectWatch(isBlocked) {
  let blockedUrl = null;
  const pending = new Set();
  return {
    /** @param {{ url(): string, redirectedFrom(): unknown }} request */
    onRequest(request) {
      if (!request.redirectedFrom()) return;
      const url = request.url();
      const check = Promise.resolve()
        .then(() => isBlocked(url))
        .then((blocked) => {
          if (blocked && !blockedUrl) blockedUrl = url;
        })
        .catch(() => {
          if (!blockedUrl) blockedUrl = url;
        })
        .finally(() => pending.delete(check));
      pending.add(check);
    },
    /** Throws when any hop seen so far was blocked. */
    async assertClean() {
      while (pending.size) await Promise.all([...pending]);
      if (blockedUrl) throw new Error(BLOCKED_REDIRECT_MESSAGE);
    },
  };
}

/** Last part of the child's stderr, for the server log only. */
export function tailForLog(text, maxChars = 4000) {
  const s = String(text || '');
  return s.length > maxChars ? `…${s.slice(-maxChars)}` : s;
}
