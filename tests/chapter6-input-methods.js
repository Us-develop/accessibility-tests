/**
 * Chapter 6: Device-Independent Input Methods
 * Based on: module-input-methods-checklist.pdf
 */
import { pageCollect } from './describe-els.js';
import { say } from './scan-text.js';

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
    rule: say('chk.tabindex-positive.rule'),
    status: focusChecks.tabindexPositive === 0 ? 'pass' : 'warn',
    message:
      focusChecks.tabindexPositive > 0
        ? say('chk.tabindex-positive.found', { n: focusChecks.tabindexPositive })
        : say('chk.tabindex-positive.ok'),
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
      rule: say('chk.touch-target-size.rule'),
      status: 'warn',
      message: say('chk.touch-target-size.small', { n: touchChecks.tooSmall }),
      chapter: chapterId,
      occurrences: touchChecks.tooSmallOccurrences,
    });
  }

  if (touchChecks.enhancedSmall > 0) {
    results.push({
      id: 'touch-target-size-enhanced',
      rule: say('chk.touch-target-size-enhanced.rule'),
      status: 'info',
      message: say('chk.touch-target-size-enhanced.between', { n: touchChecks.enhancedSmall }),
      chapter: chapterId,
      occurrences: touchChecks.enhancedOccurrences,
    });
  }

  return results;
}
