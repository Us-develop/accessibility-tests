/**
 * Outgoing mail. Each mail is built in the recipient's language by
 * server/mail-messages.mjs and sent through SMTP (configure SMTP_* env vars).
 * Without SMTP_HOST the mail is skipped and the skip is logged.
 */
import { randomBytes } from 'crypto';
import nodemailer from 'nodemailer';
import { buildMail } from './server/mail-messages.mjs';

/** @type {null | (() => { sendMail: Function } | null)} */
let smtpTransportFactory = null;

/**
 * Tests only: replace the SMTP transport, so a test can capture or fail mails
 * without a mail server. Pass null to go back to the real one.
 * @param {null | (() => { sendMail: Function } | null)} factory
 */
export function setSmtpTransportFactory(factory) {
  smtpTransportFactory = typeof factory === 'function' ? factory : null;
}

export function createSmtpTransport() {
  if (smtpTransportFactory) return smtpTransportFactory();
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

/** The Us team inbox: leads go here, and visitors' replies to their confirmation. */
export function teamInbox() {
  return String(process.env.ACCESS_REQUEST_TO || 'info@about-us.be').trim();
}

function recipientDomain(to) {
  const at = String(to || '').lastIndexOf('@');
  if (at === -1) return '';
  return String(to).slice(at + 1).toLowerCase();
}

function newMessageId() {
  return `<${randomBytes(12).toString('hex')}@us-accessibility>`;
}

/** Logs say which mail and which domain, never the full address, the link or the text. */
function logSkippedMail({ kind, lang, to, messageId }) {
  console.warn('[email]', { kind, lang, domain: recipientDomain(to), messageId });
}

export function logMailFailure({ kind, lang, to }, err) {
  console.warn('[email] failed', {
    kind,
    lang: lang || '',
    domain: recipientDomain(to),
    code: err && err.code ? String(err.code) : '',
  });
}

/** HTML part: the same text, with the mail's main link as a labelled action. Content only, no styling. */
function htmlFromText(text, action) {
  return (
    `<p>${escapeHtml(text).replace(/\n/g, '<br/>')}</p>` +
    (action ? `<p><a href="${escapeAttr(action.url)}">${escapeHtml(action.label)}</a></p>` : '')
  );
}

/**
 * Build one mail in the recipient's language and send it.
 * Throws when the mail server refuses it; use sendMailSafely where a failed
 * mail must not change the outcome of the request.
 * @param {{ kind: string, to: string, lang?: string | null, data?: Record<string, unknown>, replyTo?: string }} opts
 * @returns {Promise<{ emailed: boolean, skipped?: boolean, messageId: string, lang: string }>}
 */
export async function sendMail({ kind, to, lang, data, replyTo }) {
  const recipient = String(to || '').trim();
  const mail = buildMail(kind, lang, data);
  const messageId = newMessageId();
  if (!recipient) return { emailed: false, messageId, lang: mail.lang };
  const transport = createSmtpTransport();
  if (!transport) {
    logSkippedMail({ kind, lang: mail.lang, to: recipient, messageId });
    return { emailed: false, skipped: true, messageId, lang: mail.lang };
  }
  const from = process.env.MAIL_FROM || process.env.SMTP_USER || 'noreply@localhost';
  await transport.sendMail({
    from,
    to: recipient,
    ...(replyTo ? { replyTo } : {}),
    subject: mail.subject,
    text: mail.text,
    html: htmlFromText(mail.text, mail.action),
    messageId,
  });
  return { emailed: true, messageId, lang: mail.lang };
}

/**
 * Like sendMail, but never throws: a failure is logged (mail type, language,
 * recipient domain, error code) and reported as `emailed: false`. By the time
 * we send, the account, token or lead already exists; a mail error must not
 * turn that into a failed request, and its text must not reach the visitor.
 */
export async function sendMailSafely(opts) {
  try {
    return await sendMail(opts);
  } catch (err) {
    logMailFailure(opts, err);
    return { emailed: false };
  }
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
