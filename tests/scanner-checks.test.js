/**
 * Behaviour tests for the scanner's custom checks (tests/chapterN-*.js), run
 * against small HTML fixtures in real Chromium. Needs `npx playwright install chromium`.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { runSemanticChecks } from './chapter1-semantics.js';
import { runImageChecks } from './chapter2-images.js';
import { runResponsiveChecks } from './chapter4-responsive.js';
import { runMultimediaChecks } from './chapter5-multimedia.js';
import { runFormChecks } from './chapter7-forms.js';

/** @type {import('playwright').Browser} */
let browser;

before(async () => {
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  await browser?.close();
});

const page = (body, head = '') => `<!doctype html><html lang="en"><head><title>t</title>${head}</head><body>${body}</body></html>`;

/** Run one check module on a fixture and return its results keyed by check id. */
async function check(run, html, viewport = { width: 1366, height: 768 }) {
  const context = await browser.newContext({ viewport });
  try {
    const p = await context.newPage();
    await p.setContent(html);
    const results = await run(p);
    return { byId: Object.fromEntries(results.map((r) => [r.id, r])), page: p, results };
  } finally {
    await context.close();
  }
}

describe('chapter 1: semantics', () => {
  it('accepts an inline SVG with an accessible name as link text', async () => {
    const { byId } = await check(
      runSemanticChecks,
      page('<main><h1>x</h1><a href="/"><svg aria-label="Home" width="10" height="10"></svg></a></main>')
    );
    assert.notEqual(byId['link-text']?.status, 'fail', byId['link-text']?.message);
  });

  it('does not take a link to /wp-content/ for a skip link', async () => {
    const { byId } = await check(
      runSemanticChecks,
      page('<a href="/wp-content/uploads/brochure.pdf">Brochure</a><main id="main"><h1>x</h1></main>')
    );
    assert.equal(byId['skip-link'].status, 'warn');
  });

  it('finds a skip link that points at an element on the page', async () => {
    const { byId } = await check(
      runSemanticChecks,
      page('<a href="#inhoud">Ga naar inhoud</a><nav><a href="/a">A</a></nav><main id="inhoud"><h1>x</h1></main>')
    );
    assert.equal(byId['skip-link'].status, 'pass');
  });

  it('does not count a skip link whose target is missing', async () => {
    const { byId } = await check(runSemanticChecks, page('<a href="#main">Skip</a><main><h1>x</h1></main>'));
    assert.equal(byId['skip-link'].status, 'warn');
  });

  it('ignores layout tables when looking for header cells', async () => {
    const { byId } = await check(
      runSemanticChecks,
      page('<main><h1>x</h1><table role="presentation"><tr><td>a</td><td>b</td></tr></table></main>')
    );
    assert.equal(byId['table-headers'], undefined);
  });

  it('still fails a data table without header cells', async () => {
    const { byId } = await check(runSemanticChecks, page('<main><h1>x</h1><table><tr><td>a</td></tr></table></main>'));
    assert.equal(byId['table-headers'].status, 'fail');
  });

  it('accepts list items inside <menu>', async () => {
    const { byId } = await check(runSemanticChecks, page('<main><h1>x</h1><menu><li>Copy</li><li>Paste</li></menu></main>'));
    assert.equal(byId['list-markup'], undefined);
  });

  it('reports duplicate ids named like Object.prototype members instead of crashing', async () => {
    const { byId } = await check(
      runSemanticChecks,
      page('<main><h1>x</h1><div id="constructor">a</div><div id="constructor">b</div><p id="toString">c</p></main>')
    );
    assert.equal(byId['unique-ids'].status, 'fail');
    assert.match(byId['unique-ids'].message, /constructor/);
    assert.doesNotMatch(byId['unique-ids'].message, /toString/);
  });
});

describe('chapter 2: images', () => {
  it('leaves decorative SVGs alone', async () => {
    const { byId } = await check(
      runImageChecks,
      page(
        '<button>Save <svg aria-hidden="true" width="10" height="10"></svg></button>' +
          '<span aria-hidden="true"><svg width="10" height="10"></svg></span>' +
          '<svg role="presentation" width="10" height="10"></svg>'
      )
    );
    assert.equal(byId['svg-role'], undefined);
  });

  it('still warns about a meaningful SVG without a role', async () => {
    const { byId } = await check(runImageChecks, page('<svg width="10" height="10"><title>Chart</title></svg>'));
    assert.equal(byId['svg-role'].status, 'warn');
  });

  it('survives a quote in usemap', async () => {
    const { results } = await check(runImageChecks, page('<img alt="map" src="x.png" usemap=\'#a"b\'>'));
    assert.ok(Array.isArray(results));
  });
});

describe('chapter 4: responsive', () => {
  it('puts the viewport back after measuring at 320px', async () => {
    const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    try {
      const p = await context.newPage();
      await p.setContent(page('<main><h1>x</h1></main>'));
      await runResponsiveChecks(p, { width: 320, height: 568 });
      assert.deepEqual(p.viewportSize(), { width: 1366, height: 768 });
    } finally {
      await context.close();
    }
  });

  it('treats user-scalable=0 as blocking zoom', async () => {
    const { byId } = await check(
      runResponsiveChecks,
      page('<p>x</p>', '<meta name="viewport" content="width=device-width, user-scalable=0">')
    );
    assert.equal(byId['viewport-zoom'].status, 'warn');
  });

  it('passes a normal viewport meta', async () => {
    const { byId } = await check(
      runResponsiveChecks,
      page('<p>x</p>', '<meta name="viewport" content="width=device-width, initial-scale=1">')
    );
    assert.equal(byId['viewport-zoom'].status, 'pass');
  });
});

describe('chapter 5: multimedia', () => {
  it('does not ask for captions on a muted background video without controls', async () => {
    const { byId } = await check(runMultimediaChecks, page('<video muted autoplay loop playsinline src="bg.mp4"></video>'));
    assert.equal(byId['video-captions'], undefined);
  });

  it('flags a playable video without a caption track for review', async () => {
    const { byId } = await check(runMultimediaChecks, page('<video controls src="talk.mp4"></video>'));
    assert.equal(byId['video-captions'].status, 'warn');
  });

  it('passes a video with a caption track', async () => {
    const { byId } = await check(
      runMultimediaChecks,
      page('<video controls src="talk.mp4"><track kind="captions" src="talk.vtt" srclang="en"></video>')
    );
    assert.equal(byId['video-captions'].status, 'pass');
  });
});

describe('chapter 7: forms', () => {
  it('fails an input whose only label is its placeholder', async () => {
    const { byId } = await check(runFormChecks, page('<form><input type="email" placeholder="Email"></form>'));
    assert.equal(byId['placeholder-not-only-label'].status, 'fail');
    // Counted once, under the more specific rule.
    assert.equal(byId['form-labels'].status, 'pass');
  });

  it('fails an input with neither label nor placeholder under form-labels', async () => {
    const { byId } = await check(runFormChecks, page('<form><input type="text"></form>'));
    assert.equal(byId['form-labels'].status, 'fail');
    assert.equal(byId['placeholder-not-only-label'].status, 'pass');
  });

  it('passes labelled inputs, including a title attribute, and ignores reset buttons', async () => {
    const { byId } = await check(
      runFormChecks,
      page(
        '<form><label for="a">Name</label><input id="a" placeholder="Jane">' +
          '<input type="search" title="Search the site"><input type="reset" value="Clear"></form>'
      )
    );
    assert.equal(byId['form-labels'].status, 'pass');
    assert.equal(byId['placeholder-not-only-label'].status, 'pass');
  });
});
