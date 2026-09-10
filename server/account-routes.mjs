import {
  createUser,
  deleteUser,
  exportUserData,
  getPublicUserById,
  getUserById,
  setPassword,
  startPasswordReset,
  consumePasswordReset,
  verifyUserEmail,
} from './users.mjs';
import { attachRunToUser, deleteProjectsForUser, listProjectsForUser } from './projects.mjs';
import { clearSessionCookies, parseCookies, setSessionCookies } from './session.mjs';
import { isValidGuestToken } from './guest.mjs';
import { sendAccountEmail } from '../server-email.js';

function publicBase() {
  return String(process.env.PUBLIC_BASE_URL || '').trim().replace(/\/$/, '') || 'http://localhost:3456';
}

function sameSiteFromEnv() {
  const raw = String(process.env.AUTH_COOKIE_SAMESITE || 'Lax').trim();
  return ['Lax', 'Strict', 'None'].includes(raw) ? raw : 'Lax';
}

function guestCookie(res, guestToken) {
  res.append('Set-Cookie', `wcag_guest=${guestToken}; Path=/; Max-Age=1209600; SameSite=Lax`);
}

/**
 * @param {import('express').Express} app
 * @param {{ readGuestTokenRecord: Function }} ctx
 */
export function registerAccountRoutes(app, ctx) {
  const { readGuestTokenRecord } = ctx;

  app.post('/api/auth/signup', async (req, res) => {
    try {
      const { user, verifyToken } = await createUser({
        email: req.body?.email,
        password: req.body?.password,
        name: req.body?.name,
      });
      const guestToken = String(req.body?.guestToken || '').trim();
      if (isValidGuestToken(guestToken)) {
        guestCookie(res, guestToken);
        const binding = readGuestTokenRecord(guestToken);
        if (binding?.domain && binding?.runId) {
          attachRunToUser(user.id, binding.domain, binding.runId);
        }
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
        user: { id: 'staff', email: req.access.email || 'staff', role: 'staff' },
        projects: [],
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
      projects: listProjectsForUser(user.id),
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
    const binding = readGuestTokenRecord(token);
    if (!binding) return res.status(404).json({ error: 'That snapshot was not found.' });
    const project = attachRunToUser(req.access.userId, binding.domain, binding.runId);
    return res.json({ ok: true, project });
  });
}
