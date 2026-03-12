/**
 * Chapter 1: Semantic Structure and Navigation
 * Based on: module-semantic-checklist.pdf
 */
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
  const mainCount = await page.evaluate(() => {
    return document.querySelectorAll('main, [role="main"]').length;
  });
  results.push({
    id: 'single-main',
    rule: 'Page SHOULD have only one main landmark',
    status: mainCount === 1 ? 'pass' : mainCount === 0 ? 'warn' : 'fail',
    message: `Found ${mainCount} main landmark(s)`,
    chapter: chapterId,
  });

  // Headings
  const headingStructure = await page.evaluate(() => {
    const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'));
    const levels = headings.map((h) => parseInt(h.tagName.charAt(1)));
    const skips = levels.filter((lev, i) => i > 0 && lev - levels[i - 1] > 1);
    const h1Count = levels.filter((l) => l === 1).length;
    return { total: headings.length, skips: skips.length, h1Count };
  });
  results.push({
    id: 'heading-structure',
    rule: 'Main content SHOULD start with h1, headings SHOULD NOT skip levels',
    status: headingStructure.skips === 0 && headingStructure.h1Count >= 1 ? 'pass' : 'warn',
    message: `Headings: ${headingStructure.total} total, ${headingStructure.h1Count} h1(s), ${headingStructure.skips} level skip(s)`,
    chapter: chapterId,
  });

  // Links
  const linkChecks = await page.evaluate(() => {
    const links = document.querySelectorAll('a[href]');
    const emptyText = [];
    const genericText = [];
    links.forEach((link, i) => {
      const text = (link.textContent || '').trim();
      const ariaLabel = link.getAttribute('aria-label');
      const title = link.getAttribute('title');
      const accessibleName = text || ariaLabel || title || '';
      if (!accessibleName) emptyText.push(i + 1);
      if (/^(click here|read more|link|here|learn more)$/i.test(accessibleName)) genericText.push(accessibleName);
    });
    return { total: links.length, emptyText: emptyText.length, genericText: genericText.length };
  });
  results.push({
    id: 'link-text',
    rule: 'Links MUST have programmatically-discernible text',
    status: linkChecks.emptyText === 0 ? 'pass' : 'fail',
    message: linkChecks.emptyText > 0
      ? `${linkChecks.emptyText} link(s) with no accessible text`
      : `${linkChecks.total} links checked`,
    chapter: chapterId,
  });

  if (linkChecks.genericText > 0) {
    results.push({
      id: 'link-meaningful',
      rule: 'Link purpose SHOULD be determinable from link text alone',
      status: 'warn',
      message: `${linkChecks.genericText} link(s) with generic text (e.g. "click here")`,
      chapter: chapterId,
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
  const tableChecks = await page.evaluate(() => {
    const tables = document.querySelectorAll('table');
    let noTh = 0;
    let noCaption = 0;
    tables.forEach((table) => {
      if (!table.querySelector('th')) noTh++;
      if (!table.querySelector('caption') && !table.getAttribute('aria-label') && !table.getAttribute('summary')) noCaption++;
    });
    return { total: tables.length, noTh, noCaption };
  });
  if (tableChecks.total > 0) {
    results.push({
      id: 'table-headers',
      rule: 'Data tables MUST have header cells (th)',
      status: tableChecks.noTh === 0 ? 'pass' : 'fail',
      message: tableChecks.noTh > 0 ? `${tableChecks.noTh} table(s) without th` : 'All tables have headers',
      chapter: chapterId,
    });
  }

  // Lists
  const listChecks = await page.evaluate(() => {
    const listItems = document.querySelectorAll('li');
    const orphanLi = document.querySelectorAll('li:not(ul li):not(ol li)');
    return { total: listItems.length, orphanLi: orphanLi.length };
  });
  if (listChecks.orphanLi > 0) {
    results.push({
      id: 'list-markup',
      rule: 'Lists MUST use semantic markup (ul/ol)',
      status: 'fail',
      message: `${listChecks.orphanLi} orphan li element(s) found`,
      chapter: chapterId,
    });
  }

  // Iframes
  const iframeChecks = await page.evaluate(() => {
    const iframes = document.querySelectorAll('iframe');
    const noTitle = [];
    iframes.forEach((iframe, i) => {
      const title = iframe.getAttribute('title');
      if (!title || title.trim() === '') noTitle.push(i + 1);
    });
    return { total: iframes.length, noTitle: noTitle.length };
  });
  if (iframeChecks.total > 0) {
    results.push({
      id: 'iframe-titles',
      rule: 'Iframes MUST have non-empty title attribute',
      status: iframeChecks.noTitle === 0 ? 'pass' : 'fail',
      message: iframeChecks.noTitle > 0 ? `${iframeChecks.noTitle} iframe(s) without title` : 'All iframes have titles',
      chapter: chapterId,
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
