import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  centsExVat,
  centsWithVat,
  formatEuroFromCents,
  formatVatInclusivePrice,
} from '../server/vat-display.mjs';

describe('vat-inclusive catalog display', () => {
  it('keeps advertised shelf prices as round incl-VAT euros', () => {
    assert.equal(formatEuroFromCents(1000), '€ 10');
    assert.equal(formatEuroFromCents(4500), '€ 45');
    assert.equal(formatEuroFromCents(8000), '€ 80');
    assert.equal(formatEuroFromCents(4900), '€ 49');
    assert.equal(formatEuroFromCents(49000), '€ 490');
    assert.equal(formatVatInclusivePrice(1000), '€ 10 incl. VAT (€ 8,26 excl.)');
    assert.equal(formatVatInclusivePrice(4500), '€ 45 incl. VAT (€ 37,19 excl.)');
    assert.equal(formatVatInclusivePrice(8000), '€ 80 incl. VAT (€ 66,12 excl.)');
    assert.equal(formatVatInclusivePrice(4900), '€ 49 incl. VAT (€ 40,50 excl.)');
    assert.equal(formatVatInclusivePrice(49000), '€ 490 incl. VAT (€ 404,96 excl.)');
  });

  it('does not add 21% on top of inclusive catalog cents', () => {
    assert.notEqual(centsWithVat(1000), 1000);
    assert.equal(centsExVat(1000), 826);
    assert.equal(centsExVat(4900), 4050);
  });
});
