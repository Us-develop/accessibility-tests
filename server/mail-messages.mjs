/**
 * What each e-mail says, in the recipient's language.
 *
 * `buildMail(kind, lang, data)` returns the subject and plain text sent through
 * SMTP, and the `params` a Brevo template for the same mail receives. The texts
 * live in i18n/mail.*.mjs; docs/EMAIL-TEMPLATES.md lists the params per mail.
 *
 * Every param is a string, already formatted for the language ("48 uur",
 * "72/100", "3 pagina's"), and always present: '' when there is no value.
 */
import { defaultLang, normalizeLang, t, tn } from '../i18n/index.mjs';
import { publicBaseUrl } from './config.mjs';
import { EMAIL_CHANGE_LINK_HOURS, RESET_LINK_HOURS, VERIFY_LINK_HOURS } from './users.mjs';

/** Params every mail gets, on top of its own. */
export const COMMON_MAIL_PARAMS = Object.freeze(['lang', 'siteUrl']);

/** The params of each mail: the contract with the Brevo templates. */
export const MAIL_PARAMS = Object.freeze({
  verify: ['firstName', 'email', 'link', 'expiresIn'],
  'signup-existing': ['firstName', 'loginUrl', 'forgotUrl'],
  reset: ['firstName', 'link', 'expiresIn'],
  'email-change': ['firstName', 'newEmail', 'link', 'expiresIn'],
  'email-change-notice': ['firstName', 'newEmail', 'forgotUrl'],
  'run-notification': ['status', 'domain', 'reportUrl', 'score', 'pages', 'issues', 'errorMessage', 'runId'],
  lead: [
    'name',
    'company',
    'email',
    'phone',
    'message',
    'source',
    'scannedUrl',
    'domain',
    'score',
    'teaserUrl',
    'visitorLang',
  ],
  'lead-confirmation': ['name', 'scannedUrl', 'message', 'teaserUrl'],
});

export const MAIL_KINDS = Object.freeze(Object.keys(MAIL_PARAMS));

function str(value) {
  return value == null ? '' : String(value).trim();
}

