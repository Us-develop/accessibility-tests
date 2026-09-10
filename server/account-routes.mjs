import {
  createUser,
  deleteUser,
  exportUserData,
  getPublicUserById,
  getUserById,
  setPassword,
  startPasswordReset,
  consumePasswordReset,
  updateContactDetails,
  verifyUserEmail,
} from './users.mjs';
import { attachRunToUser, deleteProjectsForUser, listProjectsForUser } from './projects.mjs';
import { clearSessionCookies, parseCookies, setSessionCookies } from './session.mjs';
import { isValidGuestToken } from './guest.mjs';
import { sendAccountEmail } from '../server-email.js';
import {
  currentPeriod,
  ensureFreeSubscription,
  getPlan,
  getUsage,
  listPayments,
} from './billing.mjs';
import { dbListRunsForUser, dbPool } from './db.js';
import { listRunsForDomain, scoreFromResult } from './audit-list.js';
import { REPORTS_BASE } from './paths.js';
import { isStrongPassword, verifyPassword } from './passwords.mjs';

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

function requireCustomer(req, res) {
  if (req.access?.role !== 'customer' || !req.access.userId) {
    res.status(401).json({ error: 'Sign in first.' });
    return null;
  }
  return req.access.userId;
}

function csvEscape(value) {
  const s = value == null ? '' : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

async function scansForUser(userId, limit = 200) {
  if (dbPool) {
    const rows = await dbListRunsForUser(userId, limit);
    return rows.map((row) => ({
      project_domain: row.domain,
      scan_date: row.updatedAt ? new Date(row.updatedAt).toISOString() : '',
      run_id: row.runId,
      pages_scanned: row.pages,
      score: scoreFromResult(row.resultJson),
      status: row.status || '',
    }));
  }
  const projects = await listProjectsForUser(userId);
  const out = [];
  for (const project of projects) {
    const runs = await listRunsForDomain(null, REPORTS_BASE, project.domain);
    const allowed = new Set(project.runIds || []);
    for (const run of runs) {
      if (allowed.size && !allowed.has(run.runId)) continue;
      out.push({
        project_domain: project.domain,
        scan_date: run.updatedAt ? new Date(run.updatedAt).toISOString() : '',
        run_id: run.runId,
        pages_scanned: run.pages,
        score: run.score ?? null,
        status: run.status || '',
      });
    }
  }
  out.sort((a, b) => String(b.scan_date).localeCompare(String(a.scan_date)));
  return out.slice(0, limit);
}

async function accountBundle(user) {
  const subscription = await ensureFreeSubscription(user.id);
  const plan = await getPlan(subscription.planId || 'free');
  const period = currentPeriod();
  const usage = await getUsage(user.id, period);
  const payments = await listPayments(user.id);
  const projects = await listProjectsForUser(user.id);
  const scans = await scansForUser(user.id, 50);
  return {
    role: user.role,
    user: await getPublicUserById(user.id),
    projects,
    plan,
    subscription,
    usage: {
      period,
      scansUsed: usage.scansUsed,
      pagesScanned: usage.pagesScanned,
      maxScansPerMonth: plan?.maxScansPerMonth ?? null,
      maxPagesPerScan: plan?.maxPagesPerScan ?? null,
      maxProjects: plan?.maxProjects ?? null,
    },
    payments,
    scans,
  };
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
          await attachRunToUser(user.id, binding.domain, binding.runId);
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

  app.get('/api/auth/verify', async (req, res) => {
    const user = await verifyUserEmail(String(req.query?.token || ''));
    if (!user) return res.status(400).send('Invalid or expired verification link.');
    setSessionCookies(res, { userId: user.id, role: user.role, email: user.email }, sameSiteFromEnv());
    return res.redirect('/account');
  });

  app.post('/api/auth/forgot', async (req, res) => {
    const started = await startPasswordReset(req.body?.email);
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
    const user = await consumePasswordReset(token);
    if (!user) return res.status(400).json({ error: 'Invalid or expired reset link.' });
    try {
      await setPassword(user.id, req.body?.password);
      return res.json({ ok: true });
    } catch (err) {
      return res.status(Number(err.status) || 400).json({ error: err.message });
    }
  });

  app.get('/api/account', async (req, res) => {
    if (req.access?.role === 'staff' && req.access.userId === 'staff') {
      return res.json({
        role: 'staff',
        user: { id: 'staff', email: req.access.email || 'staff', role: 'staff' },
        projects: [],
        plan: null,
        usage: null,
        payments: [],
        scans: [],
      });
    }
    const userId = requireCustomer(req, res);
    if (!userId) return;
    const user = await getUserById(userId);
    if (!user) return res.status(401).json({ error: 'Sign in first.' });
    return res.json(await accountBundle(user));
  });

  app.put('/api/account', async (req, res) => {
    const userId = requireCustomer(req, res);
    if (!userId) return;
    const user = await updateContactDetails(userId, req.body || {});
    if (!user) return res.status(401).json({ error: 'Sign in first.' });
    return res.json({ ok: true, user });
  });

  app.put('/api/account/password', async (req, res) => {
    const userId = requireCustomer(req, res);
    if (!userId) return;
    const user = await getUserById(userId);
    if (!user) return res.status(401).json({ error: 'Sign in first.' });
    const current = String(req.body?.currentPassword || '');
    const next = String(req.body?.password || req.body?.newPassword || '');
    const ok = await verifyPassword(current, user.passwordHash);
    if (!ok) return res.status(400).json({ error: 'Current password is incorrect.' });
    if (!isStrongPassword(next)) {
      return res.status(400).json({ error: 'Use a password of at least 10 characters.' });
    }
    try {
      await setPassword(user.id, next);
      return res.json({ ok: true });
    } catch (err) {
      return res.status(Number(err.status) || 400).json({ error: err.message });
    }
  });

  app.get('/api/account/usage', async (req, res) => {
    const userId = requireCustomer(req, res);
    if (!userId) return;
    const subscription = await ensureFreeSubscription(userId);
    const plan = await getPlan(subscription.planId || 'free');
    const period = currentPeriod();
    const usage = await getUsage(userId, period);
    return res.json({
      period,
      scansUsed: usage.scansUsed,
      pagesScanned: usage.pagesScanned,
      plan,
      subscription,
    });
  });

  app.get('/api/account/payments', async (req, res) => {
    const userId = requireCustomer(req, res);
    if (!userId) return;
    return res.json({ payments: await listPayments(userId) });
  });

  app.get('/api/account/scans', async (req, res) => {
    const userId = requireCustomer(req, res);
    if (!userId) return;
    const limit = Math.min(500, Math.max(1, Number(req.query?.limit) || 100));
    return res.json({ scans: await scansForUser(userId, limit) });
  });

  app.get('/api/account/export', async (req, res) => {
    const userId = requireCustomer(req, res);
    if (!userId) return;
    const user = await getUserById(userId);
    if (!user) return res.status(401).json({ error: 'Sign in first.' });
    const format = String(req.query?.format || 'json').toLowerCase();
    const scans = await scansForUser(userId, 1000);
    if (format === 'csv') {
      const header = 'project_domain,scan_date,run_id,pages_scanned,score,status';
      const lines = scans.map((row) =>
        [
          csvEscape(row.project_domain),
          csvEscape(row.scan_date),
          csvEscape(row.run_id),
          csvEscape(row.pages_scanned),
          csvEscape(row.score),
          csvEscape(row.status),
        ].join(',')
      );
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="us-accessibility-scans.csv"');
      return res.send([header, ...lines].join('\n'));
    }
    const payload = {
      ...exportUserData(user),
      projects: await listProjectsForUser(user.id),
      scans,
      usage: await getUsage(user.id, currentPeriod()),
      payments: await listPayments(user.id),
    };
    res.setHeader('Content-Disposition', 'attachment; filename="us-accessibility-export.json"');
    return res.json(payload);
  });

  app.post('/api/account/delete', async (req, res) => {
    const userId = requireCustomer(req, res);
    if (!userId) return;
    await deleteProjectsForUser(userId);
    await deleteUser(userId);
    clearSessionCookies(res, sameSiteFromEnv());
    return res.json({ ok: true });
  });

  app.post('/api/account/attach-guest', async (req, res) => {
    const userId = requireCustomer(req, res);
    if (!userId) return;
    const token = String(req.body?.guestToken || parseCookies(req).wcag_guest || '').trim();
    if (!isValidGuestToken(token)) return res.status(400).json({ error: 'Missing guest scan token.' });
    const binding = readGuestTokenRecord(token);
    if (!binding) return res.status(404).json({ error: 'That snapshot was not found.' });
    const project = await attachRunToUser(userId, binding.domain, binding.runId);
    return res.json({ ok: true, project });
  });
}
