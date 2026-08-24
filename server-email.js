/**
 * Optional SMTP notifications when a test run finishes (configure SMTP_* env vars).
 */
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

/**
 * @param {{ to: string; reportId: string; status: 'done' | 'error'; error?: string | null; reportUrl: string }} opts
 */
export async function sendRunNotificationEmail(opts) {
  const transport = createSmtpTransport();
  if (!transport) {
    return { ok: false, skipped: true };
  }
  const from = process.env.MAIL_FROM || process.env.SMTP_USER || 'noreply@localhost';
  const { to, reportId, status, error, reportUrl } = opts;
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
  });
  return { ok: true };
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

  if (!transport) {
    console.warn('[access-request] SMTP not configured; logging only.');
    console.warn('[access-request]', {
      name,
      company: company || null,
      email,
      messagePreview: message.slice(0, 500),
    });
    return { emailed: false };
  }

  await transport.sendMail({
    from,
    to,
    subject,
    text,
    html,
    replyTo: email,
  });
  return { emailed: true };
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

  if (!transport) {
    console.warn('[lead] SMTP not configured; logging only.');
    console.warn('[lead]', {
      name,
      company: company || null,
      email,
      phone: phone || null,
      scannedUrl: scannedUrl || null,
      domain: domain || null,
      score,
      messagePreview: message.slice(0, 500),
    });
    return { emailed: false };
  }

  await transport.sendMail({
    from,
    to,
    subject,
    text,
    html,
    replyTo: email,
  });
  return { emailed: true };
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
