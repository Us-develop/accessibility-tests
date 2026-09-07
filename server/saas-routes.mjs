import {
  authenticateUser,
  createUser,
  deleteUser,
  exportUserData,
  getPublicUserById,
  getUserById,
  hasActiveSubscription,
  setPassword,
  startPasswordReset,
  consumePasswordReset,
  verifyUserEmail,
} from './users.mjs';
import { attachRunToUser, deleteProjectsForUser, listProjectsForUser } from './projects.mjs';
import { creditSnapshot } from './credits.mjs';
import { clearSessionCookies, parseCookies, setSessionCookies } from './session.mjs';
import {
  createCheckoutSession,
  createPortalSession,
  handleStripeWebhook,
  pricingPublic,
  stripeConfigured,
  verifyStripeSignature,
} from './billing.mjs';
import { isValidGuestToken } from './guest.mjs';
import { sendAccountEmail } from '../server-email.js';

function publicBase() {
  return String(process.env.PUBLIC_BASE_URL || '').trim().replace(/\/$/, '') || 'http://localhost:3456';
}

function sameSiteFromEnv() {
  const raw = String(process.env.AUTH_COOKIE_SAMESITE || 'Lax').trim();
  return ['Lax', 'Strict', 'None'].includes(raw) ? raw : 'Lax';
}

/**
 * @param {import('express').Express} app
 * @param {{ AUTH_ENABLED: boolean; credentialsValid: Function }} ctx
 */
