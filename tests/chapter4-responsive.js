/**
 * Chapter 4: Responsive Design and Zoom
 * Based on: module-responsive-zoom-checklist.pdf
 */
import { pageCollect } from './describe-els.js';
import { say } from './scan-text.js';

export const chapterId = 'responsive';

export async function runResponsiveChecks(page, viewport = { width: 320, height: 568 }) {
  const results = [];

  // Test at 320px width (WCAG 2.1 reflow requirement). The page is shared with
  // the chapters that run after this one, so the original size goes back afterwards.
  const originalViewport = page.viewportSize();
  await page.setViewportSize(viewport);
  try {
    await collectResponsiveResults(page, results);
  } finally {
    if (originalViewport) await page.setViewportSize(originalViewport);
  }
  return results;
}

async function collectResponsiveResults(page, results) {

  const overflowChecks = await pageCollect(page, function collector(describeEls, limit) {
    const body = document.body;
    const html = document.documentElement;
    const docWidth = Math.max(body.scrollWidth, html.scrollWidth);
    const viewWidth = window.innerWidth;
    const hasHorizontalScroll = docWidth > viewWidth + 10;
    const overflowing = [];
    if (hasHorizontalScroll) {
      const nodes = document.querySelectorAll('body *');
      for (const el of nodes) {
        if (overflowing.length >= limit) break;
        if (el.scrollWidth > viewWidth + 10) overflowing.push(el);
      }
    }
    return {
      docWidth,
      viewWidth,
      hasHorizontalScroll,
      occurrences: describeEls(overflowing, limit),
    };
  });

  results.push({
    id: 'no-horizontal-scroll',
    rule: say('chk.no-horizontal-scroll.rule'),
    status: !overflowChecks.hasHorizontalScroll ? 'pass' : 'fail',
    message: overflowChecks.hasHorizontalScroll
      ? say('chk.no-horizontal-scroll.overflow', { docWidth: overflowChecks.docWidth, viewWidth: overflowChecks.viewWidth })
      : say('chk.no-horizontal-scroll.ok'),
    chapter: chapterId,
    occurrences: overflowChecks.hasHorizontalScroll ? overflowChecks.occurrences : [],
  });

  // Viewport meta (mobile zoom)
  const viewportMeta = await page.evaluate(() => {
    const meta = document.querySelector('meta[name="viewport"]');
    if (!meta) return { present: false, content: null };
    const content = meta.getAttribute('content') || '';
    const userScalable = !/user-scalable\s*=\s*(no|0)\b/i.test(content);
    const maxScale = content.match(/maximum-scale\s*=\s*([\d.]+)/i);
    const allowsZoom = userScalable && (!maxScale || parseFloat(maxScale[1]) >= 2);
    return { present: true, content, allowsZoom };
  });

  results.push({
    id: 'viewport-zoom',
    rule: say('chk.viewport-zoom.rule'),
    status: viewportMeta.present && viewportMeta.allowsZoom ? 'pass' : viewportMeta.present ? 'warn' : 'info',
    message: viewportMeta.present
      ? viewportMeta.allowsZoom
        ? say('chk.viewport-zoom.ok')
        : say('chk.viewport-zoom.restricted', { content: viewportMeta.content })
      : say('chk.viewport-zoom.missing'),
    chapter: chapterId,
    occurrences: viewportMeta.present && viewportMeta.allowsZoom ? [] : [{ tag: 'meta', id: '', className: '' }],
  });
}
