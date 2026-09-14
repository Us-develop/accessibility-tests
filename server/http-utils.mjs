import { randomUUID } from 'crypto';

/**
 * Express 4 does not catch rejections from async route handlers.
 * @param {(req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) => unknown} fn
 */
export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
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

export function securityHeadersMiddleware(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('X-Frame-Options', 'DENY');
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