export function registerSaasRoutes(app, ctx) {
  const { AUTH_ENABLED, credentialsValid } = ctx;

  app.post('/api/auth/signup', async (req, res) => {
    try {
      const { user, verifyToken } = await createUser({
        email: req.body?.email,
        password: req.body?.password,
        name: req.body?.name,
      });
      const guestToken = String(req.body?.guestToken || '').trim();
      if (isValidGuestToken(guestToken)) {
        /* attach happens after subscribe; keep token on the session via cookie hint */
        res.append('Set-Cookie', `wcag_guest=${guestToken}; Path=/; Max-Age=1209600; SameSite=Lax`);
      }
      if (verifyToken) {
        const link = `${publicBase()}/api/auth/verify?token=${encodeURIComponent(verifyToken)}`;
        await sendAccountEmail({
          to: user.email,
          subject: 'Verify your Us accessibility account',
          text: `Confirm your email:\n${link}\n`,
        });
      } else {
        setSessionCookies(res, { userId: user.id, role: user.role, email: user.email }, sameSiteFromEnv());
      }
      return res.json({ ok: true, needsVerification: Boolean(verifyToken), user });
    } catch (err) {
      return res.status(Number(err.status) || 400).json({ error: err.message || 'Could not create account.' });
    }
  });

  app.get('/api/auth/verify', (req, res) => {
    const user = verifyUserEmail(String(req.query?.token || ''));
    if (!user) return res.status(400).send('Invalid or expired verification link.');
    setSessionCookies(res, { userId: user.id, role: user.role, email: user.email }, sameSiteFromEnv());
    return res.redirect('/account');
  });

  app.post('/api/auth/forgot', async (req, res) => {
    const started = startPasswordReset(req.body?.email);
    if (started) {
      const link = `${publicBase()}/reset?token=${encodeURIComponent(started.token)}`;
      await sendAccountEmail({
        to: started.user.email,
        subject: 'Reset your Us accessibility password',
        text: `Reset your password:\n${link}\nThis link expires in 2 hours.\n`,
      });
    }
    return res.json({ ok: true });
  });

  app.post('/api/auth/reset', async (req, res) => {
    const token = String(req.body?.token || '');
    const user = consumePasswordReset(token);
    if (!user) return res.status(400).json({ error: 'Invalid or expired reset link.' });
    try {
      await setPassword(user.id, req.body?.password);
      return res.json({ ok: true });
    } catch (err) {
      return res.status(Number(err.status) || 400).json({ error: err.message });
    }
  });

  app.get('/api/account', (req, res) => {
    if (req.access?.role === 'staff' && req.access.userId === 'staff') {
      return res.json({
        role: 'staff',
        user: { id: 'staff', email: 'staff', role: 'staff' },
        credits: creditSnapshot({ role: 'staff' }),
        projects: [],
        pricing: pricingPublic(),
      });
    }
    if (req.access?.role !== 'customer' || !req.access.userId) {
      return res.status(401).json({ error: 'Sign in first.' });
    }
    const user = getUserById(req.access.userId);
    if (!user) return res.status(401).json({ error: 'Sign in first.' });
    return res.json({
      role: user.role,
      user: getPublicUserById(user.id),
      credits: creditSnapshot(user),
      projects: listProjectsForUser(user.id),
      pricing: pricingPublic(),
      subscribed: hasActiveSubscription(user),
    });
  });

  app.get('/api/account/export', (req, res) => {
    if (req.access?.role !== 'customer' || !req.access.userId) {
      return res.status(401).json({ error: 'Sign in first.' });
    }
    const user = getUserById(req.access.userId);
    if (!user) return res.status(401).json({ error: 'Sign in first.' });
    const payload = {
      ...exportUserData(user),
      projects: listProjectsForUser(user.id),
      credits: creditSnapshot(user),
    };
    res.setHeader('Content-Disposition', 'attachment; filename="us-accessibility-export.json"');
    return res.json(payload);
  });

  app.post('/api/account/delete', (req, res) => {
    if (req.access?.role !== 'customer' || !req.access.userId) {
      return res.status(401).json({ error: 'Sign in first.' });
    }
    deleteProjectsForUser(req.access.userId);
    deleteUser(req.access.userId);
    clearSessionCookies(res, sameSiteFromEnv());
    return res.json({ ok: true });
  });

  app.post('/api/account/attach-guest', (req, res) => {
    if (req.access?.role !== 'customer' || !req.access.userId) {
      return res.status(401).json({ error: 'Sign in first.' });
    }
    const token = String(req.body?.guestToken || parseCookies(req).wcag_guest || '').trim();
    if (!isValidGuestToken(token)) return res.status(400).json({ error: 'Missing guest scan token.' });
    const { readGuestTokenRecord } = ctx;
    const binding = readGuestTokenRecord(token);
    if (!binding) return res.status(404).json({ error: 'That snapshot was not found.' });
    const project = attachRunToUser(req.access.userId, binding.domain, binding.runId);
    return res.json({ ok: true, project });
  });

  app.get('/api/pricing', (_req, res) => {
    res.json(pricingPublic());
  });

  app.post('/api/billing/checkout', async (req, res) => {
    if (!AUTH_ENABLED) return res.status(400).json({ error: 'Billing requires accounts.' });
    if (req.access?.role !== 'customer' || !req.access.userId) {
      return res.status(401).json({ error: 'Create an account first.' });
    }
    if (!stripeConfigured()) {
      return res.status(503).json({ error: 'Stripe is not configured yet. Set STRIPE_SECRET_KEY and STRIPE_PRICE_MONTHLY.' });
    }
    const user = getUserById(req.access.userId);
    if (!user) return res.status(401).json({ error: 'Create an account first.' });
    try {
      const guestToken = String(req.body?.guestToken || parseCookies(req).wcag_guest || '').trim();
      const session = await createCheckoutSession({
        user,
        interval: req.body?.interval === 'year' ? 'year' : 'month',
        guestToken,
      });
      return res.json({ url: session.url, id: session.id });
    } catch (err) {
      return res.status(Number(err.status) || 400).json({ error: err.message });
    }
  });

  app.post('/api/billing/portal', async (req, res) => {
    if (req.access?.role !== 'customer' || !req.access.userId) {
      return res.status(401).json({ error: 'Sign in first.' });
    }
    const user = getUserById(req.access.userId);
    if (!user) return res.status(401).json({ error: 'Sign in first.' });
    try {
      const session = await createPortalSession(user);
      return res.json({ url: session.url });
    } catch (err) {
      return res.status(Number(err.status) || 400).json({ error: err.message });
    }
  });

  app.post('/api/billing/webhook', async (req, res) => {
    const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : JSON.stringify(req.body || {});
    if (!verifyStripeSignature(raw, req.headers['stripe-signature'])) {
      return res.status(400).json({ error: 'Invalid Stripe signature.' });
    }
    let event;
    try {
      event = Buffer.isBuffer(req.body) ? JSON.parse(raw) : req.body;
    } catch {
      return res.status(400).json({ error: 'Invalid payload.' });
    }
    try {
      await handleStripeWebhook(event);
      return res.json({ received: true });
    } catch (err) {
      console.error('[stripe-webhook]', err?.message || err);
      return res.status(500).json({ error: 'Webhook handler failed.' });
    }
  });

  void credentialsValid;
}
