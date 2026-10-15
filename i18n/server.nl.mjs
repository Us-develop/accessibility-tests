/**
 * Meldingen die de server stuurt (België). Aanspreekvorm: "u".
 * Sleutels en {plaatshouders} zijn identiek aan server.en.mjs.
 * Concept: nog na te lezen door de copywriters van Us.
 */
export default {
  // ── Aanmelden en toegang ──────────────────────────────────────────
  'server.authRequired': 'U moet aangemeld zijn.',
  'server.signInFirst': 'Meld u eerst aan.',
  'server.staffOnly': 'Alleen voor medewerkers.',
  'server.csrf': 'Dit verzoek kon niet worden bevestigd. Vernieuw de pagina en probeer het opnieuw.',
  'server.noAccess': 'U hebt geen toegang tot dit project.',
  'server.credentials': 'Het e-mailadres of het wachtwoord is niet juist.',
  'server.unverified': 'Bevestig eerst uw e-mailadres voordat u zich aanmeldt.',
  'server.tooMany': 'Te veel verzoeken. Probeer het later opnieuw.',

  // ── Account ───────────────────────────────────────────────────────
  'server.tooManySignups': 'Te veel pogingen om een account aan te maken. Probeer het over een uur opnieuw.',
  'server.acceptTerms':
    'Aanvaard de gebruiksvoorwaarden en de privacyverklaring om een account aan te maken.',
  'server.passwordRule': 'Gebruik een wachtwoord van minstens 10 tekens dat niet uw e-mailadres is.',
  'server.emailTaken':
    'Als dat e-mailadres kan worden geregistreerd, hebben we een bevestigingslink gestuurd. Anders kunt u zich aanmelden of uw wachtwoord opnieuw instellen.',
  'server.emailInvalid': 'Vul een geldig e-mailadres in.',
  'server.emailSame': 'Dat is al uw e-mailadres.',
  'server.emailInUse': 'Dat e-mailadres is al in gebruik.',
  'server.currentPassword': 'Het huidige wachtwoord is niet juist.',
  'server.passwordIncorrect': 'Het wachtwoord is niet juist.',
  'server.vat': 'Vul een geldig Europees btw-nummer in (bijvoorbeeld BE0123456789).',
  'server.company': 'Vul een bedrijfsnaam in voor een zakelijk account.',
  'server.verifyInvalid': 'Ongeldige of verlopen bevestigingslink.',
  'server.resetInvalid': 'Ongeldige of verlopen link om uw wachtwoord opnieuw in te stellen.',
  'server.guestTokenMissing': 'De link naar de gratis scan ontbreekt.',
  'server.snapshotNotFound': 'Die momentopname werd niet gevonden.',

  // ── Een scan starten ──────────────────────────────────────────────
  'server.url.single': 'Vul één openbare http(s)-URL in.',
  'server.url.valid': 'Vul een geldige URL in, met https://.',
  'server.url.scheme': 'Alleen http- en https-URL\'s kunnen worden gescand.',
  'server.url.credentials': 'URL\'s met inloggegevens zijn niet toegestaan.',
  'server.url.blocked': 'Die host kan niet worden gescand.',
  'server.url.resolve': 'Die hostnaam kon niet worden gevonden.',
  'server.oneDomain':
    'Geef per scan URL\'s van één domein op. Scans met verschillende domeinen zijn niet mogelijk.',
  'server.plainHost':
    'We kunnen {domain} nog niet scannen. Gebruik een gewone hostnaam zoals www.example.com.',
  'server.runBusy': 'Er loopt al een scan voor {domain}. Wacht tot die klaar is.',
  'server.guestBusy': 'Er loopt al een gratis scan vanaf dit netwerk. Wacht tot die klaar is.',
  'server.freebieUsed':
    'U hebt uw gratis momentopname al gebruikt. Meld u aan of koop tokens voor een nieuwe scan.',
  'server.captchaUnavailable': 'Gratis scans zijn tijdelijk niet beschikbaar.',
  'server.captchaComplete': 'Vul de captcha in en probeer het opnieuw.',
  'server.captchaFailed': 'De captcha kon niet worden gecontroleerd. Probeer het opnieuw.',
  'server.uploadsSignIn': 'Bestanden uploaden kan nadat u zich hebt aangemeld.',
  'server.sitemapStaff':
    'Sitemaps uploaden kan voorlopig alleen bij scans van medewerkers. Plak openbare URL\'s van één domein.',
  'server.fileTooLarge': 'Dat bestand is te groot. Uploads zijn beperkt tot 1 MB.',
  'server.fieldTooLong': 'Dat is te veel tekst voor één veld. Upload in plaats daarvan een bestand.',
  'server.uploadUnreadable': 'Die upload kon niet worden gelezen.',
  'server.tooManyFields': 'Te veel velden of bestanden in deze upload.',
  'server.tooManyItems': 'Te veel items.',
  'server.emptyTokens':
    'U hebt Pro of tokens nodig om in uw account te scannen. Koop een tokenpakket, neem Pro of vraag de diensten van Us aan.',
  'server.proPagesUsed':
    'U hebt de Pro-pagina\'s van deze maand opgebruikt. Koop extra tokens of wacht tot volgende maand.',
  'server.pageLimit': 'Dit account laat {n} pagina(\'s) per scan toe.',
  'server.noPlan': 'Aan dit account is geen abonnement gekoppeld.',
  'server.notEnoughTokens': 'U hebt niet genoeg tokens meer.',

  // ── Scans en rapporten ────────────────────────────────────────────
  'server.scanNotStarted': 'De scan kon niet worden gestart.',
  'server.scanInterrupted': 'De scan werd onderbroken.',
  'server.scanFailed': 'De scan kon niet worden voltooid.',
  'server.scanTimeout': 'De scan duurde te lang en werd gestopt.',
  'server.invalidDomain': 'Ongeldig domein.',
  'server.invalidDomainDot': 'Ongeldig domein.',
  'server.invalidRunId': 'Ongeldige scan-ID.',
  'server.reportNotFound': 'Rapport niet gevonden.',
  'server.runNotFound': 'Scan niet gevonden.',
  'server.scanNotFound': 'Scan niet gevonden.',
  'server.resultsNotReady': 'De resultaten zijn nog niet beschikbaar.',
  'server.scanNotFinished': 'De scan is nog niet klaar.',
  'server.reportFailed': 'Het rapport kon niet worden opgesteld.',
  'server.notFound': 'Niet gevonden.',
  'server.internal': 'Er ging iets mis aan onze kant.',

  // ── Contactformulier ──────────────────────────────────────────────
  'server.leadRequired': 'Naam en e-mailadres zijn verplicht.',
  'server.leadFailed': 'Uw aanvraag kon niet worden verstuurd. Probeer het later opnieuw.',

  // ── Betalingen ────────────────────────────────────────────────────
  'server.billingOff': 'Online betalen is nog niet beschikbaar.',
  'server.billingUnconfigured': 'Online betalen is nog niet ingesteld.',
  'server.waiver':
    'Bevestig dat u om onmiddellijke levering vraagt en erken dat u daarmee uw herroepingsrecht van 14 dagen verliest.',
  'server.packChoice': 'Kies een tokenpakket van 10, 50 of 100.',
  'server.packOff': 'Dat tokenpakket kan nog niet online worden gekocht.',
  'server.productChoice': 'Kies Pro of een tokenpakket.',
  'server.proOff': 'Pro kan nog niet online worden gekocht.',

  // ── Jira ──────────────────────────────────────────────────────────
  'server.jiraPro': 'Exporteren naar Jira hoort bij Pro.',
  'server.jiraNotConnected': 'Jira is nog niet gekoppeld voor dit domein. Koppel het eerst.',
  'server.jiraNotConnectedShort': 'Jira is niet gekoppeld voor dit domein.',
  'server.jiraKey': 'Ongeldige Jira-projectsleutel.',
  'server.jiraNoTickets': 'Er zijn geen tickets opgegeven.',
};
