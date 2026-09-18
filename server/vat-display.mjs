/**
 * Belgian display helpers. Catalog `priceCents` values are VAT-inclusive shelf prices
 * (€10, €45, €80, €49, €490) so the incl-VAT amount stays a round euro.
 * Stripe Prices must use tax_behavior `inclusive` to match.
 */

export function vatRateDisplay() {
  const n = Number.parseFloat(String(process.env.VAT_RATE_DISPLAY ?? '0.21'));
  return Number.isFinite(n) && n >= 0 ? n : 0.21;
}

export function centsWithVat(exVatCents, rate = vatRateDisplay()) {
  return Math.round(Number(exVatCents || 0) * (1 + rate));
}

export function centsExVat(inclVatCents, rate = vatRateDisplay()) {
  const incl = Number(inclVatCents || 0);
  if (!Number.isFinite(incl)) return 0;
  if (!Number.isFinite(rate) || rate <= -1) return Math.round(incl);
  return Math.round(incl / (1 + rate));
}

export function formatEuroFromCents(cents) {
  const n = Number(cents || 0);
  const euros = n / 100;
  if (Number.isInteger(euros)) return `€ ${euros}`;
  return `€ ${euros.toFixed(2).replace('.', ',')}`;
}

export function formatVatInclusivePrice(inclVatCents, rate = vatRateDisplay()) {
  const incl = formatEuroFromCents(inclVatCents);
  const excl = formatEuroFromCents(centsExVat(inclVatCents, rate));
  return `${incl} incl. VAT (${excl} excl.)`;
}
