const EN = {
  lang: 'en',
  otherLang: 'nl',
  otherLangLabel: 'NL',
  nav: {
    login: 'Log in',
    signup: 'Create account',
    pricing: 'Pricing',
    account: 'Account',
    audits: 'All scans',
    limitations: 'Limitations',
  },
  home: {
    guestEyebrow: 'Free · 1 page · automated WCAG 2.2 AA checks',
    guestTitle: 'Run a free accessibility check on your page',
    guestLead:
      'Enter any public URL and scan one page for free — no sign-up, no waiting. You will see your results as soon as the scan is complete. This is an automated check, not a full WCAG audit or legal sign-off.',
    checkPage: 'Scan this page for free',
    subscribe: 'Get full access',
    services: 'Talk to a WCAG expert',
    selectFile: 'Select a file',
    noFileSelected: 'No file selected',
  },
  pricing: {
    title: 'Pro access for people who need the full scanner',
    lead: 'The free snapshot shows what automation can find on one public page. Pro unlocks history, sitemaps, the developer guide, and 300 page-scans each month.',
    monthly: '€49 / month',
    yearly: '€490 / year',
    founding: 'Founding price €39 / month, locked 12 months, first 50 subscribers.',
    notLegal: 'This is an assisted automated scanner, not a WCAG 2.2 AA or EAA certificate.',
  },
  legal: {
    terms: 'Terms of service',
    privacy: 'Privacy',
    cookies: 'Cookies',
    a11y: 'Accessibility statement',
  },
};

const NL = {
  lang: 'nl',
  otherLang: 'en',
  otherLangLabel: 'EN',
  nav: {
    login: 'Inloggen',
    signup: 'Account maken',
    pricing: 'Prijzen',
    account: 'Account',
    audits: 'Alle scans',
    limitations: 'Beperkingen',
  },
  home: {
    guestEyebrow: 'Gratis · 1 pagina · geautomatiseerde WCAG 2.2 AA-checks',
    guestTitle: 'Start een gratis toegankelijkheidscheck van je pagina',
    guestLead:
      'Vul een publieke URL in en scan één pagina gratis — zonder account, zonder wachten. Je ziet de resultaten zodra de scan klaar is. Dit is een geautomatiseerde check, geen volledige WCAG-audit of juridische goedkeuring.',
    checkPage: 'Scan deze pagina gratis',
    subscribe: 'Krijg volledige toegang',
    services: 'Praat met een WCAG-expert',
    selectFile: 'Select a file',
    noFileSelected: 'No file selected',
  },
  pricing: {
    title: 'Pro-toegang voor wie de volledige scanner nodig heeft',
    lead: 'De gratis snapshot toont wat automatisering op één publieke pagina kan vinden. Pro opent geschiedenis, sitemaps, de developer guide en 300 paginascans per maand.',
    monthly: '€49 / maand',
    yearly: '€490 / jaar',
    founding: 'Founding-prijs €39 / maand, 12 maanden vast, eerste 50 abonnees.',
    notLegal: 'Dit is een geassisteerde automatische scanner, geen WCAG 2.2 AA- of EAA-certificaat.',
  },
  legal: {
    terms: 'Algemene voorwaarden',
    privacy: 'Privacy',
    cookies: 'Cookies',
    a11y: 'Toegankelijkheidsverklaring',
  },
};

export function resolvePageLang({ searchLang, cookieLang } = {}) {
  if (searchLang === 'nl' || searchLang === 'en') return searchLang;
  if (cookieLang === 'nl' || cookieLang === 'en') return cookieLang;
  return 'en';
}

export function resolveLang(input) {
  const raw = typeof input === 'string' ? input : '';
  if (raw.toLowerCase().startsWith('nl')) return 'nl';
  return 'en';
}

export function langFromRequest(req) {
  const q = req?.query?.lang;
  if (q === 'nl' || q === 'en') return q;
  const cookie = String(req?.headers?.cookie || '');
  const m = cookie.match(/(?:^|;\s*)lang=(nl|en)(?:;|$)/i);
  if (m) return m[1].toLowerCase();
  const accept = String(req?.headers?.['accept-language'] || '');
  if (accept.toLowerCase().startsWith('nl')) return 'nl';
  return 'en';
}

export function t(lang) {
  return resolveLang(lang) === 'nl' ? NL : EN;
}

export function langCookieHeader(lang) {
  const value = resolveLang(lang);
  return `lang=${value}; Path=/; Max-Age=31536000; SameSite=Lax`;
}
