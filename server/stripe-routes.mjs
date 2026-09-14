import express from 'express';
import { getUserById } from './users.mjs';
import { asyncHandler } from './http-utils.mjs';
import { clientKey, rateLimit } from './rate-limit.mjs';
import {
  billingPublicConfig,
  constructWebhookEvent,
  createCheckoutSession,
  createPortalSession,
  handleStripeEvent,
  stripeConfigured,
} from './stripe.mjs';

function requireCustomer(req, res) {
  if (req.access?.role !== 'customer' || !req.access.userId) {
    res.status(401).json({ error: 'Sign in first.' });
    return null;
  }
  return req.access.userId;
}

function fail(res, err) {
  const status = Number(err?.status) || 500;
  return res.status(status).json({ error: err.message || 'Stripe request failed.' });
}

export function registerStripeWebhook(app) {
  app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), asyncHandler(async (req, res) => {
    const signature = String(req.headers['stripe-signature'] || '');
    try {
      const event = constructWebhookEvent(req.body, signature);
      await handleStripeEvent(event);
      return res.json({ received: true });
    } catch (err) {
      if (err?.status === 503) return fail(res, err);
      return res.status(400).json({ error: 'Invalid Stripe signature.' });
    }
  }));
}

export function registerStripeRoutes(app) {
  const billingLimit = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 20,
    keyFn: (req) => req.access?.userId || clientKey(req),
  });

  app.get('/api/billing/config', asyncHandler(async (_req, res) => {
    try {
      return res.json(await billingPublicConfig());
    } catch (err) {
      return fail(res, err);
    }
  }));

  app.post('/api/billing/checkout', billingLimit, asyncHandler(async (req, res) => {
    const userId = requireCustomer(req, res);
    if (!userId) return;
    if (!stripeConfigured()) {
      return res.status(503).json({ error: 'Stripe billing is not connected yet.' });
    }
    const user = await getUserById(userId);
    if (!user) return res.status(401).json({ error: 'Sign in first.' });
    try {
      const packId = String(req.body?.packId || '').trim();
      const planId = String(req.body?.planId || '').trim().toLowerCase();
      const kind = String(req.body?.kind || (packId ? 'pack' : 'pro')).trim().toLowerCase();
      const session = await createCheckoutSession({
        user,
        kind: (packId || kind === 'pack') ? 'pack' : 'pro',
        packId: packId || (planId.startsWith('pack_') ? planId : ''),
        interval: String(req.body?.interval || 'monthly').trim().toLowerCase(),
      });
      return res.json({ url: session.url, id: session.id });
    } catch (err) {
      return fail(res, err);
    }
  }));

  app.post('/api/billing/portal', billingLimit, asyncHandler(async (req, res) => {
    const userId = requireCustomer(req, res);
    if (!userId) return;
    if (!stripeConfigured()) {
      return res.status(503).json({ error: 'Stripe billing is not connected yet.' });
    }
    const user = await getUserById(userId);
    if (!user) return res.status(401).json({ error: 'Sign in first.' });
    try {
      const session = await createPortalSession({ user });
      return res.json({ url: session.url });
    } catch (err) {
      return fail(res, err);
    }
  }));
}
