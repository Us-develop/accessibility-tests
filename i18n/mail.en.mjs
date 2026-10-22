/**
 * Texts of the e-mails the app sends (English).
 *
 * These are the plain-text mails sent through SMTP, and the reference for the
 * Brevo templates (docs/EMAIL-TEMPLATES.md lists the params of each mail).
 * Keys and {placeholders} are the same in mail.nl.mjs.
 */
export default {
  // ── Shared ────────────────────────────────────────────────────────
  'mail.greeting': 'Hello {name},',
  'mail.greeting.noName': 'Hello,',
  'mail.hours.one': '{n} hour',
  'mail.hours.other': '{n} hours',
  'mail.pages.one': '{n} page',
  'mail.pages.other': '{n} pages',
  'mail.issues.one': '{n} issue',
  'mail.issues.other': '{n} issues',
  'mail.score': '{score}/100',
  'mail.signature': 'Us',

  // ── Confirm the address after signing up ──────────────────────────
  'mail.verify.subject': 'Confirm your email address · Us accessibility',
  'mail.verify.intro': 'Welcome to the Us accessibility scanner. One step left: confirm that this email address is yours.',
  'mail.verify.action': 'Confirm my email address',
  'mail.verify.howTo': 'Open the link, then click "{button}" on the page. The link works for {expiresIn}.',
  'mail.verify.freeScan': 'Your free scan is added to your account as soon as you have confirmed.',
  'mail.verify.notYou': 'Did you not create an account? Then ignore this message; nothing will happen.',

  // ── Someone signed up with an address that already has an account ─
  'mail.signupExisting.subject': 'You already have a Us accessibility account',
  'mail.signupExisting.intro':
    'Someone, probably you, tried to create an account with this email address, but it already has one.',
  'mail.signupExisting.login': 'Sign in: {url}',
  'mail.signupExisting.forgot': 'Forgot your password? Reset it: {url}',
  'mail.signupExisting.notYou': 'If this was not you, you can ignore this message. Nothing has changed.',

  // ── Password reset ────────────────────────────────────────────────
  'mail.reset.subject': 'Reset your Us accessibility password',
  'mail.reset.action': 'Reset my password',
  'mail.reset.expires': 'This link expires in {expiresIn}.',
  'mail.reset.notYou': 'Did you not ask for this? Then ignore this message; your password stays the same.',

  // ── E-mail change: to the new address ─────────────────────────────
  'mail.emailChange.subject': 'Confirm your new Us accessibility email',
  'mail.emailChange.action': 'Confirm my new email address',
  'mail.emailChange.expires': 'This link expires in {expiresIn}.',

  // ── E-mail change: notice to the old address ──────────────────────
  'mail.emailChangeNotice.subject': 'Your Us accessibility email is changing',
  'mail.emailChangeNotice.intro': 'Someone asked to change the email address of this account to {newEmail}.',
  'mail.emailChangeNotice.notYou': 'If that was not you, reset your password: {url}',
  'mail.emailChangeNotice.stays': 'The current address stays active until the new one is confirmed.',

  // ── A scan finished (staff can ask for this) ──────────────────────
  'mail.run.subject.done': 'Your accessibility audit is ready',
  'mail.run.subject.error': 'Your accessibility audit run finished with an error',
  'mail.run.done': 'Your accessibility tests for {domain} have finished.',
  'mail.run.error': 'Your accessibility tests for {domain} have finished, but the run reported an error.',
  'mail.run.errorUnknown': 'Unknown error',
  'mail.run.scoreLine': 'Score: {score}',
  'mail.run.action': 'Open your report',
  'mail.run.tryReport': 'If a report was created, you can try opening it:',
  'mail.run.runId': 'Run ID: {runId}',

  // ── New lead, to the Us team ──────────────────────────────────────
  'mail.lead.subject': 'WCAG services lead — {site} (score {score})',
  'mail.lead.siteFallback': 'scan',
  'mail.lead.name': 'Name',
  'mail.lead.company': 'Company',
  'mail.lead.email': 'Email',
  'mail.lead.phone': 'Phone',
  'mail.lead.source': 'Source',
  'mail.lead.scannedUrl': 'Scanned URL',
  'mail.lead.domain': 'Domain',
  'mail.lead.score': 'Score',
  'mail.lead.teaserUrl': 'Scan result',
  'mail.lead.visitorLang': 'Language',
  'mail.lead.message': 'Message',

  // ── Confirmation to the visitor who filled in the contact form ────
  'mail.leadConfirmation.subject': 'We received your request · Us accessibility',
  'mail.leadConfirmation.intro':
    'Thank you for getting in touch with Us about web accessibility. We received your request and one of our accessibility specialists will reply within two working days.',
  'mail.leadConfirmation.scannedUrl': 'Page you scanned: {url}',
  'mail.leadConfirmation.message': 'Your message:',
  'mail.leadConfirmation.next': 'You do not need to do anything else. If you want to add something, reply to this email.',
};
