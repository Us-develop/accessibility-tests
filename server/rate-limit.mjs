/**
 * In-memory rate limiter. Prunes expired keys on each call. No extra dependency.
 * `countFailures: true` does not increment on the way in. Call
 * `req.recordRateLimitHit()` (alias `recordRateLimitFailure`) after an outcome
 * that should count (failed logins, created accounts).
 * @param {{ windowMs: number, max: number, keyFn: (req: import('express').Request) => string, countFailures?: boolean, message?: string }} opts
 */
export function rateLimit({ windowMs, max, keyFn, countFailures = false, message = 'Too many requests.' }) {
  /** @type {Map<string, { count: number, resetAt: number }>} */
  const hits = new Map();

  return function rateLimitMiddleware(req, res, next) {
    if (String(process.env.WCAG_DISABLE_RATE_LIMIT || '').trim() === '1') return next();
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (entry.resetAt <= now) hits.delete(key);
    }
    const key = String(keyFn(req) || 'unknown');
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    const tooMany = () => {
      const retry = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retry));
      return res.status(429).json({ error: message });
    };
    const bump = () => {
      entry.count += 1;
    };
    if (countFailures) {
      if (entry.count >= max) return tooMany();
      const prev = req.recordRateLimitHit;
      req.recordRateLimitHit = () => {
        if (typeof prev === 'function') prev();
        bump();
      };
      req.recordRateLimitFailure = req.recordRateLimitHit;
      return next();
    }
    bump();
    if (entry.count > max) return tooMany();
    return next();
  };
}

export function clientKey(req) {
  return String(req.ip || 'unknown').slice(0, 128);
}
