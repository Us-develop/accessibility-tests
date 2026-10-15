/**
 * Nederlandse teksten (België). Aanspreekvorm: "u".
 * Sleutels en {plaatshouders} zijn identiek aan en.mjs.
 * Concept: nog na te lezen door de copywriters van Us.
 */
export default {
  // ── Layout en voettekst ────────────────────────────────────────────
  'layout.skip': 'Ga naar de hoofdinhoud',
  'layout.staffBanner': 'U bent aangemeld als medewerker',
  'layout.noscript.guest': 'Schakel JavaScript in om een gratis toegankelijkheidscontrole uit te voeren.',
  'layout.noscript.required': 'Schakel JavaScript in om u aan te melden en deze toepassing te gebruiken.',
  'layout.defaultTitle': 'Toegankelijkheidsaudit · Us',
  'footer.aria': 'Juridische informatie',
  'footer.pricing': 'Prijzen',
  'footer.terms': 'Voorwaarden',
  'footer.privacy': 'Privacy',
  'footer.cookies': 'Cookies',
  'footer.subprocessors': 'Subverwerkers',
  'footer.accessibility': 'Toegankelijkheid',
  'footer.vat': 'btw',
  'cta.expert': 'Praat met een WCAG-expert',
  'cta.buyTokens': 'Tokens kopen',
  'cta.subscribePro': 'Abonneren op Pro',
  'cta.signIn': 'Aanmelden',
  'cta.contactUs': 'Neem contact op met Us',

  // ── Koptekst ───────────────────────────────────────────────────────
  'header.home': 'Us startpagina',
  'header.progress': 'Voortgang van de audit',
  'header.setup': 'Audit instellen',
  'header.menu': 'Menu openen',
  'header.allScans': 'Alle scans',
  'header.startScan': 'Nieuwe scan starten',
  'header.account': 'Account',
  'header.pricing': 'Prijzen',
  'header.aligned': 'Afgestemd op WCAG 2.2 AA',
  'header.signup': 'Account aanmaken',
  'header.login': 'Aanmelden',
  'header.logout': 'Afmelden',
  'header.lang.label': 'Taal',
  'header.lang.current': 'huidige taal',
  'header.balance.label': 'Uw saldo: {balance}. Open uw account.',
  'header.step.history': 'Geschiedenis',
  'header.step.results': 'Resultaten',
  'header.step.coverage': 'Dekking',
  'header.step.sales': 'Verkoop',
  'header.step.statement': 'Verklaring',
  'header.step.developer': 'Ontwikkelaar',
  'header.crumb.newScan': 'Nieuwe scan',

  // ── Saldo (koptekst, startpagina, account, rapport) ────────────────
  'balance.tokens.one': '{n} token',
  'balance.tokens.other': '{n} tokens',
  'balance.proPages.one': '{n} Pro-pagina',
  'balance.proPages.other': "{n} Pro-pagina's",
  'balance.tokensLeft.one': '{n} token over',
  'balance.tokensLeft.other': '{n} tokens over',
  'balance.proLeft': "{left} van {total} Pro-pagina's over deze maand",

  // ── Betaalmeldingen (prijzen en account) ───────────────────────────
  'checkout.error.generic': 'De betaling kon niet worden gestart.',
  'checkout.error.tick': 'Vink eerst het vakje hierboven aan: dat is nodig voordat wij uw betaling kunnen verwerken.',
  'checkout.error.network': 'De betaling kon niet worden gestart. Controleer uw verbinding en probeer het opnieuw.',
  'checkout.starting': 'De betaling wordt gestart…',
  'checkout.resume.welcome': 'Welkom terug. Wij brengen u naar de betaling…',
  'checkout.resume.tick': 'Vink het vakje hierboven aan en kies daarna opnieuw uw optie om door te gaan naar de betaling.',
  'checkout.waiver.note':
    'Deze verklaring wordt in het Engels vastgelegd, de bindende taal van onze voorwaarden. Vertaling: ik vraag om onmiddellijke levering van de digitale dienst en erken dat ik mijn herroepingsrecht van 14 dagen verlies zodra de levering begint.',

  // ── Startpagina ───────────────────────────────────────────────────
  'home.title': 'Gratis toegankelijkheidscheck · Us',
  'home.description':
    'Doe een gratis WCAG 2.2 AA-toegankelijkheidsscan van één pagina. Zie een score en de belangrijkste problemen voordat u tokens koopt of Pro neemt.',
  'home.crumb.guest': 'Gratis check',
  'home.crumb.customer': 'Uw scan',
  'home.guest.eyebrow': 'Gratis scan · 1 pagina',
  'home.guest.h1': 'Doe een gratis toegankelijkheidscheck van uw pagina',
  'home.guest.lead':
    'Vul een openbare URL in en krijg meteen een toegankelijkheidsscore en de belangrijkste problemen die we vinden. U krijgt één gratis scan per persoon. U hebt geen account nodig. Door een scan te starten, bevestigt u dat u deze URL mag laten scannen.',
  'home.guest.label': 'Vul de URL van uw pagina in',
  'home.guest.used.title': 'U hebt uw gratis scan al gebruikt.',
  'home.guest.used.body':
    'Wilt u opnieuw scannen? Koop tokens (één token is één pagina), neem een Pro-abonnement of meld u aan als u al een account hebt.',
  'home.guest.note':
    'Automatische scan op basis van WCAG 2.2 AA-controles. Dit is een snelle momentopname, geen volledige toegankelijkheidsaudit.',
  'home.guest.submit': 'Scan deze pagina gratis',
  'home.more': 'Meer dan één pagina nodig, of het volledige rapport?',
  'home.help': 'Hulp nodig met toegankelijkheid?',
  'home.limitations': 'Wat deze scan wel en niet kan testen',
  'home.customer.eyebrow': 'Uw account · Pro-pagina\'s of tokens',
  'home.customer.h1': 'Scan pagina\'s in uw account',
  'home.customer.lead':
    'Een scan gebruikt eerst uw gratis scan (als u die nog hebt), dan uw maandelijkse Pro-pagina\'s en daarna uw tokens. Elke URL is één paginascan. Tot 50 URL\'s per keer.',
  'home.customer.pricing': 'Prijzen',
  'home.customer.buyTokens': 'Extra tokens kopen',
  'home.customer.label': 'URL\'s van de pagina\'s',
  'home.customer.hint':
    'Eén openbare URL per regel, allemaal van hetzelfde domein. Pro omvat 300 pagina\'s per maand; extra pagina\'s gebruiken tokens.',
  'home.customer.barTitle': 'Bewaar de resultaten in uw account',
  'home.customer.barBody': 'Volledig rapport, gekoppeld aan uw account en dit domein.',
  'home.customer.submit': 'Scan starten',
  'home.customer.account': 'Account',
  'home.customer.projects': 'Uw projecten',
  'home.usage.empty': '{balance}. Koop tokens of neem Pro om opnieuw te scannen.',
  'home.usage.pro': 'Pro · {balance}',
  'home.usage.noPro': 'Geen Pro · {balance}',
  'home.seePricing': 'Bekijk de prijzen',
  'home.error.generic': 'Er ging iets mis. Probeer het opnieuw.',
  'home.error.freeScan': 'De gratis scan kon niet worden gestart.',
  'home.error.scan': 'De scan kon niet worden gestart.',
  'home.error.signIn': 'Meld u aan om een scan te starten.',
  'home.error.network':
    'We konden de server niet bereiken. Controleer uw verbinding en probeer het opnieuw.',

  // ── Scan bezig ────────────────────────────────────────────────────
  'loading.title': 'Scan bezig · {site}',
  'loading.description':
    'Uw toegankelijkheidsscan loopt. Deze pagina wordt bijgewerkt zodra het rapport klaar is.',
  'loading.crumb': 'Bezig',
  'loading.missing.h1': 'Scan niet gevonden',
  'loading.missing.before': 'We vonden geen scan in deze link. Ga terug naar de',
  'loading.missing.link': 'gratis check',
  'loading.missing.after': 'om opnieuw te beginnen.',
  'loading.eyebrow.queued': 'Wachten op een vrije scanner',
  'loading.eyebrow.running': 'Scan bezig',
  'loading.eyebrow.checks': 'automatische WCAG 2.2 AA-controles',
  'loading.h1.queued': 'U staat in de wachtrij.',
  'loading.h1.one': 'We controleren uw pagina op toegankelijkheidsproblemen',
  'loading.h1.other': 'We controleren uw pagina\'s op toegankelijkheidsproblemen',
  'loading.lead.queued':
    'Andere scans gebruiken de scanners op dit moment. De uwe start vanzelf; houd dit tabblad open.',
  'loading.lead.guest':
    'We voeren automatische WCAG 2.2 AA-controles uit op uw pagina. Zo dadelijk ziet u uw toegankelijkheidsscore en de belangrijkste problemen die we vonden.',
  'loading.lead.one':
    'We voeren automatische WCAG 2.2 AA-controles uit op uw pagina. U kunt dit tabblad sluiten: het rapport wordt bewaard zodra het klaar is.',
  'loading.lead.other':
    'We voeren automatische WCAG 2.2 AA-controles uit op {n} pagina\'s. U kunt dit tabblad sluiten: het rapport wordt bewaard zodra het klaar is.',
  'loading.snapshot': 'Deze automatische scan is een momentopname, geen volledige toegankelijkheidsaudit.',
  'loading.stage.compiling': 'Rapport wordt opgesteld',
  'loading.stage.queued': 'Wachten in de wachtrij',
  'loading.stage.starting': 'Scan wordt gestart',
  'loading.stage.scanning': 'Bezig met scannen',
  'loading.stage.page': 'Pagina {n} van {total} wordt gescand',
  'loading.done': 'Scan klaar. Het rapport wordt geopend.',
  'loading.urls.one': '{n} URL klaargezet',
  'loading.urls.other': '{n} URL\'s klaargezet',
  'loading.current': 'Nu bezig met:',
  'loading.pageOf': 'Pagina {n} van {total}',
  'loading.waiting': 'Wachten op de eerste pagina',
  'loading.counts': 'Het aantal problemen verschijnt zodra de scan klaar is.',
  'loading.error.notFound': 'Scan niet gevonden.',
  'loading.error.session': 'Uw sessie is verlopen. Meld u opnieuw aan.',
  'loading.footer.guest':
    'Gratis check bezig · Houd dit tabblad open tot uw resultaten verschijnen. Als u het sluit, verliest u de link.',
  'loading.footer.run': 'Audit-ID: {id} · U kunt dit tabblad gerust sluiten.',

  // ── Prijzen ────────────────────────────────────────────────────────
  'pricing.title': 'Prijzen · Us toegankelijkheidsscanner',
  'pricing.description':
    'Gratis scan, tokenpakketten en een Pro-abonnement, plus handmatige tests door onze experts. Prijzen in EUR inclusief btw.',
  'pricing.crumb': 'Prijzen',
  'pricing.eyebrow': 'Prijzen incl. btw · EUR',
  'pricing.h1': 'Gratis scan, tokens en Pro',
  'pricing.lead':
    'Begin met een gratis scan van één openbare pagina. Wilt u dieper gaan? Gebruik tokens voor volledige toegankelijkheidsrapporten, of neem een abonnement voor terugkerende maandelijkse scans. Voor een grondigere beoordeling kunnen onze toegankelijkheidsexperts ook handmatig testen en u helpen de bevindingen om te zetten in concrete verbeteringen.',
  'pricing.canceled': 'De betaling is geannuleerd. Er is niets aangerekend.',
  'pricing.free.h2': 'Gratis scan',
  'pricing.free.body':
    'Scan gratis 1 openbare URL en krijg een toegankelijkheidsscore en de 3 belangrijkste problemen die we vinden. U krijgt één gratis momentopname per persoon, of u nu als gast scant of aangemeld bent. Wilt u verder gaan? Koop tokens voor volledige rapporten of neem een abonnement voor terugkerende scans.',
  'pricing.free.cta': 'Deze pagina gratis scannen',
  'pricing.tokens.h2': 'Tokens',
  'pricing.tokens.unit': 'per URL-scan',
  'pricing.tokens.body':
    'Betaal per scan met flexibele tokenpakketten. 1 token geeft u een volledig toegankelijkheidsrapport voor 1 URL. Pakketten beginnen bij 10 tokens, en ongebruikte tokens blijven 12 maanden geldig.',
  'pricing.tokens.pack': '{n} tokens: {price}',
  'pricing.tokens.buy': '{n} kopen',
  'pricing.tokens.unavailable': 'Tokenpakketten kunnen nog niet online worden gekocht.',
  'pricing.includes': 'Elke scan omvat',
  'pricing.proOnly': '{feature}: alleen met Pro',
  'pricing.pro.h2': 'Pro',
  'pricing.pro.perMonth': 'per maand',
  'pricing.pro.yearlyNote': 'Of {yearly} per jaar (2 maanden gratis)',
  'pricing.pro.pages': '{n} paginascans per maand',
  'pricing.pro.perRun': 'Scan tot {n} URL\'s per keer',
  'pricing.pro.oneAtATime': '1 scan tegelijk',
  'pricing.pro.projects': 'Onbeperkt aantal projecten',
  'pricing.pro.support': 'Ondersteuning via e-mail',
  'pricing.pro.monthly': 'Maandelijks abonneren',
  'pricing.pro.yearly': 'Jaarlijks abonneren',
  'pricing.pro.unavailable': 'Pro kan nog niet online worden gekocht.',
  'pricing.unavailable.contact': 'en wij regelen het voor u.',
  'pricing.services.h2': 'Meer nodig dan een automatische scan?',
  'pricing.services.body':
    'Onze toegankelijkheidsexperts helpen met handmatige WCAG-tests, ondersteuning bij het herstellen, toegankelijkheidsverklaringen en opleidingen. We stemmen de aanpak af op uw website, uw team en wat u wilt verbeteren.',
  'pricing.vatNote':
    'Prijzen zijn inclusief Belgische btw. Belgische bedrijven betalen 21 % btw. EU-bedrijven met een geldig btw-nummer betalen geen btw, volgens de verleggingsregeling. Voor consumenten in de EU wordt bij het afrekenen het juiste lokale btw-tarief toegepast.',
  'feature.fullReport': 'Toegang tot het dashboard: elk probleem, waar het zit en hoe u het oplost',
  'feature.developerGuide': 'Gids voor ontwikkelaars: een herstellijst voor uw ontwikkelaars',
  'feature.statement': 'Toegankelijkheidsverklaring: een ontwerp om aan te vullen en te publiceren',
  'feature.manualChecklist': 'Checklist voor handmatige tests: de controles die alleen een mens kan doen',
  'feature.history': 'Scangeschiedenis: uw eerdere scans en hoe uw score evolueert',
  'feature.salesReport': 'Verkooprapport: een pdf-samenvatting voor management of klanten',
  'feature.jira': 'Jira-integratie: herstelpunten als issues naar Jira sturen',

  // ── Contactpagina en contactformulier ──────────────────────────────
  'contact.title': 'Praat met een WCAG-expert · Us',
  'contact.description':
    'Vraag Us om een toegankelijkheidsaudit, hulp bij het oplossen van bevindingen, een toegankelijkheidsverklaring of een opleiding.',
  'contact.crumb': 'Contact',
  'contact.eyebrow': 'Diensten van Us',
  'contact.h1': 'Praat met een WCAG-expert',
  'contact.lead':
    'De scanner vindt wat een machine kan vinden. Voor de rest helpt een mens: een handmatige audit met hulptechnologie, het oplossen van de bevindingen, een toegankelijkheidsverklaring of een opleiding voor uw team.',
  'contact.form.heading': 'Vertel ons wat u nodig hebt',
  'contact.form.intro':
    'Laat uw gegevens en een korte omschrijving achter. Een toegankelijkheidsspecialist antwoordt binnen twee werkdagen. Vrijblijvend.',
  'lead.heading': 'Praat met een WCAG-expert',
  'lead.intro':
    'Liever ondersteuning van een expert? Wij kunnen de site auditen, de bevindingen prioriteren en ze omzetten in concrete verbeteringen. Vrijblijvend.',
  'lead.name': 'Naam',
  'lead.company': 'Bedrijf',
  'lead.email': 'E-mailadres',
  'lead.phone': 'Telefoon (optioneel)',
  'lead.message': 'Bericht',
  'lead.privacy.before': 'Wij gebruiken deze gegevens alleen om contact met u op te nemen over deze aanvraag. Lees onze',
  'lead.privacy.link': 'privacyverklaring',
  'lead.submit': 'Mijn aanvraag versturen',
  'lead.sending': 'Bezig met versturen…',
  'lead.error.generic': 'Uw aanvraag kon niet worden verstuurd.',
  'lead.error.network': 'Wij konden de server niet bereiken. Controleer uw verbinding en probeer het opnieuw.',
  'lead.sent.heading': 'Bedankt, uw aanvraag is onderweg',
  'lead.sent.body.before': 'Een van onze toegankelijkheidsspecialisten antwoordt op',
  'lead.sent.body.after': 'binnen twee werkdagen.',
  'lead.sent.confirmation':
    'Wij hebben een bevestiging naar dat adres gestuurd. Kijk in uw map met ongewenste e-mail als u ze niet ziet.',
  'lead.sent.scan': 'Een nieuwe scan starten',
  'lead.sent.pricing': 'Prijzen bekijken',

  // ── Account aanmaken ───────────────────────────────────────────────
  'signup.title': 'Account aanmaken · Us',
  'signup.description':
    'Maak een account aan voor de Us toegankelijkheidsscanner om momentopnames te bewaren, tokens te kopen of een Pro-abonnement te nemen.',
  'signup.crumb': 'Account aanmaken',
  'signup.h1': 'Account aanmaken',
  'signup.h1.checkEmail': 'Controleer uw e-mail',
  'signup.lead.pricing':
    'Maak een account aan om tokenpakketten te kopen of een Pro-abonnement te nemen. Nadat u uw e-mailadres hebt bevestigd, keert u terug naar de prijzen en gaat u verder naar de betaling.',
  'signup.lead.guest':
    'Bewaar uw momentopnames als gast bij uw e-mailadres. De openbare controle van 1 pagina blijft gratis zonder account.',
  'signup.lead.default':
    'Maak een account aan om uw scangeschiedenis te bewaren, tokenpakketten te kopen of een Pro-abonnement te nemen.',
  'signup.check.body':
    'Open de link die wij u hebben gestuurd en klik daarna op E-mailadres bevestigen. Een voorbeeldweergave van de e-mail volstaat niet.',
  'signup.check.pricing': 'Daarna komt u terug bij de prijzen om tokens te kopen of een abonnement te nemen.',
  'signup.check.already': 'Al bevestigd?',
  'signup.name': 'Naam',
  'signup.email': 'E-mailadres',
  'signup.password': 'Wachtwoord (min. 10 tekens)',
  'signup.business': 'Ik koop voor een bedrijf',
  'signup.company': 'Bedrijf',
  'signup.vat': 'Btw-nummer (optioneel)',
  'signup.accept.before': 'Ik aanvaard de',
  'signup.accept.terms': 'gebruiksvoorwaarden',
  'signup.accept.middle': 'en heb de',
  'signup.accept.privacy': 'privacyverklaring gelezen',
  'signup.submit': 'Account aanmaken',
  'signup.error.query':
    'Het account kon niet worden aangemaakt. Probeer een ander e-mailadres, of meld u aan als u al een account hebt.',
  'signup.error.generic': 'Het account kon niet worden aangemaakt.',
  'signup.haveAccount': 'Hebt u al een account? Gebruik',
  'signup.login': 'Aanmelden',
};
