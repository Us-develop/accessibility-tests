import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isIP } from 'node:net';
import {
  assertPublicHttpUrl,
  buildScanProcessEnv,
  collectUrlCandidates,
  fetchSitemapDocument,
  filterPublicHttpUrls,
  isBlockedIp,
  scannerUserAgent,
  setUrlGuardLookup,
} from '../server/url-guard.mjs';

after(() => {
  setUrlGuardLookup(null);
});

function lookupMap(map) {
  return async (hostname) => {
    const host = String(hostname || '').toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(map, host)) {
      const err = new Error(`ENOTFOUND ${host}`);
      err.code = 'ENOTFOUND';
      throw err;
    }
    const address = map[host];
    return [{ address, family: isIP(address) === 6 ? 6 : 4 }];
  };
}

describe('url-guard block list', () => {
  it('blocks extended IPv4 and IPv6 reserved ranges', () => {
    assert.equal(isBlockedIp('192.0.0.8'), true);
    assert.equal(isBlockedIp('198.18.0.1'), true);
    assert.equal(isBlockedIp('198.19.255.1'), true);
    assert.equal(isBlockedIp('224.0.0.1'), true);
    assert.equal(isBlockedIp('240.0.0.1'), true);
    assert.equal(isBlockedIp('::'), true);
    assert.equal(isBlockedIp('64:ff9b::1'), true);
    assert.equal(isBlockedIp('2002:c0a8:1::1'), true);
    assert.equal(isBlockedIp('8.8.8.8'), false);
    assert.equal(isBlockedIp('1.1.1.1'), false);
  });
});

describe('assertPublicHttpUrl', () => {
  it('rejects loopback, link-local, RFC1918, metadata, decimal/octal IPv4, and file URLs', async () => {
    const lookup = lookupMap({
      'private-target.example': '10.0.0.1',
      'ok.example': '8.8.8.8',
    });
    const blocked = [
      'http://127.0.0.1/',
      'http://169.254.169.254/',
      'http://[::1]/',
      'http://10.0.0.1/',
      'http://metadata.google.internal/',
      'http://2130706433/',
      'http://0177.0.0.1/',
      'http://private-target.example/',
      'file:///etc/passwd',
    ];
    for (const url of blocked) {
      await assert.rejects(() => assertPublicHttpUrl(url, { lookup }), /cannot be scanned|Only http and https|valid URL|single public/i);
    }
    const ok = await assertPublicHttpUrl('https://ok.example/path', { lookup });
    assert.equal(ok, 'https://ok.example/path');
  });

  it('uses an injected resolver and never needs real DNS', async () => {
    let called = 0;
    const lookup = async (hostname) => {
      called += 1;
      assert.equal(hostname, 'ok.example');
      return [{ address: '1.1.1.1', family: 4 }];
    };
    await assertPublicHttpUrl('https://ok.example/', { lookup });
    assert.equal(called, 1);
  });
});

describe('filterPublicHttpUrls', () => {
  it('drops invalid URLs with a per-URL reason', async () => {
    const lookup = lookupMap({ 'ok.example': '8.8.8.8' });
    const { accepted, rejected } = await filterPublicHttpUrls(
      ['https://ok.example/a', 'http://127.0.0.1/secret', 'file:///etc/passwd'],
      { lookup }
    );
    assert.deepEqual(accepted, ['https://ok.example/a']);
    assert.equal(rejected.length, 2);
    assert.equal(rejected[0].url, 'http://127.0.0.1/secret');
    assert.match(rejected[0].reason, /cannot be scanned/i);
    assert.equal(rejected[1].url, 'file:///etc/passwd');
  });
});

describe('collectUrlCandidates', () => {
  it('keeps file: and other non-http schemes so they can be rejected', () => {
    const found = collectUrlCandidates('https://ok.example/\nfile:///etc/passwd\nftp://inner/');
    assert.ok(found.includes('https://ok.example/'));
    assert.ok(found.includes('file:///etc/passwd'));
    assert.ok(found.includes('ftp://inner/'));
  });
});

describe('fetchSitemapDocument', () => {
  it('does not fetch a loopback sitemap loc', async () => {
    let fetches = 0;
    const xml = await fetchSitemapDocument('http://127.0.0.1:3456/sitemap.xml', {
      fetch: async () => {
        fetches += 1;
        return { ok: true, status: 200, headers: new Headers(), arrayBuffer: async () => Buffer.from('<urlset></urlset>') };
      },
    });
    assert.equal(xml, null);
    assert.equal(fetches, 0);
  });
});

describe('scanner user agent and child env', () => {
  it('builds AccessibilityScanner/1.0 with PUBLIC_BASE_URL', () => {
    assert.equal(
      scannerUserAgent('https://wcag.about-us.be'),
      'AccessibilityScanner/1.0 (+https://wcag.about-us.be)'
    );
  });

  it('omits STRIPE_* and SESSION_SECRET from the Playwright child env', () => {
    const env = buildScanProcessEnv({
      PATH: '/usr/bin',
      HOME: '/home/node',
      NODE_ENV: 'production',
      REPORTS_BASE: '/tmp/reports',
      PLAYWRIGHT_BROWSERS_PATH: '/ms-playwright',
      URL_CONCURRENCY: '1',
      PAGE_GOTO_TIMEOUT_MS: '90000',
      BLOCK_MEDIA_REQUESTS: 'true',
      LARGE_DOM_THRESHOLD: '6000',
      STRIPE_SECRET_KEY: 'sk_test_leak',
      STRIPE_WEBHOOK_SECRET: 'whsec_leak',
      SESSION_SECRET: 'unit-test-session-secret-32chars!!',
      DATABASE_URL: 'postgres://wcag:pw@127.0.0.1/wcag',
    });
    assert.equal(env.PATH, '/usr/bin');
    assert.equal(env.URL_CONCURRENCY, '1');
    assert.equal(env.PAGE_GOTO_TIMEOUT_MS, '90000');
    assert.equal(env.STRIPE_SECRET_KEY, undefined);
    assert.equal(env.STRIPE_WEBHOOK_SECRET, undefined);
    assert.equal(env.SESSION_SECRET, undefined);
    assert.equal(env.DATABASE_URL, undefined);
    assert.ok(!Object.keys(env).some((key) => key.startsWith('STRIPE_')));
  });
});
