/**
 * Chapter 3: Visual Design and Colors
 * Based on: module-visual-design-checklist.pdf
 * Note: Many color/contrast checks require axe-core or specialized tools.
 * This module runs axe with color/contrast rules and supplements with custom checks.
 */
import { say } from './scan-text.js';
export const chapterId = 'visualDesign';

export async function runVisualChecks(page, options = {}) {
  const results = [];
  const enableContrastChecks = options.enableContrastChecks !== false;

  if (enableContrastChecks) {
    // Text contrast check (normal text >= 4.5:1, large/bold-large >= 3:1)
    const contrastCheck = await page.evaluate(() => {
    // tagName is lower-case for inline SVG, upper-case for HTML elements.
    const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'svg', 'CANVAS', 'IMG', 'VIDEO', 'AUDIO']);

    function parseRgba(value) {
      if (!value || typeof value !== 'string') return null;
      const m = value.match(/rgba?\(([^)]+)\)/i);
      if (!m) return null;
      const parts = m[1].split(',').map((p) => p.trim());
      if (parts.length < 3) return null;
      const r = Number(parts[0]);
      const g = Number(parts[1]);
      const b = Number(parts[2]);
      const a = parts.length >= 4 ? Number(parts[3]) : 1;
      if (![r, g, b, a].every((n) => Number.isFinite(n))) return null;
      return { r, g, b, a };
    }

    function relativeLuminance({ r, g, b }) {
      const channel = (v) => {
        const n = v / 255;
        return n <= 0.03928 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4);
      };
      const R = channel(r);
      const G = channel(g);
      const B = channel(b);
      return 0.2126 * R + 0.7152 * G + 0.0722 * B;
    }

    function contrastRatio(fg, bg) {
      const l1 = relativeLuminance(fg);
      const l2 = relativeLuminance(bg);
      const hi = Math.max(l1, l2);
      const lo = Math.min(l1, l2);
      return (hi + 0.05) / (lo + 0.05);
    }

    function isVisible(el) {
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
        return false;
      }
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }

    function resolveBackgroundRgb(el) {
      let cur = el;
      while (cur && cur !== document.documentElement) {
        const bg = parseRgba(window.getComputedStyle(cur).backgroundColor);
        if (bg && bg.a > 0) {
          return { r: bg.r, g: bg.g, b: bg.b };
        }
        cur = cur.parentElement;
      }
      // Fallback approximation for fully transparent page backgrounds.
      return { r: 255, g: 255, b: 255 };
    }

    function elementSelectorHint(el) {
      const tag = (el.tagName || '').toLowerCase();
      const id = el.id ? `#${el.id}` : '';
      const classes = typeof el.className === 'string'
        ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 3).map((c) => `.${c}`).join('')
        : '';
      return `${tag}${id}${classes}` || 'element';
    }

    const violations = [];
    let checked = 0;

    const nodes = Array.from(document.querySelectorAll('body *'));
    nodes.forEach((el) => {
      if (!el || SKIP_TAGS.has(el.tagName)) return;
      if (!isVisible(el)) return;

      const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text) return;

      // Ignore text containers that only wrap other blocks; keep leaf-like text holders.
      const hasElementChildren = Array.from(el.children).some((c) => !SKIP_TAGS.has(c.tagName));
      if (hasElementChildren) return;

      const style = window.getComputedStyle(el);
      const fg = parseRgba(style.color);
      if (!fg || fg.a === 0) return;

      const bg = resolveBackgroundRgb(el);
      const ratio = contrastRatio({ r: fg.r, g: fg.g, b: fg.b }, bg);
      checked += 1;

      const fontSize = Number.parseFloat(style.fontSize || '0') || 0;
      const fontWeight = Number.parseInt(style.fontWeight || '400', 10) || 400;
      const isLarge = fontSize >= 24 || (fontWeight >= 700 && fontSize >= 18.66);
      const threshold = isLarge ? 3 : 4.5;

      if (ratio < threshold) {
        violations.push({
          tag: (el.tagName || '').toLowerCase(),
          id: el.id || '',
          className: typeof el.className === 'string' ? el.className.trim() : '',
          occurrenceLabel: ` (${ratio.toFixed(2)}:1; required ${threshold}:1)`,
          selector: elementSelectorHint(el),
        });
      }
    });

    violations.sort((a, b) => {
      const ra = Number((a.occurrenceLabel.match(/([0-9.]+):1/) || [])[1] || 999);
      const rb = Number((b.occurrenceLabel.match(/([0-9.]+):1/) || [])[1] || 999);
      return ra - rb;
    });

    const sample = violations.slice(0, 15);
    const lowest = violations.length ? (sample[0].occurrenceLabel.match(/([0-9.]+):1/) || [])[1] : null;
    return { checked, totalFailures: violations.length, lowest, sample };
  });

    if (contrastCheck.totalFailures > 0) {
      results.push({
        id: 'text-contrast',
        rule: say('chk.text-contrast.rule'),
        status: 'warn',
        message: say('chk.text-contrast.fail', {
          n: contrastCheck.totalFailures,
          lowest: contrastCheck.lowest ? say('chk.text-contrast.lowest', { ratio: contrastCheck.lowest }) : '',
          checked: contrastCheck.checked,
        }),
        chapter: chapterId,
        occurrences: contrastCheck.sample,
      });
    } else {
      results.push({
        id: 'text-contrast',
        rule: say('chk.text-contrast.rule'),
        status: 'pass',
        message: say('chk.text-contrast.ok', { checked: contrastCheck.checked }),
        chapter: chapterId,
      });
    }

    // Non-text contrast check for visual UI indicators (borders/outlines >= 3:1)
    const nonTextContrast = await page.evaluate(() => {
    function parseRgba(value) {
      if (!value || typeof value !== 'string') return null;
      const m = value.match(/rgba?\(([^)]+)\)/i);
      if (!m) return null;
      const parts = m[1].split(',').map((p) => p.trim());
      if (parts.length < 3) return null;
      const r = Number(parts[0]);
      const g = Number(parts[1]);
      const b = Number(parts[2]);
      const a = parts.length >= 4 ? Number(parts[3]) : 1;
      if (![r, g, b, a].every((n) => Number.isFinite(n))) return null;
      return { r, g, b, a };
    }

    function relativeLuminance({ r, g, b }) {
      const channel = (v) => {
        const n = v / 255;
        return n <= 0.03928 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    }

    function contrastRatio(a, b) {
      const l1 = relativeLuminance(a);
      const l2 = relativeLuminance(b);
      const hi = Math.max(l1, l2);
      const lo = Math.min(l1, l2);
      return (hi + 0.05) / (lo + 0.05);
    }

    function isVisible(el) {
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
        return false;
      }
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }

    function resolveBackgroundRgb(el) {
      let cur = el;
      while (cur && cur !== document.documentElement) {
        const bg = parseRgba(window.getComputedStyle(cur).backgroundColor);
        if (bg && bg.a > 0) return { r: bg.r, g: bg.g, b: bg.b };
        cur = cur.parentElement;
      }
      return { r: 255, g: 255, b: 255 };
    }

    function selectorHint(el) {
      const tag = (el.tagName || '').toLowerCase();
      const id = el.id ? `#${el.id}` : '';
      const classes = typeof el.className === 'string'
        ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 3).map((c) => `.${c}`).join('')
        : '';
      return `${tag}${id}${classes}` || 'element';
    }

    const candidates = Array.from(document.querySelectorAll(
      'button, input:not([type="hidden"]), select, textarea, a[href], [role="button"], [role="checkbox"], [role="radio"], [role="switch"], [tabindex]'
    ));
    const failures = [];
    let checkedIndicators = 0;

    candidates.forEach((el) => {
      if (!isVisible(el)) return;
      const style = window.getComputedStyle(el);
      const surroundingBg = resolveBackgroundRgb(el.parentElement || el);

      const borderWidths = [
        Number.parseFloat(style.borderTopWidth || '0') || 0,
        Number.parseFloat(style.borderRightWidth || '0') || 0,
        Number.parseFloat(style.borderBottomWidth || '0') || 0,
        Number.parseFloat(style.borderLeftWidth || '0') || 0,
      ];
      const hasBorder = borderWidths.some((w) => w > 0);
      if (hasBorder) {
        const borderColor = parseRgba(style.borderTopColor || style.borderColor);
        if (borderColor && borderColor.a > 0) {
          checkedIndicators += 1;
          const ratio = contrastRatio(
            { r: borderColor.r, g: borderColor.g, b: borderColor.b },
            surroundingBg
          );
          if (ratio < 3) {
            failures.push({
              tag: (el.tagName || '').toLowerCase(),
              id: el.id || '',
              className: typeof el.className === 'string' ? el.className.trim() : '',
              selector: selectorHint(el),
              occurrenceLabel: ` (border ${ratio.toFixed(2)}:1; required 3:1)`,
            });
          }
        }
      }

      const outlineWidth = Number.parseFloat(style.outlineWidth || '0') || 0;
      const outlineColor = parseRgba(style.outlineColor);
      const outlineVisible = outlineWidth > 0 && style.outlineStyle !== 'none' && outlineColor && outlineColor.a > 0;
      if (outlineVisible) {
        checkedIndicators += 1;
        const ratio = contrastRatio(
          { r: outlineColor.r, g: outlineColor.g, b: outlineColor.b },
          surroundingBg
        );
        if (ratio < 3) {
          failures.push({
            tag: (el.tagName || '').toLowerCase(),
            id: el.id || '',
            className: typeof el.className === 'string' ? el.className.trim() : '',
            selector: selectorHint(el),
            occurrenceLabel: ` (outline ${ratio.toFixed(2)}:1; required 3:1)`,
          });
        }
      }
    });

    const uniqueFailures = [];
    const seen = new Set();
    failures.forEach((f) => {
      const key = `${f.selector}|${f.occurrenceLabel}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueFailures.push(f);
      }
    });

    return {
      checkedIndicators,
      totalFailures: uniqueFailures.length,
      sample: uniqueFailures.slice(0, 15),
    };
  });

    if (nonTextContrast.totalFailures > 0) {
      results.push({
        id: 'non-text-contrast',
        rule: say('chk.non-text-contrast.rule'),
        status: 'warn',
        message: say('chk.non-text-contrast.fail', { n: nonTextContrast.totalFailures, checked: nonTextContrast.checkedIndicators }),
        chapter: chapterId,
        occurrences: nonTextContrast.sample,
      });
    } else {
      results.push({
        id: 'non-text-contrast',
        rule: say('chk.non-text-contrast.rule'),
        status: 'pass',
        message: say('chk.non-text-contrast.ok', { checked: nonTextContrast.checkedIndicators }),
        chapter: chapterId,
      });
    }
  } else {
    results.push({
      id: 'contrast-checks-disabled',
      rule: say('chk.contrast-checks-disabled.rule'),
      status: 'info',
      message: say('chk.contrast-checks-disabled.skipped'),
      chapter: chapterId,
    });
  }

  // Color-only links - links that might rely only on color
  const linkStyleChecks = await page.evaluate(() => {
    const links = document.querySelectorAll('a[href]');
    let colorOnlyCount = 0;
    links.forEach((link) => {
      const style = window.getComputedStyle(link);
      const textDecoration = style.textDecoration;
      const hasUnderline = textDecoration && textDecoration.includes('underline');
      const hasBorder = parseInt(style.borderBottomWidth) > 0 || parseInt(style.borderWidth) > 0;
      if (!hasUnderline && !hasBorder) colorOnlyCount++;
    });
    return { total: links.length, colorOnlyCount };
  });

  if (linkStyleChecks.colorOnlyCount > 0) {
    results.push({
      id: 'link-differentiation',
      rule: say('chk.link-differentiation.rule'),
      status: 'warn',
      message: say('chk.link-differentiation.colorOnly', { n: linkStyleChecks.colorOnlyCount }),
      chapter: chapterId,
    });
  }

  // Focus indicators
  const focusChecks = await page.evaluate(() => {
    const focusable = document.querySelectorAll(
      'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    let noVisibleOutline = 0;
    focusable.forEach((el) => {
      const style = window.getComputedStyle(el, ':focus');
      // Simulate focus styles - we can't easily test :focus state without focusing
      const outline = el.style.outline || getComputedStyle(el).outline;
      const outlineWidth = el.style.outlineWidth || getComputedStyle(el).outlineWidth;
      const boxShadow = el.style.boxShadow || getComputedStyle(el).boxShadow;
      const hasFocusStyle =
        (outlineWidth && outlineWidth !== '0px') ||
        (boxShadow && boxShadow !== 'none');
      if (!hasFocusStyle) noVisibleOutline++;
    });
    return { total: focusable.length, noVisibleOutline };
  });

  // This is a rough check - axe handles focus contrast better
  results.push({
    id: 'focus-indicator',
    rule: say('chk.focus-indicator.rule'),
    status: 'info',
    message: say('chk.focus-indicator.verify', { n: focusChecks.total }),
    chapter: chapterId,
  });

  return results;
}
