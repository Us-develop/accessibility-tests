import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packDiscountPercent, vatParts } from '../server/vat-display.mjs';
import { companyIdentity, kboLookupUrl } from '../server/company.mjs';
import en from '../i18n/en.mjs';
import nl from '../i18n/nl.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(repoRoot, path), 'utf8');

describe('prices from the 2026 designs', () => {
  it('splits a price into the amount with VAT and the amount without', () => {
    assert.deepEqual(vatParts(1000), { incl: '€ 10', excl: '€ 8,26' });
    assert.deepEqual(vatParts(4900), { incl: '€ 49', excl: '€ 40,50' });
  });

  it('works out the pack discount against the single-token price', () => {
    assert.equal(packDiscountPercent({ tokens: 10, priceCents: 1000 }, 100), 0);
    assert.equal(packDiscountPercent({ tokens: 50, priceCents: 4500 }, 100), 10);
    assert.equal(packDiscountPercent({ tokens: 100, priceCents: 8000 }, 100), 20);
  });

  it('says "incl. VAT" in the visitor’s language, not always English', () => {
    assert.equal(en['price.inclVat'], 'incl. VAT ({excl} excl.)');
    assert.equal(nl['price.inclVat'], 'incl. btw ({excl} excl.)');
    assert.doesNotMatch(read('web/src/pages/pricing.astro'), /formatVatInclusivePrice/);
    assert.doesNotMatch(read('web/src/pages/account.astro'), /formatVatInclusivePrice/);
  });
});

describe('site footer', () => {
  it('links the company number to the public KBO search', () => {
    assert.equal(
      kboLookupUrl('0669.636.926'),
      'https://kbopub.economie.fgov.be/kbopub/zoeknummerform.html?nummer=0669636926'
    );
    assert.equal(kboLookupUrl(''), '');
  });

  it('reads phone, website and LinkedIn from optional settings', () => {
    process.env.COMPANY_PHONE = '+32 3 000 00 00';
    process.env.COMPANY_LINKEDIN_URL = 'https://www.linkedin.com/company/1';
    const company = companyIdentity();
    assert.equal(company.phone, '+32 3 000 00 00');
    assert.equal(company.linkedin, 'https://www.linkedin.com/company/1');
    delete process.env.COMPANY_PHONE;
    delete process.env.COMPANY_LINKEDIN_URL;
    const layout = read('web/src/layouts/Layout.astro');
    assert.match(layout, /\{company\.website \? \(/);
    assert.match(layout, /\{company\.linkedin \? \(/);
    assert.match(layout, /tr\('footer\.copyright', \{ year, name: company\.legalName \|\| 'Us' \}\)/);
  });
});

describe('design assets', () => {
  it('serves every icon the pages use from the project, never a Figma URL', () => {
    const files = [
      'web/src/components/AppHeader.astro',
      'web/src/layouts/Layout.astro',
      'web/src/pages/index.astro',
      'web/src/pages/pricing.astro',
      'web/src/pages/signup.astro',
      'web/src/pages/account.astro',
      'web/public/styles/app.css',
    ];
    for (const file of files) {
      const text = read(file);
      assert.doesNotMatch(text, /figma\.com/, file);
      for (const [, icon] of text.matchAll(/\/assets\/icons\/([\w-]+\.svg)/g)) {
        const path = join(repoRoot, 'web/public/assets/icons', icon);
        assert.ok(existsSync(path) && statSync(path).size > 0, `${file} uses ${icon}`);
      }
    }
  });
});

describe('password fields', () => {
  it('have a show/hide button that says whether it is on', () => {
    for (const page of ['web/src/pages/signup.astro', 'web/src/pages/account.astro']) {
      const text = read(page);
      assert.match(text, /data-password-toggle="[\w-]+" aria-pressed="false" aria-label=\{tr\('signup\.password\.show'\)\}/, page);
      assert.match(text, /bindPasswordToggles\(\)/, page);
    }
    assert.match(read('web/src/lib/password-toggle.js'), /setAttribute\('aria-pressed', show \? 'true' : 'false'\)/);
  });
});

describe('header', () => {
  it('greets a signed-in customer by first name and keeps the account links in its menu', () => {
    const header = read('web/src/components/AppHeader.astro');
    assert.match(header, /tr\('header\.greeting', \{ name: firstName \}\)/);
    const menu = header.slice(header.indexOf('<details class="nav-account'), header.indexOf('</details>'));
    assert.match(menu, /href="\/audits"/);
    assert.match(menu, /href="\/account"/);
    assert.match(menu, /id="wcag-logout-btn"/);
    assert.match(read('server/session.mjs'), /firstName: user\.firstName \|\| ''/);
  });
});
