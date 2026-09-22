import { randomUUID } from 'crypto';

/**
 * Express 4 does not catch rejections from async route handlers.
 * @param {(req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) => unknown} fn
 */
export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

/** 403 JSON unless the request already has a staff session (`req.access.role`). */
export function requireStaff(req, res, next) {
  if (req.access?.role !== 'staff') {
    return res.status(403).json({ error: 'Staff only.' });
  }
  return next();
}

export function debugEndpointsEnabled() {
  const raw = String(process.env.DEBUG_ENDPOINTS || '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(raw);
}

/** 404 JSON unless DEBUG_ENDPOINTS is enabled (default off). */
export function requireDebugEndpoints(req, res, next) {
  if (!debugEndpointsEnabled()) {
    return res.status(404).json({ error: 'Not found' });
  }
  return next();
}

function wrapIfAsync(fn) {
  if (typeof fn !== 'function') return fn;
  if (fn.length >= 4) return fn;
  if (fn.constructor?.name === 'AsyncFunction') return asyncHandler(fn);
  return fn;
}

/** Wrap async handlers registered after this call so throws become `next(err)`. */
export function patchAppAsyncHandlers(app) {
  for (const method of ['get', 'post', 'put', 'patch', 'delete', 'all']) {
    const original = app[method].bind(app);
    app[method] = (...args) => original(...args.map(wrapIfAsync));
  }
  const origUse = app.use.bind(app);
  app.use = (...args) => origUse(...args.map(wrapIfAsync));
}

export function requestIdMiddleware(req, res, next) {
  req.id = String(req.headers['x-request-id'] || '').trim() || randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
}

export const APP_CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self' https://challenges.cloudflare.com",
  "frame-src https://challenges.cloudflare.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self' https://checkout.stripe.com https://billing.stripe.com",
].join('; ');

export function securityHeadersMiddleware(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', APP_CONTENT_SECURITY_POLICY);
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
}

export function errorMiddleware(err, req, res, next) {
  if (res.headersSent) return next(err);
  const status = Number(err?.status);
  if (status >= 400 && status < 500) {
    const body = { error: err.message || 'Request failed.' };
    if (err.code) body.code = err.code;
    if (err.ctas) body.ctas = err.ctas;
    if (req.path?.startsWith('/api/') || req.path?.startsWith('/auth/')) {
      return res.status(status).json(body);
    }
    return res.status(status).type('txt').send(body.error);
  }
  console.error(`[${req.id || '-'}]`, err);
  if (req.path?.startsWith('/api/')) {
    return res.status(500).json({ error: 'Internal error' });
  }
  return res.status(500).type('txt').send('Internal error');
}

export function installProcessGuards() {
  if (globalThis.__wcagProcessGuards) return;
  globalThis.__wcagProcessGuards = true;
  process.on('unhandledRejection', (err) => {
    console.error('unhandledRejection', err);
    process.exit(1);
  });
  process.on('uncaughtException', (err) => {
    console.error('uncaughtException', err);
    process.exit(1);
  });
}
