import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isGuestScanPayload, runRequestIsStaff } from '../server/guest.mjs';

describe('isGuestScanPayload', () => {
  it('accepts a single-page url field', () => {
    assert.equal(isGuestScanPayload({ url: 'https://example.com' }), true);
  });

  it('rejects staff urls text', () => {
    assert.equal(isGuestScanPayload({ url: 'https://example.com', urls: 'https://example.com/about' }), false);
    assert.equal(isGuestScanPayload({ urls: 'https://example.com' }), false);
  });

  it('rejects file uploads', () => {
    assert.equal(isGuestScanPayload({ url: 'https://example.com' }, { originalname: 'map.xml' }), false);
  });
});

describe('runRequestIsStaff', () => {
  it('keeps the public 1-page form as guest when auth is off', () => {
    assert.equal(
      runRequestIsStaff({
        authEnabled: false,
        accessRole: 'staff',
        body: { url: 'https://example.com' },
      }),
      false
    );
  });

  it('still treats sitemap posts as staff when auth is off', () => {
    assert.equal(
      runRequestIsStaff({
        authEnabled: false,
        accessRole: 'staff',
        body: { urls: 'https://example.com\nhttps://example.com/about' },
      }),
      true
    );
  });

  it('treats signed-in staff urls as staff when auth is on', () => {
    assert.equal(
      runRequestIsStaff({
        authEnabled: true,
        accessRole: 'staff',
        body: { urls: 'https://example.com' },
      }),
      true
    );
  });

  it('treats logged-out url posts as guest when auth is on', () => {
    assert.equal(
      runRequestIsStaff({
        authEnabled: true,
        accessRole: 'guest',
        body: { url: 'https://example.com' },
      }),
      false
    );
  });
});
