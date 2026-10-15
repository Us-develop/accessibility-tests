/**
 * Titels en meldingen van onze eigen controles (België). Aanspreekvorm: "u".
 * De scanner schrijft ze in de taal van de scan; een rapport houdt die taal.
 * Sleutels en {plaatshouders} zijn identiek aan checks.en.mjs.
 * Concept: nog na te lezen door de copywriters van Us.
 */
export default {
  // ── Structuur en semantiek ────────────────────────────────────────
  'chk.page-title-exists.rule': 'De pagina moet een titel met tekst hebben',
  'chk.page-title-exists.found': 'Titel: "{title}"',
  'chk.page-title-exists.missing': 'De pagina heeft geen titel',
  'chk.html-lang.rule': 'De hoofdtaal moet op het html-element staan',
  'chk.html-lang.found': 'lang="{lang}"',
  'chk.html-lang.missing': 'Lang-attribuut op <html> ontbreekt of is leeg',
  'chk.landmarks-present.rule': 'Gebruik best landmarks voor de opbouw (main, nav, header, footer enz.)',
  'chk.landmarks-present.count': '{n} landmark-element(en) gevonden',
  'chk.single-main.rule': 'De pagina heeft best maar één main-landmark',
  'chk.single-main.count': '{n} main-landmark(s) gevonden',
  'chk.heading-structure.rule':
    'Er is best minstens één h1, en kopniveaus slaan best niets over (bv. h1 → h3)',
  'chk.heading-structure.summary': 'Koppen: {total} in totaal, {h1} h1, {skips} overgeslagen niveau(s)',
  'chk.heading-main-h1.rule': 'De eerste kop in <main> is best een h1 als er koppen staan',
  'chk.heading-main-h1.yes': 'De eerste kop in main is een h1',
  'chk.heading-main-h1.no': 'De eerste kop in main is geen h1',
  'chk.link-text.rule': 'Links moeten tekst hebben die programmatisch te bepalen is',
  'chk.link-text.empty': '{n} link(s) zonder toegankelijke tekst',
  'chk.link-text.checked': '{n} links gecontroleerd',
  'chk.link-meaningful.rule': 'Het doel van een link blijkt best uit de linktekst alleen',
  'chk.link-meaningful.generic': '{n} link(s) met algemene tekst (bv. "klik hier")',
  'chk.skip-link.rule': 'Er is best een skiplink voor toetsenbordgebruikers',
  'chk.skip-link.found': 'Skiplink gevonden',
  'chk.skip-link.missing': 'Geen skiplink gevonden',
  'chk.table-headers.rule': 'Datatabellen moeten koptekstcellen (th) hebben',
  'chk.table-headers.missing': '{n} tabel(len) zonder th',
  'chk.table-headers.ok': 'Alle tabellen hebben koptekstcellen',
  'chk.list-markup.rule': 'Lijsten moeten semantische opmaak gebruiken (ul/ol)',
  'chk.list-markup.orphans': '{n} los(se) li-element(en) gevonden',
  'chk.iframe-titles.rule': 'Iframes moeten een niet-leeg title-attribuut hebben',
  'chk.iframe-titles.missing': '{n} iframe(s) zonder title',
  'chk.iframe-titles.ok': 'Alle iframes hebben een title',
  'chk.unique-ids.rule': 'ID\'s moeten uniek zijn op de pagina',
  'chk.unique-ids.duplicates': 'Dubbele ID\'s: {ids}',

  // ── Afbeeldingen en niet-tekstuele content ────────────────────────
  'chk.img-alt.rule':
    'Informatieve afbeeldingen moeten een programmatisch te bepalen tekstalternatief hebben',
  'chk.img-alt.missing': '{n} afbeelding(en) zonder alt-attribuut',
  'chk.img-alt.ok': '{n} afbeeldingen hebben een alt-tekst',
  'chk.img-alt-length.rule': 'Alternatieve tekst is best beknopt (≤250 tekens)',
  'chk.img-alt-length.long': '{n} afbeelding(en) met alt > 250 tekens',
  'chk.svg-role.rule': 'SVG-elementen hebben best role="img"',
  'chk.svg-role.missing': '{n} SVG(\'s) zonder role="img"',
  'chk.svg-role.ok': 'Alle SVG\'s hebben een role',
  'chk.svg-accessible-name.rule':
    'Informatieve of bedienbare SVG\'s moeten een zinvol tekstalternatief hebben',
  'chk.svg-accessible-name.missing': '{n} SVG(\'s) zonder toegankelijke naam',
  'chk.svg-accessible-name.ok': 'Alle SVG\'s hebben een toegankelijke naam',
  'chk.canvas-alt.rule': 'Canvas-elementen moeten role="img" en een tekstalternatief hebben',
  'chk.canvas-alt.missing': '{n} canvas-element(en) hebben een role en een tekstalternatief nodig',
  'chk.canvas-alt.ok': 'Alle canvas-elementen hebben een role en een alt',
  'chk.image-map-alt.rule': 'Gebieden in een image map moeten een tekstalternatief hebben',
  'chk.image-map-alt.missing': '{n} gebied(en) in een image map zonder alt',

  // ── Contrast en visueel ontwerp ───────────────────────────────────
  'chk.text-contrast.rule': 'Tekstcontrast moet minstens 4,5:1 (gewone tekst) of 3:1 (grote tekst) zijn',
  'chk.text-contrast.fail':
    'Benadering (effen achtergrond; axe meldt WCAG 1.4.3 ook): {n} tekstelement(en) onder het minimale contrast{lowest} op {checked} gecontroleerde element(en)',
  'chk.text-contrast.lowest': ' (laagste: {ratio}:1)',
  'chk.text-contrast.ok':
    'Geen tekst met te weinig contrast gevonden in {checked} gecontroleerde element(en)',
  'chk.non-text-contrast.rule':
    'Visuele onderdelen van de interface moeten een contrast van 3:1 halen (randen, outlines, grenzen van bedieningselementen)',
  'chk.non-text-contrast.fail':
    'Benadering (effen achtergrond; axe meldt WCAG 1.4.11 ook): {n} interface-onderde(e)l(en) met te weinig contrast op {checked} gecontroleerde rand(en) of outline(s)',
  'chk.non-text-contrast.ok':
    'Geen interface-onderdelen met te weinig contrast gevonden in {checked} gecontroleerde rand(en) of outline(s)',
  'chk.contrast-checks-disabled.rule': 'Uitvoering van de contrastcontroles',
  'chk.contrast-checks-disabled.skipped':
    'Contrastcontroles voor tekst en niet-tekstuele content overgeslagen omdat ENABLE_CONTRAST_CHECKS=false',
  'chk.link-differentiation.rule':
    'Links mogen niet alleen op kleur steunen; voorzie een onderstreping of outline bij hover en focus',
  'chk.link-differentiation.colorOnly':
    '{n} link(s) steunen mogelijk alleen op kleur (geen onderstreping of rand)',
  'chk.focus-indicator.rule':
    'Focusbare elementen moeten een zichtbare focusindicator hebben (axe controleert het contrast)',
  'chk.focus-indicator.verify':
    '{n} focusbare elementen: controleer de focusstijlen in de resultaten van axe',

  // ── Responsief ────────────────────────────────────────────────────
  'chk.no-horizontal-scroll.rule':
    'Inhoud mag op 320 px breedte geen horizontaal scrollen vragen (vereenvoudigde controle, geen volledige beoordeling van WCAG 1.4.10)',
  'chk.no-horizontal-scroll.overflow':
    'Horizontale overloop: inhoud {docWidth} px tegenover viewport {viewWidth} px (meer dan 10 px)',
  'chk.no-horizontal-scroll.ok': 'Geen noemenswaardige horizontale overloop op 320 px',
  'chk.viewport-zoom.rule': 'De pagina moet zoomen op mobiel toestaan (geen user-scalable=no)',
  'chk.viewport-zoom.ok': 'De viewport laat zoomen toe',
  'chk.viewport-zoom.restricted': 'De viewport beperkt mogelijk het zoomen: {content}',
  'chk.viewport-zoom.missing': 'Geen viewport-metatag',

  // ── Multimedia ────────────────────────────────────────────────────
  'chk.video-captions.rule': 'Vooraf opgenomen video moet gesynchroniseerde ondertitels hebben',
  'chk.video-captions.missing':
    '{n} video(\'s) zonder ondertitelspoor. Deze tool kan niet zien of de ondertitels in het beeld zijn ingebrand of de video geen gesproken tekst heeft, dus controleer dit met de hand.',
  'chk.video-captions.ok': 'Alle video\'s hebben een ondertitelspoor',
  'chk.video-autoplay.rule': 'Video die automatisch afspeelt (>5 s) moet te pauzeren of te stoppen zijn',
  'chk.video-autoplay.found': '{n} video(\'s) met autoplay: controleer of er een pauzeknop is',
  'chk.audio-autoplay.rule':
    'Audio die langer dan 3 s automatisch afspeelt, moet te stoppen, pauzeren of dempen zijn',
  'chk.audio-autoplay.found': '{n} audio-element(en) met autoplay',
  'chk.flash-alternative.rule': 'Flash of Silverlight heeft best een HTML-alternatief',
  'chk.flash-alternative.found':
    '{n} Flash- of plug-inobject(en) gevonden: zorg voor een toegankelijk alternatief',
  'chk.embedded-media-captions.rule':
    'Bij ingesloten videospelers moeten de ondertitels met de hand worden gecontroleerd (WCAG 1.2.2)',
  'chk.embedded-media-captions.found':
    '{n} ingesloten speler(s) van YouTube, Vimeo of andere gevonden. Controles op <track> gelden hier niet; een mens moet de ondertitels nakijken.',

  // ── Toetsenbord en aanwijzer ──────────────────────────────────────
  'chk.tabindex-positive.rule': 'Gebruik best geen positieve waarden voor tabindex',
  'chk.tabindex-positive.found': '{n} element(en) met een positieve tabindex',
  'chk.tabindex-positive.ok': 'Geen positieve tabindex-waarden',
  'chk.touch-target-size.rule': 'Klikdoelen zijn best minstens 24×24 CSS-pixels (WCAG 2.2 AA 2.5.8)',
  'chk.touch-target-size.small':
    '{n} interactief/interactieve element(en) kleiner dan 24×24 px (uitzonderingen zoals links in lopende tekst worden niet automatisch toegepast)',
  'chk.touch-target-size-enhanced.rule':
    'Klikdoelen kleiner dan 44×44 CSS-pixels (AAA 2.5.5 / richtlijnen van platformen): geen AA-fout',
  'chk.touch-target-size-enhanced.between': '{n} interactief/interactieve element(en) tussen 24 px en 44 px',

  // ── Formulieren ───────────────────────────────────────────────────
  'chk.form-labels.rule': 'Formuliervelden moeten een programmatisch gekoppeld label hebben',
  'chk.form-labels.missing': '{n} veld(en) zonder correct label',
  'chk.form-labels.ok': 'Alle velden hebben een label',
  'chk.placeholder-not-only-label.rule': 'Een placeholder mag niet het enige label van een veld zijn',
  'chk.placeholder-not-only-label.found': '{n} veld(en) gebruiken een placeholder als enige label',
  'chk.placeholder-not-only-label.ok': 'Geen velden met alleen een placeholder als label',

  // ── Dynamische inhoud ─────────────────────────────────────────────
  'chk.no-auto-refresh.rule': 'De pagina mag niet automatisch verversen of herladen',
  'chk.no-auto-refresh.found': 'Meta refresh gevonden: de pagina herlaadt mogelijk vanzelf',
  'chk.no-auto-refresh.ok': 'Geen meta refresh',
  'chk.dynamic-announcements.rule': 'Wijzigingen in dynamische inhoud worden best gemeld (aria-live enz.)',
  'chk.dynamic-announcements.count':
    '{n} aria-live-gebied(en) gevonden: controleer of statusberichten worden voorgelezen',
  'chk.dynamic-status-roles.rule':
    'Status- en alertgebieden (role=status / role=alert): controleer de meldingen voor gebruikers',
  'chk.dynamic-status-roles.found':
    '{n} element(en) met role="status" of role="alert" gevonden: bevestig dat belangrijke updates worden gemeld',
  'chk.dynamic-status-roles.none':
    'Geen gebieden met role="status" of role="alert" gevonden (niet op elke pagina nodig)',
  'chk.dynamic-aria-busy.rule':
    'Laadtoestand (aria-busy): controleer of gebruikers van hulptechnologie gepaste feedback krijgen',
  'chk.dynamic-aria-busy.found':
    '{n} element(en) met aria-busy="true" gevonden: zorg dat updates worden gemeld als het laden klaar is',
  'chk.dynamic-aria-busy.none':
    'Geen aria-busy="true" bij het eerste laden (laadtoestanden van een SPA kunnen pas na interactie verschijnen)',
  'chk.spa-may-be-unrendered.rule':
    'De pagina lijkt in de browser te worden opgebouwd; de automatische controles hebben mogelijk inhoud gemist',
  'chk.spa-may-be-unrendered.found':
    'SPA-root gevonden met maar {n} tekens tekst tijdens de scan. Zet WAIT_FOR_NETWORKIDLE aan of test de URL\'s na het laden. Dit hoofdstuk kan dynamische updates niet bevestigen.',

  // ── Scanner ───────────────────────────────────────────────────────
  'chk.chapter-error.rule': 'Controles voor {chapter}',
  'chk.chapter-error.missing':
    'Deze controles konden op deze pagina niet worden afgerond, dus hun resultaten ontbreken.',
  'chk.large-dom.rule': 'Eigen contrastcontroles overgeslagen bij een grote DOM',
  'chk.large-dom.skipped':
    'Deze pagina heeft {n} nodes. De eigen contrastcontrole werd overgeslagen om time-outs te vermijden; de WCAG-contrastregels van axe liepen wel.',
  'chk.page-load.rule': 'Pagina laden',
  'chk.needs-review.suffix': ' (na te kijken)',
  'chk.page-load.deadline': 'Deze pagina was na {seconds} seconden niet klaar en werd gestopt.',

  // ── Uitleg om op te lossen (bij een bevinding) ────────────────────
  'fix.page-title-exists': '<title>Beschrijvende paginatitel – bv. Home | Bedrijfsnaam</title>',
  'fix.html-lang': '<html lang="nl">',
  'fix.landmarks-present':
    '<main>, <nav>, <header>, <footer>, <aside>, of role="main", role="navigation" enz.',
  'fix.single-main': 'Gebruik precies één <main> of [role="main"] voor de hoofdinhoud.',
  'fix.heading-structure': 'Begin met <h1>, dan <h2>, <h3>… zonder niveaus over te slaan.',
  'fix.heading-main-h1': 'Gebruik <h1> als eerste kop in <main>, voor het hoofdonderwerp van de pagina.',
  'fix.link-text': '<a href="...">Beschrijvende tekst</a> – vermijd lege links of "klik hier".',
  'fix.link-meaningful':
    'De linktekst beschrijft best de bestemming. Vervang "klik hier" door bv. "Download de gids".',
  'fix.skip-link': '<a href="#main" class="skip-link">Ga naar de hoofdinhoud</a>',
  'fix.table-headers': '<th scope="col">Kop</th> of <th scope="row">Rijlabel</th>',
  'fix.list-markup': '<ul><li>...</li></ul> of <ol><li>...</li></ol> voor lijsten.',
  'fix.iframe-titles': '<iframe title="Beschrijving van de inhoud van de iframe" src="...">',
  'fix.unique-ids':
    'Zorg dat elk id-attribuut uniek is op de pagina, vooral id\'s waarnaar labels of ARIA-attributen verwijzen.',
  'fix.img-alt': '<img src="foto.jpg" alt="Beschrijving van de afbeelding">',
  'fix.img-alt-length':
    'Houd de alt-tekst kort (onder ~125 tekens). Gebruik longdesc of tekst rond de afbeelding voor lange beschrijvingen.',
  'fix.svg-role': '<svg role="img" aria-labelledby="titel-grafiek"> of role="presentation" voor decoratie.',
  'fix.svg-accessible-name': '<svg aria-label="Grafiek met..." > of een <title> in de <svg>.',
  'fix.canvas-alt': '<canvas id="c">…</canvas> + een toegankelijk alternatief (tekst of link).',
  'fix.image-map-alt': '<area alt="Beschrijving van het gebied" shape="rect" coords="...">',
  'fix.link-differentiation':
    'Steun niet alleen op kleur. Voeg een onderstreping, icoon of tekst toe (bv. "opent in een nieuw tabblad").',
  'fix.text-contrast':
    'Verhoog het contrast tussen voor- en achtergrond tot minstens 4,5:1 (gewone tekst) of 3:1 (grote tekst).',
  'fix.non-text-contrast':
    'Zorg dat visuele interface-onderdelen (randen, iconen, outlines, focusringen) minstens 3:1 contrast hebben met de kleuren ernaast.',
  'fix.focus-indicator': ':focus { outline: 2px solid currentColor; outline-offset: 2px; }',
  'fix.no-horizontal-scroll':
    'Gebruik max-width: 100% en overflow-wrap: break-word. Vermijd vaste breedtes in pixels.',
  'fix.viewport-zoom': 'Zorg voor user-scalable=yes (of laat het weg) in <meta name="viewport">.',
  'fix.video-captions': '<track kind="captions" src="ondertitels.vtt" srclang="nl">',
  'fix.video-autoplay':
    'Speel niet automatisch af met geluid, of voorzie knoppen om te pauzeren of te dempen.',
  'fix.audio-autoplay': 'Vermijd autoplay. Is het nodig, voorzie dan meteen een pauzeknop.',
  'fix.flash-alternative':
    'Voorzie een HTML-alternatief of zorg dat de inhoud toegankelijk is zonder Flash.',
  'fix.tabindex-positive':
    'Verwijder tabindex > 0. Gebruik de natuurlijke volgorde in de DOM, of tabindex="0" voor focusbare widgets.',
  'fix.touch-target-size':
    'WCAG 2.2 AA 2.5.8: klikdoelen van minstens 24×24 CSS-pixels (met de vermelde uitzonderingen). 44×44 is AAA 2.5.5 / richtlijnen van platformen.',
  'fix.form-labels': '<label for="id">Label</label><input id="id"> of aria-label="Label"',
  'fix.placeholder-not-only-label':
    'Gebruik <label> of aria-label. Een placeholder is een hint, geen vervanging.',
  'fix.no-auto-refresh':
    'Vermijd automatisch verversen. Is het nodig, laat de gebruiker dan de tijd verlengen.',
  'fix.dynamic-announcements': 'Gebruik aria-live="polite" of aria-live="assertive" op live-gebieden.',
  'fix.page-load': 'Controleer de URL, het netwerk, de botbeveiliging en of de server bereikbaar is.',
  'fix.axe.button-name': '<button>Label</button> of aria-label="Label"',
  'fix.axe.color-contrast':
    'Verhoog het contrast tot 4,5:1 (gewone tekst) of 3:1 (grote tekst). Gebruik de contrastchecker van WebAIM.',
  'fix.axe.region': 'Gebruik landmarks: main, nav, header, footer, aside.',
  'fix.axe.landmark-unique': 'Geef landmarks een unieke aria-label als er meerdere van hetzelfde type zijn.',
  'fix.axe.focus-order-semantics':
    'Zorg dat de volgorde in de DOM de visuele volgorde volgt. Vermijd een positieve tabindex.',
  'fix.axe.aria-valid-attr': 'Gebruik alleen geldige ARIA-attributen. Zie de ARIA-referentie van MDN.',
  'fix.axe.aria-valid-attr-value':
    'Zorg dat ARIA-attributen geldige waarden hebben (bv. aria-expanded="true" of "false").',
  'fix.axe.aria-required-attr':
    'Voeg alle verplichte ARIA-attributen voor de rol toe (een combobox heeft bv. aria-expanded nodig).',
  'fix.axe.form-field-multiple-labels': 'Elk formulierveld heeft best één gekoppeld label.',
  'fix.default': 'Bekijk het probleem en pas een gepaste oplossing toe. Zie de WCAG-richtlijnen van W3C.',

  // ── Dekking: toelichting en samenvatting (pagina WCAG-dekking) ────
  'covnote.1.1.1':
    'Controleert of afbeeldingen, SVG, canvas en image maps een alt-tekst of naam hebben, niet of die tekst zinvol is.',
  'covnote.1.2.1': 'De kwaliteit van transcripties en audiodescriptie wordt niet getest.',
  'covnote.1.2.2':
    'Alleen ondertitelsporen van een eigen <video>. YouTube en Vimeo worden gemeld voor een mens. De kwaliteit wordt niet getest.',
  'covnote.1.2.3': 'Audiodescriptie of een media-alternatief wordt niet getest.',
  'covnote.1.2.4': 'Live-ondertiteling wordt niet getest.',
  'covnote.1.2.5': 'Audiodescriptie bij vooraf opgenomen video wordt niet getest.',
  'covnote.1.3.1':
    'Landmarks, koppen, tabellen, lijsten en de axe-regels voor info en relaties. Programmatische relaties in eigen widgets worden vaak gemist.',
  'covnote.1.3.2': 'Een betekenisvolle leesvolgorde vraagt een mens (en een schermlezer).',
  'covnote.1.3.3': 'Instructies die steunen op vorm, grootte of plaats worden niet herkend.',
  'covnote.1.3.4': 'Een vergrendelde weergavestand wordt niet getest.',
  'covnote.1.3.5': 'Autocomplete en het doel van invoervelden worden niet getest.',
  'covnote.1.4.1':
    'Alleen een heuristiek die linkkleur met de lopende tekst vergelijkt. De meeste gevallen van "alleen kleur" vragen een mens.',
  'covnote.1.4.2': 'Meldt automatisch afspelende <audio> en <video>; bewijst niet dat er een pauzeknop is.',
  'covnote.1.4.3':
    'Eigen contrastcontrole plus axe. Overgeslagen bij zeer grote DOM\'s (ter info). Een benadering, geen volledige visuele audit.',
  'covnote.1.4.4': 'Controleert of de viewport zoomen toelaat. Test geen herschikking op 200%.',
  'covnote.1.4.5': 'Afbeeldingen van tekst worden niet herkend.',
  'covnote.1.4.10':
    'Horizontale overloop op 320 px met een marge van 10 px. Bewijst niet dat scrollen in twee richtingen overal vermeden wordt.',
  'covnote.1.4.11':
    'Benadering van het contrast van niet-tekstuele content plus axe; dezelfde beperkingen als bij 1.4.3.',
  'covnote.1.4.12': 'Tekstafstand (eigen CSS van de gebruiker) wordt niet getest.',
  'covnote.1.4.13': 'Of inhoud bij hover of focus kan worden gesloten en aangewezen, wordt niet getest.',
  'covnote.2.1.1':
    'Waarschuwing bij een positieve tabindex en de axe-regels rond toetsenbordgebruik. Tabt niet door de pagina.',
  'covnote.2.1.2': 'Er wordt niet naar toetsenbordvallen gezocht.',
  'covnote.2.1.4': 'Sneltoetsen van één teken worden niet herkend.',
  'covnote.2.2.1': 'Tijdslimieten worden niet getest.',
  'covnote.2.2.2':
    'Heuristiek voor meta refresh en automatisch verversen. Bewegende inhoud vraagt meestal een mens.',
  'covnote.2.3.1': 'Alleen een controle op verouderde Flash-objecten. Flitsende inhoud wordt niet gemeten.',
  'covnote.2.4.1':
    'Aanwezigheid van een skiplink en landmarks. Andere manieren om blokken over te slaan worden mogelijk gemist.',
  'covnote.2.4.2': 'Het title-element bestaat. Of de titel uniek en beschrijvend is, wordt niet getest.',
  'covnote.2.4.3':
    'Waarschuwing bij een positieve tabindex. De volgorde in de DOM tegenover de visuele volgorde wordt niet getest.',
  'covnote.2.4.4':
    'Heuristieken voor lege links en "klik hier". Het doel in de context vraagt vaak een mens.',
  'covnote.2.4.5': 'Meerdere manieren om pagina\'s te vinden is een controle op siteniveau.',
  'covnote.2.4.6':
    'Heuristiek voor de opbouw van de koppen. Of de koppen het onderwerp beschrijven, wordt niet getest.',
  'covnote.2.4.7': 'Heuristiek voor de focusindicator. Zichtbaarheid in alle toestanden vraagt een mens.',
  'covnote.2.4.11': 'Of de focus bedekt wordt (vaste headers, cookiebalken), wordt niet getest.',
  'covnote.2.5.1': 'Gebaren met een pad worden niet getest.',
  'covnote.2.5.2': 'Het annuleren van een aanwijzeractie wordt niet getest.',
  'covnote.2.5.3':
    'Label in naam (zichtbare tekst tegenover toegankelijke naam) wordt hier niet als aparte controle getest.',
  'covnote.2.5.4': 'Bediening door beweging wordt niet getest.',
  'covnote.2.5.7': 'Sleepbewegingen worden niet getest.',
  'covnote.2.5.8':
    'Waarschuwing onder 24×24 CSS-pixels. De vermelde uitzonderingen (links in lopende tekst enz.) worden niet automatisch toegepast.',
  'covnote.3.1.1':
    'Lang-attribuut op <html>. Of de taalcode geldig is en de taal van onderdelen worden niet getest.',
  'covnote.3.1.2': 'De taal van onderdelen wordt niet getest.',
  'covnote.3.2.1': 'Contextwijzigingen bij focus worden niet getest.',
  'covnote.3.2.2': 'Contextwijzigingen bij invoer worden niet getest.',
  'covnote.3.2.3': 'Consistente navigatie is een menselijke controle over meerdere pagina\'s.',
  'covnote.3.2.4': 'Consistente identificatie is een menselijke controle over meerdere pagina\'s.',
  'covnote.3.2.6': 'Consistente hulp wordt niet getest.',
  'covnote.3.3.1': 'Of fouten in tekst worden aangeduid, wordt niet automatisch getest.',
  'covnote.3.3.2':
    'Heuristieken voor labels en placeholders als label. De kwaliteit van instructies wordt niet getest.',
  'covnote.3.3.3': 'Foutsuggesties worden niet getest.',
  'covnote.3.3.4': 'Foutpreventie bij juridische en financiële gegevens wordt niet getest.',
  'covnote.3.3.7': 'Overbodige invoer wordt niet getest.',
  'covnote.3.3.8': 'Toegankelijke authenticatie wordt niet getest.',
  'covnote.4.1.1': 'Dubbele id\'s en de axe-regels rond parsen. WCAG 2.2 noemt 4.1.1 verouderd.',
  'covnote.4.1.2':
    'Namen van bedieningselementen, iframes en SVG; naam, rol en waarde volgens axe. Eigen widgets vragen vaak een mens.',
  'covnote.4.1.3':
    'Heuristieken voor aria-live en statusrollen. Of meldingen correct worden voorgelezen, wordt niet nagegaan.',
  'covtext.sc': '{id} {title} (niveau {level})',
  'covtext.checked.intro':
    'Deze scan probeerde automatische controles voor {attempted} van de {total} succescriteria van WCAG 2.2 op niveau A en AA ({all} in totaal). De automatische controles kijken naar aanwezigheid of gebruiken heuristieken: geslaagd betekent dat de machinecontrole niet faalde, niet dat aan het criterium is voldaan.',
  'covtext.checked.fails': 'In deze scan raken automatische fouten of waarschuwingen nog aan: {list}.',
  'covtext.checked.none':
    'In deze scan toonde geen enkel gekoppeld succescriterium een automatische fout of waarschuwing. Dat betekent niet dat WCAG gehaald is.',
  'covtext.notChecked':
    '{n} succescriteria worden door deze scanner niet gecontroleerd. Voorbeelden zijn de kwaliteit van ondertitels, toetsenbordvallen, toegankelijke authenticatie en consistente navigatie. axe-core en onze eigen controles kunnen de meeste daarvan niet zien.',
  'covtext.manual.intro':
    'Van die niet-geteste criteria kunnen er {n} worden gedekt met de Handmatige controles in de app (toetsenbord, schermlezer, zoom, kwaliteit van ondertitels, zinvolle namen en verwante punten).',
  'covtext.manual.list': 'Daaronder: {list}.',
  'covtext.manual.honest': 'Een vinkje telt alleen als iemand die test echt heeft gedaan.',
  'covtext.path':
    'Als de automatische bevindingen opgelost zijn en de handmatige controles en de tests met hulptechnologie grondig gebeuren (echte tests met toetsenbord, schermlezer en zoom, niet alleen vinkjes), dan hebt u zowel gedekt wat deze scanner kan vinden als de menselijke controles die dit product bevat. Daarvoor is deze tool gemaakt, en het is nodig voor WCAG 2.2 AA. Op zich is het niet genoeg: {n} succescriteria vallen buiten deze checklist{examples}. Het product goed afwerken maakt de site op zich niet volledig conform.',
  'covtext.path.examples': ' (waaronder {list})',
  'covtext.disclaimer':
    'Dit is geen officiële WCAG 2.2 AA-audit, geen EN 301 549-certificering en geen juridische goedkeuring onder de EAA. Neem contact op met Us of een andere bevoegde toegankelijkheidsprofessional voor een officiële evaluatie voordat u een conformiteitsverklaring publiceert.',
  'covtext.otherFindings': 'eigen controle',
};
