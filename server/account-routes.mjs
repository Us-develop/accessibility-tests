import {
  createUser,
  deleteAccount,
  exportUserData,
  getPublicUserById,
  getUserById,
  setPassword,
  startPasswordReset,
  startEmailChange,
  consumePasswordReset,
  consumePendingEmailChange,
  updateContactDetails,
  verifyUserEmail,
  GENERIC_CREDENTIALS_ERROR,
  normalizeCustomerType,
} from './users.mjs';
import { attachRunToUser, listProjectsForUser } from './projects.mjs';
import { clearSessionCookies, isHtmlFormPost, parseCookies, setSessionCookies } from './session.mjs';
import { isValidGuestToken, guestFreebieClaimed, clientIp, deleteGuestTokenFile } from './guest.mjs';
import { sendAccountEmail } from '../server-email.js';
import { asyncHandler } from './http-utils.mjs';
import { clientKey, rateLimit } from './rate-limit.mjs';
import {
  currentPeriod,
  ensureCustomerSubscription,
  getPlan,
  getUsage,
  listPaymentsWithFreebie,
} from './billing.mjs';
import { ensureFreebieLot, getTokenBalance } from './tokens.mjs';
import { commercialCtas, isActiveProSubscription, PRO_PAGES_PER_MONTH } from './plan-catalog.mjs';
import { dbListRunsForUser, dbPool } from './db.js';
import { listRunsForDomain, scoreFromResult } from './audit-list.js';
import { REPORTS_BASE } from './paths.js';
import { isStrongPassword, verifyPassword } from './passwords.mjs';
import { recordConsent } from './consents.mjs';
import { LEGAL_PRIVACY_VERSION, LEGAL_TERMS_VERSION, isTruthyFlag } from './legal-versions.mjs';

function publicBase() {
  return String(process.env.PUBLIC_BASE_URL || '').trim().replace(/\/$/, '') || 'http://localhost:3456';
}

