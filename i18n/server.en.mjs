/**
 * Messages the server sends, in English. The English text must stay identical to
 * the message in the server code: server/server-messages.mjs finds the key by
 * that text and answers in the visitor's language. Keep keys and {placeholders}
 * identical to server.nl.mjs.
 */
export default {
  // ── Sign-in and access ────────────────────────────────────────────
  'server.authRequired': 'Authentication required',
  'server.signInFirst': 'Sign in first.',
  'server.staffOnly': 'Staff only.',
  'server.csrf': 'Missing or invalid CSRF token.',
  'server.noAccess': 'You do not have access to this project.',
  'server.credentials': 'Invalid username or password.',
  'server.unverified': 'Verify your email before signing in.',
  'server.tooMany': 'Too many requests.',

  // ── Account ───────────────────────────────────────────────────────
  'server.tooManySignups': 'Too many sign-up attempts. Try again in an hour.',
  'server.acceptTerms': 'Accept the Terms of Service and Privacy Notice to create an account.',
  'server.passwordRule': 'Use a password of at least 10 characters that is not your email.',
  'server.emailTaken':
    'If that email can be registered, we sent a verification link. Otherwise try logging in or resetting your password.',
  'server.emailInvalid': 'Enter a valid email address.',
  'server.emailSame': 'That is already your email address.',
  'server.emailInUse': 'That email is already in use.',
  'server.currentPassword': 'Current password is incorrect.',
  'server.passwordIncorrect': 'Password is incorrect.',
  'server.vat': 'Enter a valid EU VAT number (for example BE0123456789).',
  'server.company': 'Enter a company name for a business account.',
  'server.verifyInvalid': 'Invalid or expired verification link.',
  'server.resetInvalid': 'Invalid or expired reset link.',
  'server.guestTokenMissing': 'Missing guest scan token.',
  'server.snapshotNotFound': 'That snapshot was not found.',

  // ── Starting a scan ───────────────────────────────────────────────
  'server.url.single': 'Enter a single public http(s) URL.',
  'server.url.valid': 'Enter a valid URL, including https://.',
  'server.url.scheme': 'Only http and https URLs can be scanned.',
  'server.url.credentials': 'URLs with credentials are not allowed.',
  'server.url.blocked': 'That host cannot be scanned.',
  'server.url.resolve': 'Could not resolve that hostname.',
  'server.oneDomain': 'Please provide URLs from one domain per run. Mixed-domain runs are not supported.',
  'server.plainHost': 'We can\'t scan {domain} yet. Use a plain host name such as www.example.com.',
  'server.runBusy': 'A run for {domain} is already in progress. Please wait for it to finish.',
  'server.guestBusy': 'A free scan is already running from this network. Please wait for it to finish.',
  'server.freebieUsed': 'You already used your free snapshot. Sign in or buy tokens for another scan.',
  'server.captchaUnavailable': 'Guest scans are temporarily unavailable.',
  'server.captchaComplete': 'Complete the captcha and try again.',
  'server.captchaFailed': 'Captcha verification failed. Try again.',
  'server.uploadsSignIn': 'File uploads are available after you sign in.',
  'server.sitemapStaff': 'Sitemap uploads stay on staff scans for now. Paste public URLs from one domain.',
  'server.fileTooLarge': 'That file is too large. Uploads are limited to 1 MB.',
  'server.fieldTooLong': 'That is too much text for one field. Upload a file instead.',
  'server.uploadUnreadable': 'That upload could not be read.',
  'server.tooManyFields': 'Too many fields or files in this upload.',
  'server.tooManyItems': 'Too many items.',
  'server.emptyTokens':
    'You need Pro or tokens to scan into your account. Buy a token pack, subscribe to Pro, or request Us services.',
  'server.proPagesUsed': 'You have used this month’s Pro pages. Buy extra tokens or wait until next month.',
  'server.pageLimit': 'This account allows {n} page(s) per scan.',
  'server.noPlan': 'No plan is assigned to this account.',
  'server.notEnoughTokens': 'Not enough tokens remaining.',

  // ── Scans and reports ─────────────────────────────────────────────
  'server.scanNotStarted': 'The scan could not be started.',
  'server.scanInterrupted': 'The scan was interrupted.',
  'server.scanFailed': 'The scan could not be completed.',
  'server.scanTimeout': 'The scan took too long and was stopped.',
  'server.invalidDomain': 'Invalid domain',
  'server.invalidDomainDot': 'Invalid domain.',
  'server.invalidRunId': 'Invalid run id',
  'server.reportNotFound': 'Report not found',
  'server.runNotFound': 'Run not found',
  'server.scanNotFound': 'Scan not found',
  'server.resultsNotReady': 'Results are not available yet.',
  'server.scanNotFinished': 'Scan is not finished yet.',
  'server.reportFailed': 'Report generation failed.',
  'server.notFound': 'Not found',
  'server.internal': 'Internal error',

  // ── Contact form ──────────────────────────────────────────────────
  'server.leadRequired': 'Name and email are required.',
  'server.leadFailed': 'Could not submit your request. Try again later.',

  // ── Payments ──────────────────────────────────────────────────────
  'server.billingOff': 'Stripe billing is not connected yet.',
  'server.billingUnconfigured': 'Stripe is not configured.',
  'server.waiver':
    'Confirm that you request immediate delivery and acknowledge losing the 14-day withdrawal right.',
  'server.packChoice': 'Choose a token pack of 10, 50, or 100.',
  'server.packOff': 'That token pack is not connected to Stripe yet.',
  'server.productChoice': 'Choose Pro or a token pack.',
  'server.proOff': 'Pro is not connected to Stripe yet.',

  // ── Jira ──────────────────────────────────────────────────────────
  'server.jiraPro': 'Jira export is part of Pro.',
  'server.jiraNotConnected': 'Jira is not connected for this domain. Connect first.',
  'server.jiraNotConnectedShort': 'Jira not connected for this domain',
  'server.jiraKey': 'Invalid Jira project key.',
  'server.jiraNoTickets': 'No tickets provided.',
};
