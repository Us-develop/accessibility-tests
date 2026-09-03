/**
 * Chapter 1: Semantic Structure and Navigation
 * Based on: module-semantic-checklist.pdf
 */
import { pageCollect } from './describe-els.js';

export const chapterId = 'semantics';

export async function runSemanticChecks(page) {
  const results = [];

  // Page Title
  const title = await page.title();
  results.push({
    id: 'page-title-exists',
    rule: 'Page MUST have a title with text',
    status: title && title.trim().length > 0 ? 'pass' : 'fail',
    message: title ? `Title: "${title.substring(0, 80)}${title.length > 80 ? '...' : ''}"` : 'Page has no title',
    chapter: chapterId,
    occurrences: title && title.trim().length > 0 ? [] : [{ tag: 'title', id: '', className: '' }],
  });

  // Primary language
  const htmlLang = await page.evaluate(() => {
    const html = document.documentElement;
    return html.getAttribute('lang');
  });
  results.push({
    id: 'html-lang',
    rule: 'Primary language MUST be identified on html element',
    status: htmlLang && htmlLang.trim().length > 0 ? 'pass' : 'fail',
    message: htmlLang ? `lang="${htmlLang}"` : 'Missing or empty lang attribute on <html>',
    chapter: chapterId,
    occurrences: htmlLang && htmlLang.trim().length > 0 ? [] : [{ tag: 'html', id: '', className: '' }],
  });

  // Landmarks
  const landmarkCount = await page.evaluate(() => {
    const landmarks = document.querySelectorAll(
      'main, [role="main"], nav, [role="navigation"], header, [role="banner"], ' +
      'footer, [role="contentinfo"], aside, [role="complementary"], [role="region"]'
    );
    return landmarks.length;
  });
  results.push({
    id: 'landmarks-present',
    rule: 'Landmarks SHOULD be used for layout (main, nav, header, footer, etc.)',
    status: landmarkCount > 0 ? 'pass' : 'warn',
    message: `Found ${landmarkCount} landmark element(s)`,
    chapter: chapterId,
  });

  // Single main landmark
  const mainData = await pageCollect(page, function collector(describeEls, limit) {
    const mains = Array.from(document.querySelectorAll('main, [role="main"]'));
    return { count: mains.length, occurrences: describeEls(mains, limit) };
  });
  results.push({
    id: 'single-main',
    rule: 'Page SHOULD have only one main landmark',
    status: mainData.count === 1 ? 'pass' : mainData.count === 0 ? 'warn' : 'fail',
    message: `Found ${mainData.count} main landmark(s)`,
    chapter: chapterId,
    occurrences: mainData.count === 1 ? [] : mainData.occurrences,
  });

  // Headings
  const headingStructure = await pageCollect(page, function collector(describeEls, limit) {
    const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'));
    const levels = headings.map((h) => parseInt(h.tagName.charAt(1), 10));
    const skipEls = headings.filter((h, i) => i > 0 && levels[i] - levels[i - 1] > 1);
    const h1s = headings.filter((h) => h.tagName === 'H1');
    const main = document.querySelector('main, [role="main"]');
    const firstInMain = main ? main.querySelector('h1, h2, h3, h4, h5, h6') : null;
    const firstInMainIsH1 = !firstInMain || firstInMain.tagName === 'H1';
    return {
      total: headings.length,
      skips: skipEls.length,
      h1Count: h1s.length,
      firstInMainIsH1,
      hasHeadingInMain: !!firstInMain,
      skipOccurrences: describeEls(skipEls, limit),
      h1Occurrences: describeEls(h1s, limit),
      firstInMainOccurrences: firstInMain && !firstInMainIsH1 ? describeEls([firstInMain], limit) : [],
    };
  });
  results.push({
    id: 'heading-structure',
    rule: 'At least one h1 SHOULD exist; heading levels SHOULD NOT skip (e.g. h1 → h3)',
    status: headingStructure.skips === 0 && headingStructure.h1Count >= 1 ? 'pass' : 'warn',
    message: `Headings: ${headingStructure.total} total, ${headingStructure.h1Count} h1(s), ${headingStructure.skips} level skip(s)`,
    chapter: chapterId,
    occurrences:
      headingStructure.skips > 0
        ? headingStructure.skipOccurrences
        : headingStructure.h1Count === 0
          ? []
          : [],
  });
  if (headingStructure.hasHeadingInMain) {
    results.push({
      id: 'heading-main-h1',
      rule: 'First heading inside <main> SHOULD be h1 when headings are used there',
      status: headingStructure.firstInMainIsH1 ? 'pass' : 'warn',
      message: headingStructure.firstInMainIsH1
        ? 'First heading in main is h1'
        : 'First heading in main is not h1',
      chapter: chapterId,
      occurrences: headingStructure.firstInMainOccurrences || [],
    });
  }

  // Links (accessible name: aria-labelledby, aria-label, content incl. img alt)
  const linkChecks = await pageCollect(page, function collector(describeEls, limit) {
    function accNameForLink(el) {
      const labelledBy = el.getAttribute('aria-labelledby');
      if (labelledBy) {
        const parts = [];
        labelledBy.split(/\s+/).forEach((id) => {
          const ref = document.getElementById(id);
          if (ref) {
            const t =
              (ref.textContent && ref.textContent.trim()) ||
              ref.getAttribute('aria-label') ||
              '';
            if (t) parts.push(t);
          }
        });
        if (parts.length) return parts.join(' ').replace(/\s+/g, ' ').trim();
      }
      const al = el.getAttribute('aria-label');
      if (al && al.trim()) return al.trim();
      const titleAttr = el.getAttribute('title');
      if (titleAttr && titleAttr.trim()) return titleAttr.trim();
      function walk(node) {
        let s = '';
        for (const ch of node.childNodes) {
          if (ch.nodeType === 3) s += ch.textContent || '';
          else if (ch.nodeType === 1) {
            const tag = ch.nodeName;
            if (tag === 'IMG') s += ch.getAttribute('alt') || '';
            else if (tag === 'SVG' || ch.getAttribute('role') === 'img') {
              s += ch.getAttribute('aria-label') || '';
              const t0 = ch.querySelector && ch.querySelector('title');
              if (t0 && t0.textContent) s += t0.textContent;
            } else {
              s += walk(ch);
            }
          }
        }
        return s;
      }
      return walk(el).replace(/\s+/g, ' ').trim();
    }
    const links = Array.from(document.querySelectorAll('a[href]'));
    const emptyText = [];
    const genericText = [];
    links.forEach((link) => {
      const accessibleName = accNameForLink(link);
      if (!accessibleName) emptyText.push(link);
      if (/^(click here|read more|link|here|learn more)$/i.test(accessibleName)) genericText.push(link);
    });
    return {
      total: links.length,
      emptyText: emptyText.length,
      genericText: genericText.length,
      emptyOccurrences: describeEls(emptyText, limit),
      genericOccurrences: describeEls(genericText, limit),
    };
  });
  results.push({
    id: 'link-text',
    rule: 'Links MUST have programmatically-discernible text',
    status: linkChecks.emptyText === 0 ? 'pass' : 'fail',
    message: linkChecks.emptyText > 0
      ? `${linkChecks.emptyText} link(s) with no accessible text`
      : `${linkChecks.total} links checked`,
    chapter: chapterId,
    occurrences: linkChecks.emptyText > 0 ? linkChecks.emptyOccurrences : [],
  });

  if (linkChecks.genericText > 0) {
    results.push({
      id: 'link-meaningful',
      rule: 'Link purpose SHOULD be determinable from link text alone',
      status: 'warn',
      message: `${linkChecks.genericText} link(s) with generic text (e.g. "click here")`,
      chapter: chapterId,
      occurrences: linkChecks.genericOccurrences,
    });
  }

  // Skip link
  const skipLink = await page.evaluate(() => {
    const firstFocusable = document.querySelector('a[href="#main"], a[href="#content"], a[href*="main"], a[href*="content"]');
    return !!firstFocusable;
  });
  results.push({
    id: 'skip-link',
    rule: 'Skip link SHOULD be provided for keyboard users',
    status: skipLink ? 'pass' : 'warn',
    message: skipLink ? 'Skip link found' : 'No skip link detected',
    chapter: chapterId,
  });

  // Tables
  const tableChecks = await pageCollect(page, function collector(describeEls, limit) {
    const tables = Array.from(document.querySelectorAll('table'));
    const noTh = tables.filter((table) => !table.querySelector('th'));
    const noCaption = tables.filter(
      (table) =>
        !table.querySelector('caption') && !table.getAttribute('aria-label') && !table.getAttribute('summary')
    );
    return {
      total: tables.length,
      noTh: noTh.length,
      noCaption: noCaption.length,
      noThOccurrences: describeEls(noTh, limit),
    };
  });
  if (tableChecks.total > 0) {
    results.push({
      id: 'table-headers',
      rule: 'Data tables MUST have header cells (th)',
      status: tableChecks.noTh === 0 ? 'pass' : 'fail',
      message: tableChecks.noTh > 0 ? `${tableChecks.noTh} table(s) without th` : 'All tables have headers',
      chapter: chapterId,
      occurrences: tableChecks.noTh > 0 ? tableChecks.noThOccurrences : [],
    });
  }

  // Lists
  const listChecks = await pageCollect(page, function collector(describeEls, limit) {
    const listItems = document.querySelectorAll('li');
    const orphanLi = Array.from(document.querySelectorAll('li:not(ul li):not(ol li)'));
    return { total: listItems.length, orphanLi: orphanLi.length, occurrences: describeEls(orphanLi, limit) };
  });
  if (listChecks.orphanLi > 0) {
    results.push({
      id: 'list-markup',
      rule: 'Lists MUST use semantic markup (ul/ol)',
      status: 'fail',
      message: `${listChecks.orphanLi} orphan li element(s) found`,
      chapter: chapterId,
      occurrences: listChecks.occurrences,
    });
  }

  // Iframes
  const iframeChecks = await pageCollect(page, function collector(describeEls, limit) {
    const iframes = Array.from(document.querySelectorAll('iframe'));
    const noTitle = iframes.filter((iframe) => {
      const title = iframe.getAttribute('title');
      return !title || title.trim() === '';
    });
    return { total: iframes.length, noTitle: noTitle.length, occurrences: describeEls(noTitle, limit) };
  });
  if (iframeChecks.total > 0) {
    results.push({
      id: 'iframe-titles',
      rule: 'Iframes MUST have non-empty title attribute',
      status: iframeChecks.noTitle === 0 ? 'pass' : 'fail',
      message: iframeChecks.noTitle > 0 ? `${iframeChecks.noTitle} iframe(s) without title` : 'All iframes have titles',
      chapter: chapterId,
      occurrences: iframeChecks.noTitle > 0 ? iframeChecks.occurrences : [],
    });
  }

  // Duplicate IDs (with occurrence details: tag, id, class only)
  const duplicateIdData = await page.evaluate(() => {
    const byId = {};
    document.querySelectorAll('[id]').forEach((el) => {
      const id = el.id;
      if (!byId[id]) byId[id] = [];
      byId[id].push(el);
    });
    const duplicateIds = Object.keys(byId).filter((id) => byId[id].length > 1);
    const occurrences = [];
    duplicateIds.forEach((id) => {
      const elements = byId[id];
      elements.forEach((el, idx) => {
        const tag = (el.tagName || '').toLowerCase();
        const className = (typeof el.className === 'string' ? el.className : '').trim().split(/\s+/).filter(Boolean).join('.');
        occurrences.push({
          tag: tag || 'element',
          id: id || '',
          className: className || '',
          occurrenceLabel: elements.length > 1 ? ` (occurrence ${idx + 1} of ${elements.length})` : '',
        });
      });
    });
    return { duplicateIds, occurrences };
  });
  if (duplicateIdData && duplicateIdData.duplicateIds.length > 0) {
    results.push({
      id: 'unique-ids',
      rule: 'IDs MUST be unique within the page',
      status: 'fail',
      message: `Duplicate IDs: ${duplicateIdData.duplicateIds.join(', ')}`,
      chapter: chapterId,
      occurrences: duplicateIdData.occurrences || [],
    });
  }

  return results;
}
