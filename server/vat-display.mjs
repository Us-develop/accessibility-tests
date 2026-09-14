/** Belgian display helpers. Catalog amounts stay ex-VAT; Stripe Tax calculates the live amount. */

export function vatRateDisplay() {
  const n = Number.parseFloat(String(process.env.VAT_RATE_DISPLAY ?? '0.21'));
  return Number.isFinite(n) && n >= 0 ? n : 0.21;
}

export function centsWithVat(exVatCents, rate = vatRateDisplay()) {
  return Math.round(Number(exVatCents || 0) * (1 + rate));
}

export function formatEuroFromCents(cents) {
  const n = Number(cents || 0);
  const euros = n / 100;
  if (Number.isInteger(euros)) return `€ ${euros}`;
  return `€ ${euros.toFixed(2).replace('.', ',')}`;
}

export function formatVatInclusivePrice(exVatCents, rate = vatRateDisplay()) {
  const excl = formatEuroFromCents(exVatCents);
  const incl = formatEuroFromCents(centsWithVat(exVatCents, rate));
  return `${incl} incl. VAT (${excl} excl.)`;
}
