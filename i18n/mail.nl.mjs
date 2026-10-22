/**
 * Teksten van de e-mails die de app verstuurt (België). Aanspreekvorm: "u".
 *
 * Dit zijn de tekstmails die via SMTP vertrekken, en de basis voor de
 * Brevo-templates (docs/EMAIL-TEMPLATES.md geeft de params per mail).
 * Sleutels en {plaatshouders} zijn identiek aan mail.en.mjs.
 * Concept: nog na te lezen door de copywriters van Us.
 */
export default {
  // ── Gedeeld ───────────────────────────────────────────────────────
  'mail.greeting': 'Beste {name},',
  'mail.greeting.noName': 'Goeiedag,',
  'mail.hours.one': '{n} uur',
  'mail.hours.other': '{n} uur',
  'mail.pages.one': '{n} pagina',
  'mail.pages.other': "{n} pagina's",
  'mail.issues.one': '{n} probleem',
  'mail.issues.other': '{n} problemen',
  'mail.score': '{score}/100',
  'mail.signature': 'Us',

  // ── Adres bevestigen na het aanmelden ─────────────────────────────
  'mail.verify.subject': 'Bevestig uw e-mailadres · Us toegankelijkheid',
  'mail.verify.intro':
    'Welkom bij de toegankelijkheidsscanner van Us. Nog één stap: bevestig dat dit e-mailadres van u is.',
  'mail.verify.action': 'Mijn e-mailadres bevestigen',
  'mail.verify.howTo': 'Open de link en klik daarna op de pagina op "{button}". De link werkt {expiresIn}.',
  'mail.verify.freeScan': 'Uw gratis scan staat in uw account zodra u hebt bevestigd.',
  'mail.verify.notYou': 'Hebt u geen account aangemaakt? Dan mag u dit bericht negeren; er gebeurt niets.',

  // ── Aanmelden met een adres dat al een account heeft ──────────────
  'mail.signupExisting.subject': 'U hebt al een account bij Us toegankelijkheid',
  'mail.signupExisting.intro':
    'Iemand, waarschijnlijk uzelf, probeerde een account aan te maken met dit e-mailadres, maar het heeft er al een.',
  'mail.signupExisting.login': 'Aanmelden: {url}',
  'mail.signupExisting.forgot': 'Wachtwoord vergeten? Stel een nieuw in: {url}',
  'mail.signupExisting.notYou': 'Was u dit niet? Dan mag u dit bericht negeren. Er is niets veranderd.',

  // ── Wachtwoord opnieuw instellen ──────────────────────────────────
  'mail.reset.subject': 'Stel uw wachtwoord voor Us toegankelijkheid opnieuw in',
  'mail.reset.action': 'Mijn wachtwoord opnieuw instellen',
  'mail.reset.expires': 'Deze link vervalt na {expiresIn}.',
  'mail.reset.notYou': 'Hebt u dit niet gevraagd? Dan mag u dit bericht negeren; uw wachtwoord blijft hetzelfde.',

  // ── E-mailadres wijzigen: naar het nieuwe adres ───────────────────
  'mail.emailChange.subject': 'Bevestig uw nieuwe e-mailadres voor Us toegankelijkheid',
  'mail.emailChange.action': 'Mijn nieuwe e-mailadres bevestigen',
  'mail.emailChange.expires': 'Deze link vervalt na {expiresIn}.',

  // ── E-mailadres wijzigen: bericht naar het oude adres ─────────────
  'mail.emailChangeNotice.subject': 'Het e-mailadres van uw account bij Us toegankelijkheid wijzigt',
  'mail.emailChangeNotice.intro': 'Iemand vroeg om het e-mailadres van dit account te wijzigen naar {newEmail}.',
  'mail.emailChangeNotice.notYou': 'Was u dat niet? Stel dan een nieuw wachtwoord in: {url}',
  'mail.emailChangeNotice.stays': 'Het huidige adres blijft actief tot het nieuwe is bevestigd.',

  // ── Een scan is klaar (medewerkers kunnen dit vragen) ─────────────
  'mail.run.subject.done': 'Uw toegankelijkheidsaudit is klaar',
  'mail.run.subject.error': 'Uw toegankelijkheidsaudit is geëindigd met een fout',
  'mail.run.done': 'De toegankelijkheidstests voor {domain} zijn klaar.',
  'mail.run.error': 'De toegankelijkheidstests voor {domain} zijn klaar, maar er trad een fout op.',
  'mail.run.errorUnknown': 'Onbekende fout',
  'mail.run.scoreLine': 'Score: {score}',
  'mail.run.action': 'Uw rapport openen',
  'mail.run.tryReport': 'Als er toch een rapport is gemaakt, kunt u het hier proberen te openen:',
  'mail.run.runId': 'Scan-ID: {runId}',

  // ── Nieuwe lead, naar het team van Us ─────────────────────────────
  'mail.lead.subject': 'Lead WCAG-diensten — {site} (score {score})',
  'mail.lead.siteFallback': 'scan',
  'mail.lead.name': 'Naam',
  'mail.lead.company': 'Bedrijf',
  'mail.lead.email': 'E-mail',
  'mail.lead.phone': 'Telefoon',
  'mail.lead.source': 'Bron',
  'mail.lead.scannedUrl': 'Gescande URL',
  'mail.lead.domain': 'Domein',
  'mail.lead.score': 'Score',
  'mail.lead.teaserUrl': 'Scanresultaat',
  'mail.lead.visitorLang': 'Taal',
  'mail.lead.message': 'Bericht',

  // ── Bevestiging aan wie het contactformulier invulde ──────────────
  'mail.leadConfirmation.subject': 'We hebben uw aanvraag ontvangen · Us toegankelijkheid',
  'mail.leadConfirmation.intro':
    'Bedankt dat u contact opneemt met Us over digitale toegankelijkheid. We hebben uw aanvraag ontvangen en een van onze toegankelijkheidsspecialisten antwoordt binnen twee werkdagen.',
  'mail.leadConfirmation.scannedUrl': 'Gescande pagina: {url}',
  'mail.leadConfirmation.message': 'Uw bericht:',
  'mail.leadConfirmation.next': 'U hoeft verder niets te doen. Wilt u iets toevoegen? Antwoord dan op deze e-mail.',
};