function formOrJson(req, res, htmlPath, jsonStatus, jsonBody) {
  if (isHtmlFormPost(req)) {
    return res.redirect(303, htmlPath);
  }
  if (jsonStatus && jsonStatus !== 200) {
    return res.status(jsonStatus).json(jsonBody);
  }
  return res.json(jsonBody);
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

export function csvEscape(value) {
  let s = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
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

async function accountBundle(user, req) {
  const subscription = await ensureCustomerSubscription(user.id, {
    guestFreebieUsed: guestFreebieClaimed(req),
  });
  const pro = isActiveProSubscription(subscription);
  const plan = await getPlan(pro ? subscription.planId : 'none');
  const period = currentPeriod();
  const usage = await getUsage(user.id, period);
  const payments = await listPaymentsWithFreebie(user.id);
  const projects = await listProjectsForUser(user.id);
  const scans = await scansForUser(user.id, 50);
  const tokens = await getTokenBalance(user.id);
  return {
    role: user.role,
    user: await getPublicUserById(user.id),
    projects,
    plan,
    subscription,
    tokens,
    ctas: commercialCtas(),
    usage: {
      period,
      scansUsed: usage.scansUsed,
      pagesScanned: usage.pagesScanned,
      maxScansPerMonth: plan?.maxScansPerMonth ?? null,
      maxPagesPerMonth: pro ? PRO_PAGES_PER_MONTH : 0,
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
  const signupIpLimit = rateLimit({ windowMs: 60 * 60 * 1000, max: 5, keyFn: clientKey });
  const forgotIpLimit = rateLimit({ windowMs: 60 * 60 * 1000, max: 5, keyFn: clientKey });
  const forgotEmailLimit = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 3,
    keyFn: (req) => String(req.body?.email || '').trim().toLowerCase() || 'anon',
  });
  const resetIpLimit = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, keyFn: clientKey });

  app.post('/api/auth/signup', signupIpLimit, asyncHandler(async (req, res) => {
    try {
      if (!isTruthyFlag(req.body?.acceptTerms)) {
        throw Object.assign(
          new Error('Accept the Terms of Service and Privacy Notice to create an account.'),
          { status: 400 }
        );
      }
      const buyingForBusiness =
        isTruthyFlag(req.body?.buyingForBusiness) ||
        normalizeCustomerType(req.body?.customerType) === 'business';
      const { user, verifyToken } = await createUser({
        email: req.body?.email,
        password: req.body?.password,
        name: req.body?.name,
        company: req.body?.company,
        vatNumber: req.body?.vatNumber || req.body?.vat_number,
        customerType: buyingForBusiness ? 'business' : 'consumer',
      });
      const consentMeta = {
        userId: user.id,
        email: user.email,
        ip: clientIp(req),
        userAgent: req.headers['user-agent'],
      };
      await recordConsent({
        ...consentMeta,
        kind: 'terms',
        version: LEGAL_TERMS_VERSION,
        context: { customerType: user.customerType },
      });
      await recordConsent({
        ...consentMeta,
        kind: 'privacy',
        version: LEGAL_PRIVACY_VERSION,
        context: { customerType: user.customerType },
      });
      const guestToken = String(req.body?.guestToken || '').trim();
      let attached = false;
      if (isValidGuestToken(guestToken)) {
        guestCookie(res, guestToken);
        const binding = readGuestTokenRecord(guestToken);
        if (binding?.domain && binding?.runId) {
          await attachRunToUser(user.id, binding.domain, binding.runId);
          deleteGuestTokenFile(guestToken);
          attached = true;
        }
      }
      const guestUsed = attached || guestFreebieClaimed(req);
      if (verifyToken) {
        if (guestUsed) {
          await ensureFreebieLot(user.id, { guestFreebieUsed: true });
        }
        const link = `${publicBase()}/api/auth/verify?token=${encodeURIComponent(verifyToken)}`;
        await sendAccountEmail({
          kind: 'verify',
          to: user.email,
          subject: 'Verify your Us accessibility account',
          text: `Confirm your email:\n${link}\n`,
        });
      } else {
        await ensureFreebieLot(user.id, {
          guestFreebieUsed: guestUsed,
        });
        setSessionCookies(res, { userId: user.id, role: user.role, email: user.email, ver: 1 }, sameSiteFromEnv());
      }
      const next = verifyToken ? '/signup?check-email=1' : '/account';
      return formOrJson(req, res, next, 200, { ok: true, needsVerification: Boolean(verifyToken), user });
    } catch (err) {
      return formOrJson(req, res, '/signup?error=1', Number(err.status) || 400, {
        error: err.status === 409 ? GENERIC_CREDENTIALS_ERROR : err.message || 'Could not create account.',
      });
    }
  }));

  app.get('/api/auth/verify', asyncHandler(async (req, res) => {
    const token = String(req.query?.token || '');
    const changed = await consumePendingEmailChange(token);
    if (changed) {
      setSessionCookies(
        res,
        { userId: changed.id, role: changed.role, email: changed.email, ver: changed.sessionVersion || 1 },
        sameSiteFromEnv()
      );
      return res.redirect('/account');
    }
    const user = await verifyUserEmail(token);
    if (!user) return res.status(400).send('Invalid or expired verification link.');
    setSessionCookies(res, { userId: user.id, role: user.role, email: user.email, ver: 1 }, sameSiteFromEnv());
    return res.redirect('/account');
  }));

  app.post('/api/auth/forgot', forgotIpLimit, forgotEmailLimit, asyncHandler(async (req, res) => {
    const started = await startPasswordReset(req.body?.email);
    if (started) {
      const link = `${publicBase()}/reset?token=${encodeURIComponent(started.token)}`;
      await sendAccountEmail({
        kind: 'reset',
        to: started.user.email,
        subject: 'Reset your Us accessibility password',
        text: `Reset your password:\n${link}\nThis link expires in 2 hours.\n`,
      });
    }
    return formOrJson(req, res, '/forgot?sent=1', 200, { ok: true });
  }));

  app.post('/api/auth/reset', resetIpLimit, asyncHandler(async (req, res) => {
    const token = String(req.body?.token || '');
    const user = await consumePasswordReset(token);
    if (!user) {
      return formOrJson(req, res, '/reset?error=1', 400, { error: 'Invalid or expired reset link.' });
    }
    try {
      await setPassword(user.id, req.body?.password);
      return formOrJson(req, res, '/', 200, { ok: true });
    } catch (err) {
      return formOrJson(req, res, '/reset?error=1', Number(err.status) || 400, {
        error: err.message,
      });
    }
  }));

  app.get('/api/account', asyncHandler(async (req, res) => {
    if (req.access?.role === 'staff' && req.access.userId === 'staff') {
      return res.json({
        role: 'staff',
        user: { id: 'staff', email: req.access.email || 'staff', role: 'staff' },
        projects: [],
        plan: null,
        usage: null,
        tokens: { tokens: 0, nextExpiresAt: null, lots: [] },
        payments: [],
        scans: [],
      });
    }
    const userId = requireCustomer(req, res);
    if (!userId) return;
    const user = await getUserById(userId);
    if (!user) return res.status(401).json({ error: 'Sign in first.' });
    return res.json(await accountBundle(user, req));
  }));

  app.put('/api/account', asyncHandler(async (req, res) => {
    const userId = requireCustomer(req, res);
    if (!userId) return;
    const user = await updateContactDetails(userId, req.body || {});
    if (!user) return res.status(401).json({ error: 'Sign in first.' });
    return res.json({ ok: true, user });
  }));

  app.put('/api/account/password', asyncHandler(async (req, res) => {
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
  }));

  app.get('/api/account/usage', asyncHandler(async (req, res) => {
    const userId = requireCustomer(req, res);
    if (!userId) return;
    const subscription = await ensureCustomerSubscription(userId);
    const pro = isActiveProSubscription(subscription);
    const plan = await getPlan(pro ? subscription.planId : 'none');
    const period = currentPeriod();
    const usage = await getUsage(userId, period);
    const tokens = await getTokenBalance(userId);
    return res.json({
      period,
      scansUsed: usage.scansUsed,
      pagesScanned: usage.pagesScanned,
      plan,
      subscription,
      tokens,
      ctas: commercialCtas(),
    });
  }));

  app.get('/api/account/payments', asyncHandler(async (req, res) => {
    const userId = requireCustomer(req, res);
    if (!userId) return;
    await ensureCustomerSubscription(userId, { guestFreebieUsed: guestFreebieClaimed(req) });
    return res.json({ payments: await listPaymentsWithFreebie(userId) });
  }));

  app.get('/api/account/scans', asyncHandler(async (req, res) => {
    const userId = requireCustomer(req, res);
    if (!userId) return;
    const limit = Math.min(500, Math.max(1, Number(req.query?.limit) || 100));
    return res.json({ scans: await scansForUser(userId, limit) });
  }));

  app.get('/api/account/export', asyncHandler(async (req, res) => {
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
      ...(await exportUserData(user)),
      projects: await listProjectsForUser(user.id),
      scans,
      usage: await getUsage(user.id, currentPeriod()),
      payments: await listPaymentsWithFreebie(user.id),
    };
    res.setHeader('Content-Disposition', 'attachment; filename="us-accessibility-export.json"');
    return res.json(payload);
  }));

  app.put('/api/account/email', asyncHandler(async (req, res) => {
    const userId = requireCustomer(req, res);
    if (!userId) return;
    const password = String(req.body?.password || req.body?.currentPassword || '');
    const nextEmail = req.body?.email || req.body?.newEmail;
    try {
      const started = await startEmailChange(userId, nextEmail, password);
      if (!started) return res.status(401).json({ error: 'Sign in first.' });
      const link = `${publicBase()}/api/auth/verify?token=${encodeURIComponent(started.token)}`;
      await sendAccountEmail({
        kind: 'email-change',
        to: started.pendingEmail,
        subject: 'Confirm your new Us accessibility email',
        text: `Confirm your new email address:\n${link}\nThis link expires in 48 hours.\n`,
      });
      await sendAccountEmail({
        kind: 'email-change-notice',
        to: started.previousEmail,
        subject: 'Your Us accessibility email is changing',
        text: 'Someone requested a change to the email on this account. If that was not you, reset your password. The current address stays active until the new one is confirmed.\n',
      });
      return res.json({ ok: true, pendingEmail: started.pendingEmail });
    } catch (err) {
      return res.status(Number(err.status) || 400).json({ error: err.message });
    }
  }));

  app.post('/api/account/delete', asyncHandler(async (req, res) => {
    const userId = requireCustomer(req, res);
    if (!userId) return;
    const user = await getUserById(userId);
    if (!user) return res.status(401).json({ error: 'Sign in first.' });
    const password = String(req.body?.password || req.body?.currentPassword || '');
    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) return res.status(400).json({ error: 'Password is incorrect.' });
    await deleteAccount(userId);
    clearSessionCookies(res, sameSiteFromEnv());
    return res.json({ ok: true });
  }));

  app.post('/api/account/attach-guest', asyncHandler(async (req, res) => {
    const userId = requireCustomer(req, res);
    if (!userId) return;
    const token = String(req.body?.guestToken || parseCookies(req).wcag_guest || '').trim();
    if (!isValidGuestToken(token)) return res.status(400).json({ error: 'Missing guest scan token.' });
    const binding = readGuestTokenRecord(token);
    if (!binding) return res.status(404).json({ error: 'That snapshot was not found.' });
    const project = await attachRunToUser(userId, binding.domain, binding.runId);
    deleteGuestTokenFile(token);
    await ensureFreebieLot(userId, { guestFreebieUsed: true });
    return res.json({ ok: true, project });
  }));
}
