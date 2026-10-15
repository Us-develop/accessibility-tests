/**
 * Chapter 1: Semantic Structure and Navigation
 * Based on: module-semantic-checklist.pdf
 */
import { pageCollect } from './describe-els.js';
import { say } from './scan-text.js';

export const chapterId = 'semantics';

export async function runSemanticChecks(page) {
  const results = [];

  // Page Title
  const title = await page.title();
  results.push({
    id: 'page-title-exists',
    rule: say('chk.page-title-exists.rule'),
    status: title && title.trim().length > 0 ? 'pass' : 'fail',
    message: title ? say('chk.page-title-exists.found', { title: `${title.substring(0, 80)}${title.length > 80 ? '...' : ''}` }) : say('chk.page-title-exists.missing'),
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
    rule: say('chk.html-lang.rule'),
    status: htmlLang && htmlLang.trim().length > 0 ? 'pass' : 'fail',
    message: htmlLang ? say('chk.html-lang.found', { lang: htmlLang }) : say('chk.html-lang.missing'),
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
    rule: say('chk.landmarks-present.rule'),
    status: landmarkCount > 0 ? 'pass' : 'warn',
    message: say('chk.landmarks-present.count', { n: landmarkCount }),
    chapter: chapterId,
  });

  // Single main landmark
  const mainData = await pageCollect(page, function collector(describeEls, limit) {
    const mains = Array.from(document.querySelectorAll('main, [role="main"]'));
    return { count: mains.length, occurrences: describeEls(mains, limit) };
  });
  results.push({
    id: 'single-main',
    rule: say('chk.single-main.rule'),
    status: mainData.count === 1 ? 'pass' : mainData.count === 0 ? 'warn' : 'fail',
    message: say('chk.single-main.count', { n: mainData.count }),
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
    rule: say('chk.heading-structure.rule'),
    status: headingStructure.skips === 0 && headingStructure.h1Count >= 1 ? 'pass' : 'warn',
    message: say('chk.heading-structure.summary', { total: headingStructure.total, h1: headingStructure.h1Count, skips: headingStructure.skips }),
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
      rule: say('chk.heading-main-h1.rule'),
      status: headingStructure.firstInMainIsH1 ? 'pass' : 'warn',
      message: headingStructure.firstInMainIsH1
        ? say('chk.heading-main-h1.yes')
        : say('chk.heading-main-h1.no'),
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
            // nodeName is lower-case for inline SVG and upper-case for HTML elements.
            else if (tag.toLowerCase() === 'svg' || ch.getAttribute('role') === 'img') {
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
    rule: say('chk.link-text.rule'),
    status: linkChecks.emptyText === 0 ? 'pass' : 'fail',
    message: linkChecks.emptyText > 0
      ? say('chk.link-text.empty', { n: linkChecks.emptyText })
      : say('chk.link-text.checked', { n: linkChecks.total }),
    chapter: chapterId,
    occurrences: linkChecks.emptyText > 0 ? linkChecks.emptyOccurrences : [],
  });

  if (linkChecks.genericText > 0) {
    results.push({
      id: 'link-meaningful',
      rule: say('chk.link-meaningful.rule'),
      status: 'warn',
      message: say('chk.link-meaningful.generic', { n: linkChecks.genericText }),
      chapter: chapterId,
      occurrences: linkChecks.genericOccurrences,
    });
  }

  // Skip link
  // A skip link is one of the first links on the page and points at an element
  // that exists on the same page. Matching on words in the href is not enough:
  // "/wp-content/…" contains "content".
  const skipLink = await page.evaluate(() => {
    const firstLinks = Array.from(document.querySelectorAll('a[href]')).slice(0, 3);
    return firstLinks.some((a) => {
      const href = a.getAttribute('href') || '';
      if (!href.startsWith('#') || href.length < 2) return false;
      let id = href.slice(1);
      try {
        id = decodeURIComponent(id);
      } catch {
        /* keep the raw fragment */
      }
      return Boolean(document.getElementById(id) || document.getElementsByName(id)[0]);
    });
  });
  results.push({
    id: 'skip-link',
    rule: say('chk.skip-link.rule'),
    status: skipLink ? 'pass' : 'warn',
    message: skipLink ? say('chk.skip-link.found') : say('chk.skip-link.missing'),
    chapter: chapterId,
  });

  // Tables
  const tableChecks = await pageCollect(page, function collector(describeEls, limit) {
    // Layout tables (role="presentation" / "none") are not data tables.
    const tables = Array.from(document.querySelectorAll('table')).filter(
      (table) => !/^(presentation|none)$/i.test(table.getAttribute('role') || '')
    );
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
      rule: say('chk.table-headers.rule'),
      status: tableChecks.noTh === 0 ? 'pass' : 'fail',
      message: tableChecks.noTh > 0 ? say('chk.table-headers.missing', { n: tableChecks.noTh }) : say('chk.table-headers.ok'),
      chapter: chapterId,
      occurrences: tableChecks.noTh > 0 ? tableChecks.noThOccurrences : [],
    });
  }

  // Lists
  const listChecks = await pageCollect(page, function collector(describeEls, limit) {
    const listItems = document.querySelectorAll('li');
    const orphanLi = Array.from(document.querySelectorAll('li:not(ul li):not(ol li):not(menu li)'));
    return { total: listItems.length, orphanLi: orphanLi.length, occurrences: describeEls(orphanLi, limit) };
  });
  if (listChecks.orphanLi > 0) {
    results.push({
      id: 'list-markup',
      rule: say('chk.list-markup.rule'),
      status: 'fail',
      message: say('chk.list-markup.orphans', { n: listChecks.orphanLi }),
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
      rule: say('chk.iframe-titles.rule'),
      status: iframeChecks.noTitle === 0 ? 'pass' : 'fail',
      message: iframeChecks.noTitle > 0 ? say('chk.iframe-titles.missing', { n: iframeChecks.noTitle }) : say('chk.iframe-titles.ok'),
      chapter: chapterId,
      occurrences: iframeChecks.noTitle > 0 ? iframeChecks.occurrences : [],
    });
  }

  // Duplicate IDs (with occurrence details: tag, id, class only)
  const duplicateIdData = await page.evaluate(() => {
    // A Map, not an object: ids such as "constructor" or "toString" exist on every object.
    const byId = new Map();
    document.querySelectorAll('[id]').forEach((el) => {
      const id = el.id;
      if (!byId.has(id)) byId.set(id, []);
      byId.get(id).push(el);
    });
    const duplicateIds = Array.from(byId.keys()).filter((id) => byId.get(id).length > 1);
    const occurrences = [];
    duplicateIds.forEach((id) => {
      const elements = byId.get(id);
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
      rule: say('chk.unique-ids.rule'),
      status: 'fail',
      message: say('chk.unique-ids.duplicates', { ids: duplicateIdData.duplicateIds.join(', ') }),
      chapter: chapterId,
      occurrences: duplicateIdData.occurrences || [],
    });
  }

  return results;
}
