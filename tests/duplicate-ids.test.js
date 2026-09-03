import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatIdSelector,
  formatDuplicateIdList,
  idsFromCustomResult,
  idsFromAxeViolation,
  duplicateIdSnippet,
  formatOccurrenceDescriptor,
} from '../duplicate-ids.js';
import { buildAstroMainReportPayload } from '../report-astro-payload.js';

describe('idsFromCustomResult', () => {
  it('reads names from the Duplicate IDs message', () => {
    assert.deepEqual(
      idsFromCustomResult({
        id: 'unique-ids',
        message: 'Duplicate IDs: header, nav',
      }),
      ['header', 'nav']
    );
  });

  it('prefers occurrence records and de-duplicates', () => {
    assert.deepEqual(
      idsFromCustomResult({
        id: 'unique-ids',
        message: 'Duplicate IDs: header',
        occurrences: [
          { tag: 'div', id: 'header', className: 'site' },
          { tag: 'header', id: 'header', className: '' },
          { tag: 'nav', id: 'menu', className: '' },
        ],
      }),
      ['header', 'menu']
    );
  });

  it('ignores other custom checks', () => {
    assert.deepEqual(idsFromCustomResult({ id: 'html-lang', message: 'Duplicate IDs: x' }), []);
  });
});

describe('idsFromAxeViolation', () => {
  it('collects ids from html snippets and check data', () => {
    assert.deepEqual(
      idsFromAxeViolation({
        id: 'duplicate-id',
        nodes: [
          { html: '<div id="header">', any: [{ data: 'header' }] },
          { html: '<span id="header">', target: ['#header'] },
        ],
      }),
      ['header']
    );
  });

  it('ignores unrelated axe rules', () => {
    assert.deepEqual(idsFromAxeViolation({ id: 'color-contrast', nodes: [{ html: '<p id="x">' }] }), []);
  });
});

describe('formatDuplicateIdList', () => {
  it('prefixes hashes and labels empty ids', () => {
    assert.equal(formatIdSelector(''), '(empty id)');
    assert.equal(formatDuplicateIdList(['header', 'nav']), '#header, #nav');
  });
});

describe('duplicateIdSnippet', () => {
  it('names the duplicated values', () => {
    assert.match(duplicateIdSnippet(['header', 'nav'], 'fallback'), /#header, #nav/);
  });
});

describe('formatOccurrenceDescriptor', () => {
  it('formats tag#id.class', () => {
    assert.equal(
      formatOccurrenceDescriptor({
        tag: 'DIV',
        id: 'header',
        className: 'site wrap',
        occurrenceLabel: ' (occurrence 1 of 2)',
      }),
      'div#header.site.wrap (occurrence 1 of 2)'
    );
  });

  it('uses the element html when there is no id or class', () => {
    assert.equal(
      formatOccurrenceDescriptor({
        tag: 'svg',
        id: '',
        className: '',
        html: '<svg viewBox="0 0 24 24"><path d="M1 1"/></svg>',
      }),
      '<svg viewBox="0 0 24 24"><path d="M1 1"/></svg>'
    );
  });
});

describe('buildAstroMainReportPayload unique-ids', () => {
  it('exposes duplicated id names on the issue and rules rows', () => {
    const payload = buildAstroMainReportPayload({
      urls: ['https://example.com/'],
      generatedAt: '2026-09-03T12:00:00.000Z',
      customResults: [
        {
          id: 'unique-ids',
          rule: 'IDs MUST be unique within the page',
          status: 'fail',
          chapter: 'semantics',
          url: 'https://example.com/',
          message: 'Duplicate IDs: header, nav',
          occurrences: [
            { tag: 'div', id: 'header', className: 'top', occurrenceLabel: ' (occurrence 1 of 2)' },
            { tag: 'header', id: 'header', className: '', occurrenceLabel: ' (occurrence 2 of 2)' },
            { tag: 'nav', id: 'nav', className: '', occurrenceLabel: ' (occurrence 1 of 2)' },
            { tag: 'div', id: 'nav', className: 'dup', occurrenceLabel: ' (occurrence 2 of 2)' },
          ],
        },
      ],
      axeResults: {},
    });
    const item = payload.fixOrderItems.find((row) => row.id === 'unique-ids');
    assert.ok(item);
    assert.deepEqual(item.duplicateIds, ['header', 'nav']);
    assert.equal(item.duplicateIdLabel, '#header, #nav');
    assert.match(item.snippet, /#header, #nav/);
    const rule = payload.rulesTable.find((row) => row.id === 'unique-ids');
    assert.equal(rule.duplicateIdLabel, '#header, #nav');
  });
});
