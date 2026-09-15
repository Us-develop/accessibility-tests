import express from 'express';
import { getUserById } from './users.mjs';
import { asyncHandler } from './http-utils.mjs';
import { clientKey, rateLimit } from './rate-limit.mjs';
import { recordConsent } from './consents.mjs';
import { clientIp } from './guest.mjs';
import { LEGAL_TERMS_VERSION, isTruthyFlag } from './legal-versions.mjs';
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
  if (err?.message) console.error('[stripe]', err.message);
  return res.status(status).json({ error: 'Stripe request failed.' });
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
      const message = String(err?.message || '');
      const signatureError =
        err?.type === 'StripeSignatureVerificationError' || /signature/i.test(message);
      if (signatureError) {
        return res.status(400).json({ error: 'Invalid Stripe signature.' });
      }
      console.error('[stripe webhook]', err?.message || err);
      return res.status(500).json({ error: 'Webhook handler failed.' });
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
    const user = await getUserById(userId);
    if (!user) return res.status(401).json({ error: 'Sign in first.' });
    if (!isTruthyFlag(req.body?.withdrawalWaiver)) {
      return res.status(400).json({
        error:
          'Confirm that you request immediate delivery and acknowledge losing the 14-day withdrawal right.',
      });
    }
    if (!stripeConfigured()) {
      return res.status(503).json({ error: 'Stripe billing is not connected yet.' });
    }
    try {
      const packId = String(req.body?.packId || '').trim();
      const planId = String(req.body?.planId || '').trim().toLowerCase();
      const kind = String(req.body?.kind || (packId ? 'pack' : 'pro')).trim().toLowerCase();
      const checkoutKind = packId || kind === 'pack' ? 'pack' : 'pro';
      const interval = String(req.body?.interval || 'monthly').trim().toLowerCase();
      const session = await createCheckoutSession({
        user,
        kind: checkoutKind,
        packId: packId || (planId.startsWith('pack_') ? planId : ''),
        interval,
      });
      await recordConsent({
        userId: user.id,
        email: user.email,
        kind: 'withdrawal_waiver',
        version: LEGAL_TERMS_VERSION,
        ip: clientIp(req),
        userAgent: req.headers['user-agent'],
        context: {
          packId: checkoutKind === 'pack' ? packId || (planId.startsWith('pack_') ? planId : '') : '',
          planId: checkoutKind === 'pro' ? 'pro' : '',
          interval: checkoutKind === 'pro' ? interval : '',
          customerType: user.customerType || 'consumer',
          checkoutSessionId: session.id,
        },
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
