/**
 * Chapter 6: Device-Independent Input Methods
 * Based on: module-input-methods-checklist.pdf
 */
import { pageCollect } from './describe-els.js';

export const chapterId = 'inputMethods';

export async function runInputMethodChecks(page) {
  const results = [];

  const focusChecks = await pageCollect(page, function collector(describeEls, limit) {
    const links = document.querySelectorAll('a[href]');
    const buttons = document.querySelectorAll('button, input[type="submit"], input[type="button"]');
    const positiveValues = Array.from(
      document.querySelectorAll('[tabindex]:not([tabindex="-1"]):not([tabindex="0"])')
    ).filter((el) => parseInt(el.getAttribute('tabindex'), 10) > 0);
    return {
      links: links.length,
      buttons: buttons.length,
      tabindexPositive: positiveValues.length,
      occurrences: describeEls(positiveValues, limit),
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
    occurrences: focusChecks.tabindexPositive > 0 ? focusChecks.occurrences : [],
  });

  const touchChecks = await pageCollect(page, function collector(describeEls, limit) {
    const interactive = Array.from(
      document.querySelectorAll(
        'a[href], button, input, select, textarea, [role="button"], [role="link"], [onclick]'
      )
    );
    const tooSmall = interactive.filter((el) => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && (rect.width < 24 || rect.height < 24);
    });
    const enhancedSmall = interactive.filter((el) => {
      const rect = el.getBoundingClientRect();
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        (rect.width < 44 || rect.height < 44) &&
        rect.width >= 24 &&
        rect.height >= 24
      );
    });
    return {
      total: interactive.length,
      tooSmall: tooSmall.length,
      enhancedSmall: enhancedSmall.length,
      tooSmallOccurrences: describeEls(tooSmall, limit),
      enhancedOccurrences: describeEls(enhancedSmall, limit),
    };
  });

  if (touchChecks.tooSmall > 0) {
    results.push({
      id: 'touch-target-size',
      rule: 'Pointer targets SHOULD be at least 24×24 CSS pixels (WCAG 2.2 AA 2.5.8)',
      status: 'warn',
      message: `${touchChecks.tooSmall} interactive element(s) below 24×24px (exceptions such as inline links are not applied automatically)`,
      chapter: chapterId,
      occurrences: touchChecks.tooSmallOccurrences,
    });
  }

  if (touchChecks.enhancedSmall > 0) {
    results.push({
      id: 'touch-target-size-enhanced',
      rule: 'Targets below 44×44 CSS pixels (AAA 2.5.5 / platform guidance) — not an AA fail',
      status: 'info',
      message: `${touchChecks.enhancedSmall} interactive element(s) are between 24px and 44px`,
      chapter: chapterId,
      occurrences: touchChecks.enhancedOccurrences,
    });
  }

  return results;
}
