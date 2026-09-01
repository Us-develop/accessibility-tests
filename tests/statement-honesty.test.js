import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateAccessibilityStatement } from '../generate-deliverables.js';
import { MANUAL_VERIFICATION_ITEMS } from '../manual-checklist.js';

function writeStatement(fixOrderItems = []) {
  const dir = mkdtempSync(join(tmpdir(), 'a11y-statement-'));
  generateAccessibilityStatement(
    {
      reportData: {
        urls: ['https://example.com/'],
        generatedAt: '2026-09-01T12:00:00.000Z',
      },
      fixOrderItems,
      statementMeta: {},
    },
    dir
  );
  const html = readFileSync(join(dir, 'accessibility-statement.html'), 'utf8');
  rmSync(dir, { recursive: true, force: true });
  return html;
}

describe('static accessibility statement', () => {
  it('does not auto-claim WCAG 2.2 AA partial conformance', () => {
    const html = writeStatement([
      {
        rule: 'Images need alternative text',
        wcag: ['1.1.1'],
        url: 'https://example.com/',
      },
    ]);
    assert.equal(/partially conformant/i.test(html), false);
    assert.match(html, /automated draft/i);
    assert.match(html, /does not state/i);
  });

  it('treats an empty automated run as not a WCAG pass', () => {
    const html = writeStatement([]);
    assert.equal(/No open issues were recorded/i.test(html), false);
    assert.match(html, /not a WCAG 2\.2 AA pass/i);
  });

  it('does not present unverified organisational measures as facts', () => {
    const html = writeStatement([]);
    assert.equal(/takes the following measures to ensure accessibility/i.test(html), false);
    assert.match(html, /delete any that are not true/i);
    assert.equal(/>Self-evaluation</i.test(html), false);
  });
});

describe('manual verification checklist', () => {
  it('uses WCAG 2.2 AA 2.5.8 (24×24), not AAA 2.5.5 (44×44), as the target-size item', () => {
    const texts = MANUAL_VERIFICATION_ITEMS.map((item) => item.text);
    assert.ok(texts.some((t) => t.includes('24×24') && t.includes('2.5.8')));
    assert.equal(
      texts.some((t) => /at least 44×44/.test(t)),
      false
    );
  });
});
