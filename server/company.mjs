const COMPANY_FIELDS = [
  ['legalName', 'COMPANY_LEGAL_NAME'],
  ['kbo', 'COMPANY_KBO'],
  ['vat', 'COMPANY_VAT'],
  ['address', 'COMPANY_ADDRESS'],
  ['email', 'COMPANY_EMAIL'],
];

/** Shown in the site footer when set; not required. */
const COMPANY_OPTIONAL_FIELDS = [
  ['phone', 'COMPANY_PHONE'],
  ['website', 'COMPANY_WEBSITE'],
  ['linkedin', 'COMPANY_LINKEDIN_URL'],
];

export function companyIdentity() {
  const out = {};
  for (const [key, envName] of [...COMPANY_FIELDS, ...COMPANY_OPTIONAL_FIELDS]) {
    out[key] = String(process.env[envName] || '').trim();
  }
  return out;
}

/** The KBO public search page for the company number, or '' without one. */
export function kboLookupUrl(kbo) {
  const digits = String(kbo || '').replace(/\D/g, '');
  return digits.length === 10
    ? `https://kbopub.economie.fgov.be/kbopub/zoeknummerform.html?nummer=${digits}`
    : '';
}

export function missingCompanyEnvNames() {
  return COMPANY_FIELDS.filter(([key]) => !companyIdentity()[key]).map(([, envName]) => envName);
}

export function assertCompanyIdentityForProduction() {
  if (process.env.NODE_ENV !== 'production') return;
  const missing = missingCompanyEnvNames();
  if (!missing.length) return;
  throw new Error(
    `Company identity is required in production. Set ${missing.join(', ')} (see web/.env.example).`
  );
}

export function companyInvoiceFooter() {
  const { legalName, vat } = companyIdentity();
  const parts = [];
  if (legalName) parts.push(legalName);
  if (vat) parts.push(`VAT ${vat}`);
  return parts.join(' · ') || undefined;
}
