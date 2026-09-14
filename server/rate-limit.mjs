/**
 * In-memory rate limiter. Prunes expired keys on each call. No extra dependency.
 * @param {{ windowMs: number, max: number, keyFn: (req: import('express').Request) => string }} opts
 */
export function rateLimit({ windowMs, max, keyFn }) {
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
    entry.count += 1;
    if (entry.count > max) {
      const retry = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retry));
      return res.status(429).json({ error: 'Too many requests.' });
    }
    return next();
  };
}

export function clientKey(req) {
  return String(req.ip || 'unknown').slice(0, 128);
}
