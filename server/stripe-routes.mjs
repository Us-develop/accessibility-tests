import express from 'express';
import { getUserById } from './users.mjs';
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
  app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const signature = String(req.headers['stripe-signature'] || '');
    try {
      const event = constructWebhookEvent(req.body, signature);
      await handleStripeEvent(event);
      return res.json({ received: true });
    } catch (err) {
      if (err?.status === 503) return fail(res, err);
      return res.status(400).json({ error: 'Invalid Stripe signature.' });
    }
  });
}

export function registerStripeRoutes(app) {
  app.get('/api/billing/config', async (_req, res) => {
    try {
      return res.json(await billingPublicConfig());
    } catch (err) {
      return fail(res, err);
    }
  });

  app.post('/api/billing/checkout', async (req, res) => {
    const userId = requireCustomer(req, res);
    if (!userId) return;
    if (!stripeConfigured()) {
      return res.status(503).json({ error: 'Stripe billing is not connected yet.' });
    }
    const user = await getUserById(userId);
    if (!user) return res.status(401).json({ error: 'Sign in first.' });
    try {
      const session = await createCheckoutSession({
        user,
        planId: String(req.body?.planId || '').trim().toLowerCase(),
      });
      return res.json({ url: session.url, id: session.id });
    } catch (err) {
      return fail(res, err);
    }
  });

  app.post('/api/billing/portal', async (req, res) => {
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
  });
}
