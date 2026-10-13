import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildAstroMainReportPayload } from '../report-astro-payload.js';

describe('dashboard payload occurrence counts', () => {
  it('counts a custom rule only on the pages where it failed or warned', () => {
    const urls = ['https://example.com/', 'https://example.com/a', 'https://example.com/b'];
    const row = (url, status) => ({
      id: 'img-alt',
      rule: 'Images MUST have alt text',
      status,
      message: status === 'pass' ? 'All images have alt' : '2 image(s) without alt',
      chapter: 'images',
      url,
    });
    const payload = buildAstroMainReportPayload({
      generatedAt: new Date().toISOString(),
      urls,
      axeResults: Object.fromEntries(urls.map((url) => [url, { url, violations: [], incomplete: [], passes: [] }])),
      customResults: [row(urls[0], 'fail'), row(urls[1], 'pass'), row(urls[2], 'pass')],
      summary: { pass: 2, fail: 1, warn: 0, info: 0 },
    });
    const item = payload.fixOrderItems.find((entry) => entry.id === 'img-alt');
    assert.ok(item, 'img-alt should be listed as a finding');
    assert.equal(item.occurrencesTotal, 1);
    assert.deepEqual(item.pages, [urls[0]]);
  });
});
