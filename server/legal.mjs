export const LEGAL = {
  en: {
    termsTitle: 'Terms of service',
    privacyTitle: 'Privacy policy',
    cookiesTitle: 'Cookie policy',
    a11yTitle: 'Accessibility statement',
  },
  nl: {
    termsTitle: 'Algemene voorwaarden',
    privacyTitle: 'Privacybeleid',
    cookiesTitle: 'Cookiebeleid',
    a11yTitle: 'Toegankelijkheidsverklaring',
  },
};

export function orgIdentity() {
  return {
    name: String(process.env.LEGAL_ORG_NAME || 'Us').trim(),
    kbo: String(process.env.LEGAL_KBO || '').trim(),
    address: String(process.env.LEGAL_ADDRESS || '').trim(),
    email: String(process.env.LEGAL_EMAIL || 'info@about-us.be').trim(),
  };
}
