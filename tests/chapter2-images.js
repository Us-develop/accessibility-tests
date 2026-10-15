/**
 * Chapter 2: Images, Canvas, SVG, and Non-Text Content
 * Based on: module-images-checklist.pdf
 */
import { pageCollect } from './describe-els.js';
import { say } from './scan-text.js';

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
      rule: say('chk.img-alt.rule'),
      status: imageChecks.missingAlt === 0 ? 'pass' : 'fail',
      message:
        imageChecks.missingAlt > 0
          ? say('chk.img-alt.missing', { n: imageChecks.missingAlt })
          : say('chk.img-alt.ok', { n: imageChecks.total }),
      chapter: chapterId,
      occurrences: imageChecks.missingAlt > 0 ? imageChecks.missingOccurrences : [],
    });

    if (imageChecks.longAlt > 0) {
      results.push({
        id: 'img-alt-length',
        rule: say('chk.img-alt-length.rule'),
        status: 'warn',
        message: say('chk.img-alt-length.long', { n: imageChecks.longAlt }),
        chapter: chapterId,
        occurrences: imageChecks.longOccurrences,
      });
    }
  }

  const svgChecks = await pageCollect(page, function collector(describeEls, limit) {
    // Decorative SVGs (hidden from assistive technology, or marked presentational) need neither.
    const svgs = Array.from(document.querySelectorAll('svg')).filter(
      (svg) =>
        !svg.closest('[aria-hidden="true"]') && !/^(presentation|none)$/i.test(svg.getAttribute('role') || '')
    );
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
      rule: say('chk.svg-role.rule'),
      status: svgChecks.noRole === 0 ? 'pass' : 'warn',
      message:
        svgChecks.noRole > 0
          ? say('chk.svg-role.missing', { n: svgChecks.noRole })
          : say('chk.svg-role.ok'),
      chapter: chapterId,
      occurrences: svgChecks.noRole > 0 ? svgChecks.noRoleOccurrences : [],
    });
    results.push({
      id: 'svg-accessible-name',
      rule: say('chk.svg-accessible-name.rule'),
      status: svgChecks.noAccessibleName === 0 ? 'pass' : 'warn',
      message:
        svgChecks.noAccessibleName > 0
          ? say('chk.svg-accessible-name.missing', { n: svgChecks.noAccessibleName })
          : say('chk.svg-accessible-name.ok'),
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
      rule: say('chk.canvas-alt.rule'),
      status: canvasChecks.failing === 0 ? 'pass' : 'fail',
      message:
        canvasChecks.failing > 0
          ? say('chk.canvas-alt.missing', { n: canvasChecks.total })
          : say('chk.canvas-alt.ok'),
      chapter: chapterId,
      occurrences: canvasChecks.failing > 0 ? canvasChecks.occurrences : [],
    });
  }

  const mapChecks = await pageCollect(page, function collector(describeEls, limit) {
    const imgWithMap = document.querySelectorAll('img[usemap]');
    const areaNoAlt = [];
    imgWithMap.forEach((img) => {
      const mapName = img.getAttribute('usemap')?.replace('#', '');
      const mapEl = mapName ? document.querySelector(`map[name="${CSS.escape(mapName)}"]`) : null;
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
      rule: say('chk.image-map-alt.rule'),
      status: 'fail',
      message: say('chk.image-map-alt.missing', { n: mapChecks.areaNoAlt }),
      chapter: chapterId,
      occurrences: mapChecks.occurrences,
    });
  }

  return results;
}