function finiteNumber(value) {
  if (value === '' || value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function scoreText(lang, value) {
  const n = finiteNumber(value);
  return n == null ? '' : t(lang, 'mail.score', { score: Math.round(n) });
}

function greeting(lang, name) {
  return name ? t(lang, 'mail.greeting', { name }) : t(lang, 'mail.greeting.noName');
}

const BUILDERS = {
  verify(lang, data) {
    const params = {
      firstName: str(data.firstName),
      email: str(data.email),
      link: str(data.link),
      expiresIn: tn(lang, 'mail.hours', VERIFY_LINK_HOURS),
    };
    const action = t(lang, 'mail.verify.action');
    return {
      params,
      subject: t(lang, 'mail.verify.subject'),
      action: { label: action, url: params.link },
      lines: [
        greeting(lang, params.firstName),
        '',
        t(lang, 'mail.verify.intro'),
        '',
        `${action}:`,
        params.link,
        '',
        t(lang, 'mail.verify.howTo', { button: t(lang, 'verify.submit'), expiresIn: params.expiresIn }),
        t(lang, 'mail.verify.freeScan'),
        '',
        t(lang, 'mail.verify.notYou'),
      ],
    };
  },

  'signup-existing'(lang, data, siteUrl) {
    const params = {
      firstName: str(data.firstName),
      loginUrl: `${siteUrl}/login`,
      forgotUrl: `${siteUrl}/forgot`,
    };
    return {
      params,
      subject: t(lang, 'mail.signupExisting.subject'),
      lines: [
        greeting(lang, params.firstName),
        '',
        t(lang, 'mail.signupExisting.intro'),
        '',
        t(lang, 'mail.signupExisting.login', { url: params.loginUrl }),
        t(lang, 'mail.signupExisting.forgot', { url: params.forgotUrl }),
        '',
        t(lang, 'mail.signupExisting.notYou'),
      ],
    };
  },

  reset(lang, data) {
    const params = {
      firstName: str(data.firstName),
      link: str(data.link),
      expiresIn: tn(lang, 'mail.hours', RESET_LINK_HOURS),
    };
    const action = t(lang, 'mail.reset.action');
    return {
      params,
      subject: t(lang, 'mail.reset.subject'),
      action: { label: action, url: params.link },
      lines: [
        greeting(lang, params.firstName),
        '',
        `${action}:`,
        params.link,
        t(lang, 'mail.reset.expires', { expiresIn: params.expiresIn }),
        '',
        t(lang, 'mail.reset.notYou'),
      ],
    };
  },

  'email-change'(lang, data) {
    const params = {
      firstName: str(data.firstName),
      newEmail: str(data.newEmail),
      link: str(data.link),
      expiresIn: tn(lang, 'mail.hours', EMAIL_CHANGE_LINK_HOURS),
    };
    const action = t(lang, 'mail.emailChange.action');
    return {
      params,
      subject: t(lang, 'mail.emailChange.subject'),
      action: { label: action, url: params.link },
      lines: [
        greeting(lang, params.firstName),
        '',
        `${action}:`,
        params.link,
        t(lang, 'mail.emailChange.expires', { expiresIn: params.expiresIn }),
      ],
    };
  },

  'email-change-notice'(lang, data, siteUrl) {
    const params = {
      firstName: str(data.firstName),
      newEmail: str(data.newEmail),
      forgotUrl: `${siteUrl}/forgot`,
    };
    return {
      params,
      subject: t(lang, 'mail.emailChangeNotice.subject'),
      lines: [
        greeting(lang, params.firstName),
        '',
        t(lang, 'mail.emailChangeNotice.intro', { newEmail: params.newEmail }),
        t(lang, 'mail.emailChangeNotice.notYou', { url: params.forgotUrl }),
        t(lang, 'mail.emailChangeNotice.stays'),
      ],
    };
  },

  'run-notification'(lang, data) {
    const done = data.status !== 'error';
    const pages = finiteNumber(data.pages);
    const issues = finiteNumber(data.issues);
    const params = {
      status: done ? 'done' : 'error',
      domain: str(data.domain),
      reportUrl: str(data.reportUrl),
      score: done ? scoreText(lang, data.score) : '',
      pages: pages == null ? '' : tn(lang, 'mail.pages', pages),
      issues: issues == null ? '' : tn(lang, 'mail.issues', issues),
      errorMessage: done ? '' : str(data.errorMessage) || t(lang, 'mail.run.errorUnknown'),
      runId: str(data.runId),
    };
    const action = t(lang, 'mail.run.action');
    const counts = [params.pages, params.issues].filter(Boolean).join(' · ');
    const runId = t(lang, 'mail.run.runId', { runId: params.runId });
    if (!done) {
      return {
        params,
        subject: t(lang, 'mail.run.subject.error'),
        lines: [
          t(lang, 'mail.run.error', { domain: params.domain }),
          '',
          params.errorMessage,
          '',
          t(lang, 'mail.run.tryReport'),
          params.reportUrl,
          '',
          runId,
        ],
      };
    }
    return {
      params,
      subject: t(lang, 'mail.run.subject.done'),
      action: { label: action, url: params.reportUrl },
      lines: [
        t(lang, 'mail.run.done', { domain: params.domain }),
        '',
        ...(params.score ? [t(lang, 'mail.run.scoreLine', { score: params.score })] : []),
        ...(counts ? [counts] : []),
        ...(params.score || counts ? [''] : []),
        `${action}:`,
        params.reportUrl,
        '',
        runId,
      ],
    };
  },

  lead(lang, data) {
    const params = {
      name: str(data.name),
      company: str(data.company),
      email: str(data.email),
      phone: str(data.phone),
      message: str(data.message),
      source: str(data.source),
      scannedUrl: str(data.scannedUrl),
      domain: str(data.domain),
      score: scoreText(lang, data.score),
      teaserUrl: str(data.teaserUrl),
      visitorLang: normalizeLang(data.visitorLang) || '',
    };
    const fields = ['name', 'company', 'email', 'phone', 'source', 'scannedUrl', 'domain', 'score', 'teaserUrl', 'visitorLang'];
    return {
      params,
      subject: t(lang, 'mail.lead.subject', {
        site: params.domain || params.scannedUrl || t(lang, 'mail.lead.siteFallback'),
        score: params.score || '—',
      }),
      lines: [
        ...fields.map((field) => `${t(lang, `mail.lead.${field}`)}: ${params[field] || '—'}`),
        '',
        `${t(lang, 'mail.lead.message')}:`,
        params.message || '—',
      ],
    };
  },

  'lead-confirmation'(lang, data) {
    const params = {
      name: str(data.name),
      scannedUrl: str(data.scannedUrl),
      message: str(data.message),
      teaserUrl: str(data.teaserUrl),
    };
    return {
      params,
      subject: t(lang, 'mail.leadConfirmation.subject'),
      lines: [
        greeting(lang, params.name),
        '',
        t(lang, 'mail.leadConfirmation.intro'),
        '',
        ...(params.scannedUrl ? [t(lang, 'mail.leadConfirmation.scannedUrl', { url: params.scannedUrl }), ''] : []),
        ...(params.message ? [t(lang, 'mail.leadConfirmation.message'), params.message, ''] : []),
        t(lang, 'mail.leadConfirmation.next'),
        '',
        t(lang, 'mail.signature'),
        'https://about-us.be',
      ],
    };
  },
};

/**
 * @param {string} kind one of MAIL_KINDS
 * @param {string | null | undefined} lang recipient's language; the default language when unknown
 * @param {Record<string, unknown>} [data] the values the mail needs, unformatted
 * @returns {{ kind: string, lang: string, subject: string, text: string, action: { label: string, url: string } | null, params: Record<string, string> }}
 */
export function buildMail(kind, lang, data = {}) {
  const build = BUILDERS[kind];
  if (!build) throw new Error(`Unknown mail kind: ${kind}`);
  const mailLang = normalizeLang(lang) || defaultLang();
  const siteUrl = publicBaseUrl();
  const built = build(mailLang, data || {}, siteUrl);
  const params = { lang: mailLang, siteUrl };
  for (const name of MAIL_PARAMS[kind]) params[name] = str(built.params[name]);
  return {
    kind,
    lang: mailLang,
    subject: built.subject,
    text: `${built.lines.join('\n')}\n`,
    action: built.action?.url ? built.action : null,
    params,
  };
}
