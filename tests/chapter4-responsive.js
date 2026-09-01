/**
 * Chapter 4: Responsive Design and Zoom
 * Based on: module-responsive-zoom-checklist.pdf
 */
export const chapterId = 'responsive';

export async function runResponsiveChecks(page, viewport = { width: 320, height: 568 }) {
  const results = [];

  // Test at 320px width (WCAG 2.1 reflow requirement)
  await page.setViewportSize(viewport);

  const overflowChecks = await page.evaluate(() => {
    const body = document.body;
    const html = document.documentElement;
    const docWidth = Math.max(body.scrollWidth, html.scrollWidth);
    const viewWidth = window.innerWidth;
    const hasHorizontalScroll = docWidth > viewWidth + 10;
    return { docWidth, viewWidth, hasHorizontalScroll };
  });

  results.push({
    id: 'no-horizontal-scroll',
    rule: 'Content MUST NOT require horizontal scrolling at 320px width (simplified check; not a full WCAG 1.4.10 assessment)',
    status: !overflowChecks.hasHorizontalScroll ? 'pass' : 'fail',
    message: overflowChecks.hasHorizontalScroll
      ? `Horizontal overflow: content ${overflowChecks.docWidth}px vs viewport ${overflowChecks.viewWidth}px (more than 10px)`
      : 'No meaningful horizontal overflow at 320px',
    chapter: chapterId,
  });

  // Viewport meta (mobile zoom)
  const viewportMeta = await page.evaluate(() => {
    const meta = document.querySelector('meta[name="viewport"]');
    if (!meta) return { present: false, content: null };
    const content = meta.getAttribute('content') || '';
    const userScalable = !/user-scalable\s*=\s*no/i.test(content);
    const maxScale = content.match(/maximum-scale\s*=\s*([\d.]+)/i);
    const allowsZoom = userScalable && (!maxScale || parseFloat(maxScale[1]) >= 2);
    return { present: true, content, allowsZoom };
  });

  results.push({
    id: 'viewport-zoom',
    rule: 'Page MUST allow users to zoom on mobile (no user-scalable=no)',
    status: viewportMeta.present && viewportMeta.allowsZoom ? 'pass' : viewportMeta.present ? 'warn' : 'info',
    message: viewportMeta.present
      ? viewportMeta.allowsZoom
        ? 'Viewport allows zoom'
        : `Viewport may restrict zoom: ${viewportMeta.content}`
      : 'No viewport meta tag',
    chapter: chapterId,
  });

  return results;
}
