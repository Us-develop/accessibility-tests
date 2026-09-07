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
    guestEyebrow: 'Free snapshot · 1 page · automated WCAG 2.2 AA checks',
    guestTitleBefore: 'Check a page for accessibility — ',
    guestTitleEm: 'in plain English.',
    guestLead:
      'Paste a public URL. We run automated checks aligned with WCAG 2.2 AA and show a score plus the top issues. This is not a full audit or legal sign-off. Need a human audit and remediation? Ask Us for WCAG services after the scan.',
    checkPage: 'Check this page',
    subscribe: 'Subscribe to Pro',
    services: 'Request WCAG services',
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
    guestEyebrow: 'Gratis snapshot · 1 pagina · geautomatiseerde WCAG 2.2 AA-checks',
    guestTitleBefore: 'Check een pagina op toegankelijkheid — ',
    guestTitleEm: 'in klare taal.',
    guestLead:
      'Plak een publieke URL. We draaien geautomatiseerde checks afgestemd op WCAG 2.2 AA en tonen een score plus de belangrijkste issues. Dit is geen volledige audit of juridische goedkeuring. Menselijke audit nodig? Vraag Us om WCAG-diensten na de scan.',
    checkPage: 'Check deze pagina',
    subscribe: 'Abonneer op Pro',
    services: 'Vraag WCAG-diensten aan',
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
