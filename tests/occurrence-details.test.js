import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { describeEls } from '../tests/describe-els.js';
import { occurrenceDetailsFromCustom, occurrenceDetailsFromAxe } from '../occurrence-details.js';
import { buildAstroMainReportPayload } from '../report-astro-payload.js';
import { formatOccurrenceDescriptor } from '../duplicate-ids.js';

describe('describeEls', () => {
  it('formats tag#id.class and occurrence labels', () => {
    const rows = describeEls(
      [
        { tagName: 'IMG', id: 'hero', className: 'banner wide' },
        { tagName: 'IMG', id: '', className: 'thumb' },
      ],
      40
    );
    assert.equal(rows[0].tag, 'img');
    assert.equal(rows[0].id, 'hero');
    assert.equal(rows[0].className, 'banner wide');
    assert.equal(rows[0].html, '');
    assert.match(rows[0].occurrenceLabel, /occurrence 1 of 2/);
  });

  it('stores outerHTML so a classless svg can be shown in full', () => {
    const rows = describeEls([
      {
        tagName: 'SVG',
        id: '',
        className: '',
        outerHTML: '<svg viewBox="0 0 24 24" width="32"><path d="M1 2"/></svg>',
      },
    ]);
    assert.equal(rows[0].tag, 'svg');
    assert.match(rows[0].html, /viewBox="0 0 24 24"/);
  });
});

describe('occurrenceDetailsFromCustom', () => {
  it('uses stored occurrence records', () => {
    assert.deepEqual(
      occurrenceDetailsFromCustom({
        occurrences: [{ tag: 'img', id: 'hero', className: 'banner' }],
      }),
      ['img#hero.banner']
    );
  });

  it('falls back to a selector', () => {
    assert.deepEqual(occurrenceDetailsFromCustom({ selector: '.btn.primary' }), ['.btn.primary']);
  });

  it('shows element html when an svg has no class or id', () => {
    assert.deepEqual(
      occurrenceDetailsFromCustom({
        occurrences: [
          {
            tag: 'svg',
            id: '',
            className: '',
            html: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16"/></svg>',
          },
        ],
      }),
      ['<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16"/></svg>']
    );
  });
});

describe('occurrenceDetailsFromAxe', () => {
  it('describes nodes from html and css target', () => {
    assert.deepEqual(
      occurrenceDetailsFromAxe({
        id: 'image-alt',
        nodes: [
          { html: '<img id="hero" class="banner">', target: ['img#hero'] },
          { html: '<img>', target: ['.gallery img:nth-child(2)'] },
        ],
      }),
      ['img#hero.banner', '<img> — .gallery img:nth-child(2)']
    );
  });
});

describe('formatOccurrenceDescriptor axe html', () => {
  it('appends the css target when html has no id or class', () => {
    assert.equal(
      formatOccurrenceDescriptor({ html: '<button>', target: ['form > button'] }),
      '<button> — form > button'
    );
  });
});

describe('buildAstroMainReportPayload occurrence details', () => {
  it('lists axe node locations on the issue', () => {
    const payload = buildAstroMainReportPayload({
      urls: ['https://example.com/'],
      generatedAt: '2026-09-03T12:00:00.000Z',
      customResults: [
        {
          id: 'img-alt',
          rule: 'Informative images MUST have programmatically-discernible alternative text',
          status: 'fail',
          chapter: 'images',
          url: 'https://example.com/',
          message: '1 image(s) missing alt attribute',
          occurrences: [{ tag: 'img', id: 'logo', className: 'header', occurrenceLabel: ' (occurrence 1 of 1)' }],
        },
      ],
      axeResults: {
        'https://example.com/': {
          violations: [
            {
              id: 'button-name',
              help: 'Buttons must have discernible text',
              nodes: [{ html: '<button class="icon">', target: ['.toolbar button'] }],
            },
          ],
          passes: [],
        },
      },
    });
    const img = payload.fixOrderItems.find((row) => row.id === 'img-alt');
    const btn = payload.fixOrderItems.find((row) => row.id === 'button-name');
    assert.deepEqual(img.occurrenceDetails, ['img#logo.header (occurrence 1 of 1)']);
    assert.ok(btn.occurrenceDetails.some((line) => line.includes('button')));
  });
});
