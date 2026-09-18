/**
 * Outbound mail: Brevo transactional templates when configured, SMTP otherwise.
 */
import { randomBytes } from 'crypto';
import nodemailer from 'nodemailer';

const BREVO_SMTP_EMAIL_URL = 'https://api.brevo.com/v3/smtp/email';
const BREVO_TIMEOUT_MS = 10_000;

/** @type {null | (() => object | null)} */
let smtpTransportFactory = null;

/**
 * Test-only seam so unit tests can capture SMTP payloads without a network hop.
 * @param {null | (() => object | null)} factory
 */
export function setSmtpTransportFactory(factory) {
  smtpTransportFactory = factory;
}

export function createSmtpTransport() {
  if (typeof smtpTransportFactory === 'function') return smtpTransportFactory();
  const host = process.env.SMTP_HOST;
  if (!host || typeof host !== 'string') return null;
  return nodemailer.createTransport({
    host,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    requireTLS: true,
    auth: process.env.SMTP_USER
      ? {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASSWORD || '',
        }
      : undefined,
  });
}

export function assertProductionMailFrom() {
  if (process.env.NODE_ENV !== 'production') return;
  const from = String(process.env.MAIL_FROM || '').trim();
  if (!from || /@localhost$/i.test(from)) {
    throw new Error(
      'MAIL_FROM is required in production and must not end with @localhost (see .env.example).'
    );
  }
}

function recipientDomain(to) {
  const at = String(to || '').lastIndexOf('@');
  if (at === -1) return '';
  return String(to).slice(at + 1).toLowerCase();
}

function newMessageId() {
  return `<${randomBytes(12).toString('hex')}@us-accessibility>`;
}

function logSkippedMail({ kind, to, messageId }) {
  console.warn('[email]', { kind, domain: recipientDomain(to), messageId });
}

export function logMailFailure(kind, to, err) {
  console.warn('[email] failed', {
    kind,
    domain: recipientDomain(to),
    code: err && err.code ? String(err.code) : '',
  });
}

function str(value) {
  if (value == null) return '';
  return String(value);
}

