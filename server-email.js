/**
 * Optional SMTP notifications when a test run finishes (configure SMTP_* env vars).
 */
import { randomBytes } from 'crypto';
import nodemailer from 'nodemailer';

export function createSmtpTransport() {
  const host = process.env.SMTP_HOST;
  if (!host || typeof host !== 'string') return null;
  return nodemailer.createTransport({
    host,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER
      ? {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASSWORD || '',
        }
      : undefined,
  });
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

/**
 * @param {{ to: string; reportId: string; status: 'done' | 'error'; error?: string | null; reportUrl: string }} opts
 */
export async function sendRunNotificationEmail(opts) {
  const transport = createSmtpTransport();
  const { to, reportId, status, error, reportUrl } = opts;
  const messageId = newMessageId();
  if (!transport) {
    logSkippedMail({ kind: 'run-notification', to, messageId });
    return { ok: false, skipped: true, messageId };
  }
  const from = process.env.MAIL_FROM || process.env.SMTP_USER || 'noreply@localhost';
  const ok = status === 'done';
  const subject = ok
    ? 'Your accessibility audit is ready'
    : 'Your accessibility audit run finished with an error';
  const text = ok
    ? `Your accessibility tests have finished.\n\nOpen your report:\n${reportUrl}\n\nRun ID: ${reportId}\n`
    : `Your accessibility tests have finished, but the run reported an error.\n\n${error || 'Unknown error'}\n\nIf a report was created, you can try opening:\n${reportUrl}\n\nRun ID: ${reportId}\n`;
  const html = ok
    ? `<p>Your accessibility tests have finished.</p><p><a href="${escapeAttr(reportUrl)}">Open your report</a></p><p style="color:#666;font-size:0.9em;">Run ID: ${escapeHtml(reportId)}</p>`
    : `<p>Your accessibility tests finished, but the run reported an error.</p><pre style="background:#f5f5f5;padding:12px;border-radius:8px;">${escapeHtml(error || 'Unknown error')}</pre><p>If a report was created, try <a href="${escapeAttr(reportUrl)}">opening the report</a>.</p><p style="color:#666;font-size:0.9em;">Run ID: ${escapeHtml(reportId)}</p>`;

  await transport.sendMail({
    from,
    to,
    subject,
    text,
    html,
    messageId,
  });
  return { ok: true, messageId };
}

/**
 * @param {{ name: string; company: string; email: string; message: string }} payload
 * @returns {Promise<{ emailed: boolean }>}
 */
export async function sendAccessRequestEmail(payload) {
  const name = String(payload?.name || '').trim();
  const company = String(payload?.company || '').trim();
  const email = String(payload?.email || '').trim();
  const message = String(payload?.message || '').trim();
  const transport = createSmtpTransport();
  const to = String(process.env.ACCESS_REQUEST_TO || 'info@about-us.be').trim();
  const from = process.env.MAIL_FROM || process.env.SMTP_USER || 'noreply@localhost';
  const subject = 'Access request — accessibility tool (Us)';
  const text = [`Name: ${name}`, `Company: ${company || '—'}`, `Email: ${email}`, '', 'Message:', message || '—', ''].join('\n');
  const html = `<p><strong>Name:</strong> ${escapeHtml(name)}</p>
<p><strong>Company:</strong> ${escapeHtml(company || '—')}</p>
<p><strong>Email:</strong> ${escapeHtml(email)}</p>
<p><strong>Message:</strong></p><p>${escapeHtml(message || '—').replace(/\n/g, '<br/>')}</p>`;
  const messageId = newMessageId();

  if (!transport) {
    logSkippedMail({ kind: 'access-request', to, messageId });
    return { emailed: false, messageId };
  }

  await transport.sendMail({
    from,
    to,
    subject,
    text,
    html,
    replyTo: email,
    messageId,
  });
  return { emailed: true, messageId };
}

/**
 * @param {{ name: string; company?: string; email: string; phone?: string; message?: string; scannedUrl?: string; domain?: string; score?: number | null }} payload
 * @returns {Promise<{ emailed: boolean }>}
 */
export async function sendLeadEmail(payload) {
  const name = String(payload?.name || '').trim();
  const company = String(payload?.company || '').trim();
  const email = String(payload?.email || '').trim();
  const phone = String(payload?.phone || '').trim();
  const message = String(payload?.message || '').trim();
  const scannedUrl = String(payload?.scannedUrl || '').trim();
  const domain = String(payload?.domain || '').trim();
  const score = payload?.score == null || payload?.score === '' ? '—' : String(payload.score);
  const transport = createSmtpTransport();
  const to = String(process.env.ACCESS_REQUEST_TO || 'info@about-us.be').trim();
  const from = process.env.MAIL_FROM || process.env.SMTP_USER || 'noreply@localhost';
  const subject = `WCAG services lead — ${domain || scannedUrl || 'scan'} (score ${score})`;
  const text = [
    `Name: ${name}`,
    `Company: ${company || '—'}`,
    `Email: ${email}`,
    `Phone: ${phone || '—'}`,
    `Scanned URL: ${scannedUrl || '—'}`,
    `Domain: ${domain || '—'}`,
    `Score: ${score}`,
    '',
    'Message:',
    message || '—',
    '',
  ].join('\n');
  const html = `<p><strong>Name:</strong> ${escapeHtml(name)}</p>
<p><strong>Company:</strong> ${escapeHtml(company || '—')}</p>
<p><strong>Email:</strong> ${escapeHtml(email)}</p>
<p><strong>Phone:</strong> ${escapeHtml(phone || '—')}</p>
<p><strong>Scanned URL:</strong> ${escapeHtml(scannedUrl || '—')}</p>
<p><strong>Domain:</strong> ${escapeHtml(domain || '—')}</p>
<p><strong>Score:</strong> ${escapeHtml(score)}</p>
<p><strong>Message:</strong></p><p>${escapeHtml(message || '—').replace(/\n/g, '<br/>')}</p>`;
  const messageId = newMessageId();

  if (!transport) {
    logSkippedMail({ kind: 'lead', to, messageId });
    return { emailed: false, messageId };
  }

  await transport.sendMail({
    from,
    to,
    subject,
    text,
    html,
    replyTo: email,
    messageId,
  });
  return { emailed: true, messageId };
}

/**
 * @param {{ to: string; subject: string; text: string; kind?: string }} opts
 */
export async function sendAccountEmail(opts) {
  const transport = createSmtpTransport();
  const from = process.env.MAIL_FROM || process.env.SMTP_USER || 'noreply@localhost';
  const to = String(opts?.to || '').trim();
  const subject = String(opts?.subject || '').trim();
  const text = String(opts?.text || '').trim();
  const kind = String(opts?.kind || 'account');
  const messageId = newMessageId();
  if (!to || !subject) return { emailed: false, messageId };
  if (!transport) {
    logSkippedMail({ kind, to, messageId });
    return { emailed: false, messageId };
  }
  const html = `<p>${escapeHtml(text).replace(/\n/g, '<br/>')}</p>`;
  await transport.sendMail({ from, to, subject, text, html, messageId });
  return { emailed: true, messageId };
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
