/**
 * Chapter 2: Images, Canvas, SVG, and Non-Text Content
 * Based on: module-images-checklist.pdf
 */
import { pageCollect } from './describe-els.js';

export const chapterId = 'images';

export async function runImageChecks(page) {
  const results = [];

  const imageChecks = await pageCollect(page, function collector(describeEls, limit) {
    const imgs = Array.from(document.querySelectorAll('img'));
    const missingAlt = [];
    const longAlt = [];
    const decorativeWithAlt = [];

    imgs.forEach((img) => {
      const alt = img.getAttribute('alt');
      const role = img.getAttribute('role');
      const src = (img.getAttribute('src') || '').toLowerCase();

      if (alt === null || alt === undefined) missingAlt.push(img);
      else if (alt.length > 250) longAlt.push(img);

      const looksDecorative =
        role === 'presentation' ||
        /spacer|pixel|blank|\.gif$/i.test(src) ||
        (img.width <= 1 && img.height <= 1);
      if (looksDecorative && alt && alt.length > 0) decorativeWithAlt.push(img);
    });

    return {
      total: imgs.length,
      missingAlt: missingAlt.length,
      longAlt: longAlt.length,
      missingOccurrences: describeEls(missingAlt, limit),
      longOccurrences: describeEls(longAlt, limit),
    };
  });

  if (imageChecks.total > 0) {
    results.push({
      id: 'img-alt',
      rule: 'Informative images MUST have programmatically-discernible alternative text',
      status: imageChecks.missingAlt === 0 ? 'pass' : 'fail',
      message:
        imageChecks.missingAlt > 0
          ? `${imageChecks.missingAlt} image(s) missing alt attribute`
          : `${imageChecks.total} images have alt text`,
      chapter: chapterId,
      occurrences: imageChecks.missingAlt > 0 ? imageChecks.missingOccurrences : [],
    });

    if (imageChecks.longAlt > 0) {
      results.push({
        id: 'img-alt-length',
        rule: 'Alternative text SHOULD be concise (≤250 characters)',
        status: 'warn',
        message: `${imageChecks.longAlt} image(s) with alt > 250 chars`,
        chapter: chapterId,
        occurrences: imageChecks.longOccurrences,
      });
    }
  }

  const svgChecks = await pageCollect(page, function collector(describeEls, limit) {
    const svgs = Array.from(document.querySelectorAll('svg'));
    const noRole = [];
    const noAccessibleName = [];
    svgs.forEach((svg) => {
      const role = svg.getAttribute('role');
      const ariaLabel = svg.getAttribute('aria-label');
      const ariaLabelledby = svg.getAttribute('aria-labelledby');
      const title = svg.querySelector('title');
      const hasAccessibleName = !!(ariaLabel || ariaLabelledby || (title && title.textContent?.trim()));
      if (!role || role !== 'img') noRole.push(svg);
      if (!hasAccessibleName) noAccessibleName.push(svg);
    });
    return {
      total: svgs.length,
      noRole: noRole.length,
      noAccessibleName: noAccessibleName.length,
      noRoleOccurrences: describeEls(noRole, limit),
      noNameOccurrences: describeEls(noAccessibleName, limit),
    };
  });

  if (svgChecks.total > 0) {
    results.push({
      id: 'svg-role',
      rule: 'SVG elements SHOULD have role="img"',
      status: svgChecks.noRole === 0 ? 'pass' : 'warn',
      message:
        svgChecks.noRole > 0
          ? `${svgChecks.noRole} SVG(s) without role="img"`
          : 'All SVGs have role',
      chapter: chapterId,
      occurrences: svgChecks.noRole > 0 ? svgChecks.noRoleOccurrences : [],
    });
    results.push({
      id: 'svg-accessible-name',
      rule: 'Informative/actionable SVGs MUST have meaningful alternative text',
      status: svgChecks.noAccessibleName === 0 ? 'pass' : 'warn',
      message:
        svgChecks.noAccessibleName > 0
          ? `${svgChecks.noAccessibleName} SVG(s) without accessible name`
          : 'All SVGs have accessible names',
      chapter: chapterId,
      occurrences: svgChecks.noAccessibleName > 0 ? svgChecks.noNameOccurrences : [],
    });
  }

  const canvasChecks = await pageCollect(page, function collector(describeEls, limit) {
    const canvases = Array.from(document.querySelectorAll('canvas'));
    const failing = canvases.filter((canvas) => {
      const role = canvas.getAttribute('role');
      const ariaLabel = canvas.getAttribute('aria-label');
      const ariaLabelledby = canvas.getAttribute('aria-labelledby');
      return (!role || role !== 'img') || (!ariaLabel && !ariaLabelledby);
    });
    return {
      total: canvases.length,
      failing: failing.length,
      occurrences: describeEls(failing, limit),
    };
  });

  if (canvasChecks.total > 0) {
    results.push({
      id: 'canvas-alt',
      rule: 'Canvas elements MUST have role="img" and text alternative',
      status: canvasChecks.failing === 0 ? 'pass' : 'fail',
      message:
        canvasChecks.failing > 0
          ? `${canvasChecks.total} canvas element(s) need role and alternative text`
          : 'All canvases have role and alt',
      chapter: chapterId,
      occurrences: canvasChecks.failing > 0 ? canvasChecks.occurrences : [],
    });
  }

  const mapChecks = await pageCollect(page, function collector(describeEls, limit) {
    const imgWithMap = document.querySelectorAll('img[usemap]');
    const areaNoAlt = [];
    imgWithMap.forEach((img) => {
      const mapName = img.getAttribute('usemap')?.replace('#', '');
      const mapEl = document.querySelector(`map[name="${mapName}"]`);
      if (mapEl) {
        mapEl.querySelectorAll('area').forEach((area) => {
          const alt = area.getAttribute('alt');
          if (!alt && alt !== '') areaNoAlt.push(area);
        });
      }
    });
    return {
      total: imgWithMap.length,
      areaNoAlt: areaNoAlt.length,
      occurrences: describeEls(areaNoAlt, limit),
    };
  });

  if (mapChecks.total > 0 && mapChecks.areaNoAlt > 0) {
    results.push({
      id: 'image-map-alt',
      rule: 'Image map areas MUST have alternative text',
      status: 'fail',
      message: `${mapChecks.areaNoAlt} area(s) in image map without alt`,
      chapter: chapterId,
      occurrences: mapChecks.occurrences,
    });
  }

  return results;
}
