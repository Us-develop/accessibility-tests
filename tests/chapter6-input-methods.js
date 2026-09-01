/**
 * Chapter 6: Device-Independent Input Methods
 * Based on: module-input-methods-checklist.pdf
 */
export const chapterId = 'inputMethods';

export async function runInputMethodChecks(page) {
  const results = [];

  // Keyboard focusability
  const focusChecks = await page.evaluate(() => {
    const links = document.querySelectorAll('a[href]');
    const buttons = document.querySelectorAll('button, input[type="submit"], input[type="button"]');
    const tabindexPositive = document.querySelectorAll('[tabindex]:not([tabindex="-1"]):not([tabindex="0"])');
    const positiveValues = Array.from(tabindexPositive).filter((el) => {
      const v = parseInt(el.getAttribute('tabindex'), 10);
      return v > 0;
    });
    return {
      links: links.length,
      buttons: buttons.length,
      tabindexPositive: positiveValues.length,
    };
  });

  results.push({
    id: 'tabindex-positive',
    rule: 'tabindex with positive values SHOULD NOT be used',
    status: focusChecks.tabindexPositive === 0 ? 'pass' : 'warn',
    message:
      focusChecks.tabindexPositive > 0
        ? `${focusChecks.tabindexPositive} element(s) with positive tabindex`
        : 'No positive tabindex values',
    chapter: chapterId,
  });

  // Touch target size (WCAG 2.2 AA 2.5.8 is 24×24 CSS px)
  const touchChecks = await page.evaluate(() => {
    const interactive = document.querySelectorAll(
      'a[href], button, input, select, textarea, [role="button"], [role="link"], [onclick]'
    );
    const tooSmall = [];
    interactive.forEach((el, i) => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0 && (rect.width < 24 || rect.height < 24)) {
        tooSmall.push({ index: i + 1, w: Math.round(rect.width), h: Math.round(rect.height) });
      }
    });
    return { total: interactive.length, tooSmall };
  });

  if (touchChecks.tooSmall.length > 0) {
    results.push({
      id: 'touch-target-size',
      rule: 'Pointer targets SHOULD be at least 24×24 CSS pixels (WCAG 2.2 AA 2.5.8)',
      status: 'warn',
      message: `${touchChecks.tooSmall.length} interactive element(s) below 24×24px (exceptions such as inline links are not applied automatically)`,
      chapter: chapterId,
    });
  }

  const enhancedSmall = await page.evaluate(() => {
    const interactive = document.querySelectorAll(
      'a[href], button, input, select, textarea, [role="button"], [role="link"]'
    );
    let n = 0;
    interactive.forEach((el) => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0 && (rect.width < 44 || rect.height < 44) && rect.width >= 24 && rect.height >= 24) {
        n += 1;
      }
    });
    return n;
  });
  if (enhancedSmall > 0) {
    results.push({
      id: 'touch-target-size-enhanced',
      rule: 'Targets below 44×44 CSS pixels (AAA 2.5.5 / platform guidance) — not an AA fail',
      status: 'info',
      message: `${enhancedSmall} interactive element(s) are between 24px and 44px`,
      chapter: chapterId,
    });
  }

  return results;
}