function parsePositiveInt(raw) {
  const n = Number.parseInt(String(raw || '').trim(), 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function brevoApiKey() {
  return String(process.env.BREVO_API_KEY || '').trim();
}

function redactSecret(text, secret) {
  const raw = String(text || '');
  if (!secret) return raw;
  return raw.split(secret).join('[redacted]');
}

function brevoError(message) {
  const err = new Error(redactSecret(message, brevoApiKey()) || 'Brevo request failed');
  err.code = 'EBREVO';
  return err;
}

function templateEnvName(kind) {
  switch (kind) {
    case 'verify':
      return 'BREVO_TEMPLATE_VERIFY';
    case 'reset':
      return 'BREVO_TEMPLATE_RESET';
    case 'email-change':
      return 'BREVO_TEMPLATE_EMAIL_CHANGE';
    case 'email-change-notice':
      return 'BREVO_TEMPLATE_EMAIL_CHANGE_NOTICE';
    case 'run-notification':
      return 'BREVO_TEMPLATE_RUN_DONE';
    case 'lead':
      return 'BREVO_TEMPLATE_LEAD';
    case 'access-request':
      return 'BREVO_TEMPLATE_ACCESS_REQUEST';
    default: {
      const _exhaustive = kind;
      void _exhaustive;
      return '';
    }
  }
}

export function resolveMailTransport(kind) {
  const envName = templateEnvName(kind);
  const templateId = envName ? parsePositiveInt(process.env[envName]) : null;
  if (brevoApiKey() && templateId) {
    return { type: 'brevo', templateId };
  }
  if (String(process.env.SMTP_HOST || '').trim()) {
    return { type: 'smtp' };
  }
  return { type: 'skip' };
}

export function warnIfBrevoMisconfigured() {
  if (!brevoApiKey()) return;
  const kinds = [
    'verify',
    'reset',
    'email-change',
    'email-change-notice',
    'run-notification',
    'lead',
    'access-request',
  ];
  const anyTemplate = kinds.some((kind) => parsePositiveInt(process.env[templateEnvName(kind)]));
  if (!anyTemplate) {
    console.warn(
      '[email] BREVO_API_KEY is set but no BREVO_TEMPLATE_* id is configured; mail will use SMTP or be skipped'
    );
  }
}

function replyToPayload(replyTo) {
  if (!replyTo) return undefined;
  if (typeof replyTo === 'string') {
    const email = replyTo.trim();
    return email ? { email } : undefined;
  }
  const email = String(replyTo.email || '').trim();
  if (!email) return undefined;
  const name = String(replyTo.name || '').trim();
  return name ? { email, name } : { email };
}

/**
 * @param {{ to: string; toName?: string; templateId: number; params?: Record<string, unknown>; replyTo?: string | { email: string; name?: string }; tags?: string[] }} opts
 * @returns {Promise<{ emailed: true; messageId: string }>}
 */
export async function sendViaBrevo({ to, toName, templateId, params, replyTo, tags }) {
  const apiKey = brevoApiKey();
  const id = parsePositiveInt(templateId);
  if (!apiKey || !id) {
    throw brevoError('Brevo is not configured');
  }
  const email = String(to || '').trim();
  if (!email) {
    throw brevoError('Missing recipient');
  }
  const messageId = newMessageId();
  const recipient = { email };
  const name = String(toName || '').trim();
  if (name) recipient.name = name;
  const payload = {
    to: [recipient],
    templateId: id,
    params: params && typeof params === 'object' ? params : {},
    tags: Array.isArray(tags) ? tags.map((tag) => String(tag)) : [],
    headers: { 'X-Mailin-custom': messageId },
  };
  const reply = replyToPayload(replyTo);
  if (reply) payload.replyTo = reply;
  const mailFrom = String(process.env.MAIL_FROM || '').trim();
  if (mailFrom) payload.sender = { email: mailFrom };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BREVO_TIMEOUT_MS);
  try {
    const res = await fetch(BREVO_SMTP_EMAIL_URL, {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const raw = await res.text();
    let data = {};
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      data = { message: raw.slice(0, 200) };
    }
    if (res.status < 200 || res.status >= 300) {
      const message =
        (data && (data.message || data.error || data.code)) || `Brevo HTTP ${res.status}`;
      throw brevoError(String(message));
    }
    return { emailed: true, messageId: String(data.messageId || messageId) };
  } catch (err) {
    if (err && err.code === 'EBREVO') throw err;
    if (err && (err.name === 'AbortError' || err.code === 'ABORT_ERR')) {
      throw brevoError('Brevo request timed out');
    }
    throw brevoError(err && err.message ? err.message : 'Brevo request failed');
  } finally {
    clearTimeout(timer);
  }
}

async function dispatchMail({ kind, to, toName, params, replyTo, subject, text, html }) {
  const messageId = newMessageId();
  const transport = resolveMailTransport(kind);
  if (transport.type === 'brevo') {
    return sendViaBrevo({
      to,
      toName,
      templateId: transport.templateId,
      params,
      replyTo,
      tags: [kind],
    });
  }
  if (transport.type === 'smtp') {
    const smtp = createSmtpTransport();
    if (!smtp) {
      logSkippedMail({ kind, to, messageId });
      return { emailed: false, skipped: true, messageId };
    }
    const from = process.env.MAIL_FROM || process.env.SMTP_USER || 'noreply@localhost';
    await smtp.sendMail({
      from,
      to,
      subject,
      text,
      html,
      replyTo,
      messageId,
    });
    return { emailed: true, messageId };
  }
  logSkippedMail({ kind, to, messageId });
  return { emailed: false, skipped: true, messageId };
}

function htmlFromText(text) {
  return `<p>${escapeHtml(text).replace(/\n/g, '<br/>')}</p>`;
}

function renderAccountMail(kind, params) {
  const p = params || {};
  switch (kind) {
    case 'verify':
      return {
        subject: 'Verify your Us accessibility account',
        text: `Confirm your email:\n${p.link}\nOpen the link, then click Confirm email. This link expires in ${p.expiresIn || '48 hours'}.\n`,
      };
    case 'reset':
      return {
        subject: 'Reset your Us accessibility password',
        text: `Reset your password:\n${p.link}\nThis link expires in ${p.expiresIn || '2 hours'}.\n`,
      };
    case 'email-change':
      return {
        subject: 'Confirm your new Us accessibility email',
        text: `Confirm your new email address:\n${p.link}\nThis link expires in ${p.expiresIn || '48 hours'}.\n`,
      };
    case 'email-change-notice':
      return {
        subject: 'Your Us accessibility email is changing',
        text: 'Someone requested a change to the email on this account. If that was not you, reset your password. The current address stays active until the new one is confirmed.\n',
      };
    default: {
      const _exhaustive = kind;
      void _exhaustive;
      return { subject: '', text: '' };
    }
  }
}

/**
 * @param {{ kind: 'verify' | 'reset' | 'email-change' | 'email-change-notice'; to: string; toName?: string; params: Record<string, string> }} opts
 */
export async function sendAccountEmail(opts) {
  const kind = opts?.kind;
  const to = String(opts?.to || '').trim();
  const params = opts?.params || {};
  const rendered = renderAccountMail(kind, params);
  if (!to || !rendered.subject) return { emailed: false, messageId: newMessageId() };
  return dispatchMail({
    kind,
    to,
    toName: opts?.toName,
    params,
    subject: rendered.subject,
    text: rendered.text,
    html: htmlFromText(rendered.text),
  });
}

function scoreParam(value) {
  if (value === '' || value == null) return '';
  const n = Number(value);
  return Number.isFinite(n) ? n : '';
}

/**
 * @param {{ to: string; domain: string; runId: string; status: 'done' | 'error'; error?: string | null; reportUrl: string; score?: number | ''; pagesScanned?: number; issueCount?: number }} opts
 */
export async function sendRunNotificationEmail(opts) {
  const to = String(opts?.to || '').trim();
  const domain = str(opts?.domain);
  const runId = str(opts?.runId);
  const reportUrl = str(opts?.reportUrl);
  const status = opts?.status === 'error' ? 'error' : 'done';
  const error = str(opts?.error);
  const params = {
    domain,
    runId,
    reportUrl,
    status,
    score: scoreParam(opts?.score),
    pagesScanned: Number(opts?.pagesScanned) || 0,
    issueCount: Number(opts?.issueCount) || 0,
    error,
  };
  const ok = status === 'done';
  const reportId = `${domain}/${runId}`;
  const subject = ok
    ? 'Your accessibility audit is ready'
    : 'Your accessibility audit run finished with an error';
  const text = ok
    ? `Your accessibility tests have finished.\n\nOpen your report:\n${reportUrl}\n\nRun ID: ${reportId}\n`
    : `Your accessibility tests have finished, but the run reported an error.\n\n${error || 'Unknown error'}\n\nIf a report was created, you can try opening:\n${reportUrl}\n\nRun ID: ${reportId}\n`;
  const html = ok
    ? `<p>Your accessibility tests have finished.</p><p><a href="${escapeAttr(reportUrl)}">Open your report</a></p><p style="color:#666;font-size:0.9em;">Run ID: ${escapeHtml(reportId)}</p>`
    : `<p>Your accessibility tests finished, but the run reported an error.</p><pre style="background:#f5f5f5;padding:12px;border-radius:8px;">${escapeHtml(error || 'Unknown error')}</pre><p>If a report was created, try <a href="${escapeAttr(reportUrl)}">opening the report</a>.</p><p style="color:#666;font-size:0.9em;">Run ID: ${escapeHtml(reportId)}</p>`;
  const result = await dispatchMail({
    kind: 'run-notification',
    to,
    params,
    subject,
    text,
    html,
  });
  return { ok: result.emailed === true, emailed: result.emailed, messageId: result.messageId, skipped: result.skipped };
}

function accessRequestTo() {
  return String(process.env.ACCESS_REQUEST_TO || 'info@about-us.be').trim();
}

/**
 * @param {{ name: string; company: string; email: string; message: string }} payload
 * @returns {Promise<{ emailed: boolean }>}
 */
export async function sendAccessRequestEmail(payload) {
  const params = {
    name: str(payload?.name).trim(),
    company: str(payload?.company).trim(),
    email: str(payload?.email).trim(),
    message: str(payload?.message).trim(),
  };
  const to = accessRequestTo();
  const subject = 'Access request — accessibility tool (Us)';
  const text = [
    `Name: ${params.name}`,
    `Company: ${params.company || '—'}`,
    `Email: ${params.email}`,
    '',
    'Message:',
    params.message || '—',
    '',
  ].join('\n');
  const html = `<p><strong>Name:</strong> ${escapeHtml(params.name)}</p>
<p><strong>Company:</strong> ${escapeHtml(params.company || '—')}</p>
<p><strong>Email:</strong> ${escapeHtml(params.email)}</p>
<p><strong>Message:</strong></p><p>${escapeHtml(params.message || '—').replace(/\n/g, '<br/>')}</p>`;
  return dispatchMail({
    kind: 'access-request',
    to,
    params,
    replyTo: params.email,
    subject,
    text,
    html,
  });
}

/**
 * @param {{ name: string; company?: string; email: string; phone?: string; message?: string; scannedUrl?: string; domain?: string; score?: number | string | null; teaserUrl?: string }} payload
 * @returns {Promise<{ emailed: boolean }>}
 */
export async function sendLeadEmail(payload) {
  const params = {
    name: str(payload?.name).trim(),
    company: str(payload?.company).trim(),
    email: str(payload?.email).trim(),
    phone: str(payload?.phone).trim(),
    message: str(payload?.message).trim(),
    scannedUrl: str(payload?.scannedUrl).trim(),
    domain: str(payload?.domain).trim(),
    score: payload?.score == null || payload?.score === '' ? '' : String(payload.score),
    teaserUrl: str(payload?.teaserUrl).trim(),
  };
  const to = accessRequestTo();
  const scoreDisplay = params.score === '' ? '—' : params.score;
  const subject = `WCAG services lead — ${params.domain || params.scannedUrl || 'scan'} (score ${scoreDisplay})`;
  const text = [
    `Name: ${params.name}`,
    `Company: ${params.company || '—'}`,
    `Email: ${params.email}`,
    `Phone: ${params.phone || '—'}`,
    `Scanned URL: ${params.scannedUrl || '—'}`,
    `Domain: ${params.domain || '—'}`,
    `Score: ${scoreDisplay}`,
    '',
    'Message:',
    params.message || '—',
    '',
  ].join('\n');
  const html = `<p><strong>Name:</strong> ${escapeHtml(params.name)}</p>
<p><strong>Company:</strong> ${escapeHtml(params.company || '—')}</p>
<p><strong>Email:</strong> ${escapeHtml(params.email)}</p>
<p><strong>Phone:</strong> ${escapeHtml(params.phone || '—')}</p>
<p><strong>Scanned URL:</strong> ${escapeHtml(params.scannedUrl || '—')}</p>
<p><strong>Domain:</strong> ${escapeHtml(params.domain || '—')}</p>
<p><strong>Score:</strong> ${escapeHtml(scoreDisplay)}</p>
<p><strong>Message:</strong></p><p>${escapeHtml(params.message || '—').replace(/\n/g, '<br/>')}</p>`;
  return dispatchMail({
    kind: 'lead',
    to,
    params,
    replyTo: params.email,
    subject,
    text,
    html,
  });
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}
