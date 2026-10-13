import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  BLOCKED_REDIRECT_MESSAGE,
  createRedirectWatch,
  pageScanTimeoutMs,
  parseCliUrlList,
  parseUrlsJson,
  scanProcessTimeoutMs,
  tailForLog,
  withDeadline,
} from '../server/scan-child.mjs';

describe('scan URL hand-over', () => {
  it('keeps a URL with a comma whole when it comes from the server', () => {
    const urls = ['https://example.com/?a=1,https://other.example/'];
    assert.deepEqual(parseUrlsJson(JSON.stringify(urls)), urls);
  });

  it('rejects stdin that is not a JSON array of strings', () => {
    assert.throws(() => parseUrlsJson('https://example.com/'), /not valid JSON/);
    assert.throws(() => parseUrlsJson('{"urls":[]}'), /JSON array of strings/);
    assert.throws(() => parseUrlsJson('[1]'), /JSON array of strings/);
  });

  it('drops entries that are not http(s)', () => {
    assert.deepEqual(parseUrlsJson('["file:///etc/passwd","https://example.com/"]'), ['https://example.com/']);
  });

  it('still splits a hand-typed CLI list on commas and whitespace', () => {
    assert.deepEqual(parseCliUrlList('https://a.example, https://b.example\nhttps://c.example'), [
      'https://a.example',
      'https://b.example',
      'https://c.example',
    ]);
  });
});

describe('scan time budgets', () => {
  it('gives each page at least a minute beyond the navigation timeout', () => {
    assert.equal(pageScanTimeoutMs({}), 240_000);
    assert.equal(pageScanTimeoutMs({ PAGE_GOTO_TIMEOUT_MS: '300000' }), 360_000);
    assert.equal(pageScanTimeoutMs({ PAGE_SCAN_TIMEOUT_MS: '1000' }), 150_000);
  });

  it('scales the process limit with pages and concurrency', () => {
    assert.equal(scanProcessTimeoutMs(1, {}), 240_000 + 120_000);
    assert.equal(scanProcessTimeoutMs(10, {}), 10 * 240_000 + 120_000);
    assert.equal(scanProcessTimeoutMs(10, { URL_CONCURRENCY: '4' }), 3 * 240_000 + 120_000);
    assert.equal(scanProcessTimeoutMs(10, { SCAN_PROCESS_TIMEOUT_MS: '90000' }), 90_000);
  });

  it('rejects when the deadline passes first', async () => {
    await assert.rejects(withDeadline(new Promise(() => {}), 10, 'too slow'), /too slow/);
    assert.equal(await withDeadline(Promise.resolve('ok'), 1000, 'too slow'), 'ok');
  });
});

describe('redirect watch', () => {
  const request = (url, redirected = true) => ({
    url: () => url,
    redirectedFrom: () => (redirected ? {} : null),
  });
  const isPrivate = async (url) => url.includes('169.254.') || url.includes('127.0.0.1');

  it('flags a redirect hop to a non-public address', async () => {
    const watch = createRedirectWatch(isPrivate);
    watch.onRequest(request('http://169.254.169.254/latest/meta-data/'));
    await assert.rejects(watch.assertClean(), new RegExp(BLOCKED_REDIRECT_MESSAGE.slice(0, 20)));
  });

  it('lets public redirect hops through', async () => {
    const watch = createRedirectWatch(isPrivate);
    watch.onRequest(request('https://www.example.com/'));
    await watch.assertClean();
  });

  it('ignores first requests, which the route handler already checks', async () => {
    const watch = createRedirectWatch(isPrivate);
    watch.onRequest(request('http://127.0.0.1:9000/', false));
    await watch.assertClean();
  });

  it('treats a failing check as blocked', async () => {
    const watch = createRedirectWatch(async () => {
      throw new Error('dns down');
    });
    watch.onRequest(request('https://www.example.com/'));
    await assert.rejects(watch.assertClean());
  });
});

describe('tailForLog', () => {
  it('keeps only the end of long output', () => {
    assert.equal(tailForLog('abcdef', 3), '…def');
    assert.equal(tailForLog('abc', 10), 'abc');
  });
});
