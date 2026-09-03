/**
 * Chapter 7: Form Labels, Instructions, and Validation
 * Based on: module-forms-checklist.pdf
 */
import { pageCollect } from './describe-els.js';

export const chapterId = 'forms';

export async function runFormChecks(page) {
  const results = [];

  const formChecks = await pageCollect(page, function collector(describeEls, limit) {
    const inputs = Array.from(
      document.querySelectorAll(
        'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="image"]), textarea, select'
      )
    );
    const missingLabel = [];
    const placeholderOnly = [];

    inputs.forEach((input) => {
      const id = input.getAttribute('id');
      const ariaLabel = input.getAttribute('aria-label');
      const ariaLabelledby = input.getAttribute('aria-labelledby');
      const placeholder = input.getAttribute('placeholder');
      const label = id ? document.querySelector(`label[for="${id}"]`) : input.closest('label');
      const hasLabel = !!(label?.textContent?.trim() || ariaLabel || ariaLabelledby);
      if (!hasLabel) missingLabel.push(input);
      if (hasLabel && !label?.textContent?.trim() && !ariaLabel && !ariaLabelledby && placeholder) {
        placeholderOnly.push(input);
      }
    });

    return {
      total: inputs.length,
      missingLabel: missingLabel.length,
      placeholderOnly: placeholderOnly.length,
      missingOccurrences: describeEls(missingLabel, limit),
      placeholderOccurrences: describeEls(placeholderOnly, limit),
    };
  });

  if (formChecks.total > 0) {
    results.push({
      id: 'form-labels',
      rule: 'Form inputs MUST have programmatically-associated labels',
      status: formChecks.missingLabel === 0 ? 'pass' : 'fail',
      message:
        formChecks.missingLabel > 0
          ? `${formChecks.missingLabel} input(s) without proper label`
          : 'All inputs have labels',
      chapter: chapterId,
      occurrences: formChecks.missingLabel > 0 ? formChecks.missingOccurrences : [],
    });

    results.push({
      id: 'placeholder-not-only-label',
      rule: 'Placeholder MUST NOT be the only label for inputs',
      status: formChecks.placeholderOnly === 0 ? 'pass' : 'fail',
      message:
        formChecks.placeholderOnly > 0
          ? `${formChecks.placeholderOnly} input(s) may use placeholder as only label`
          : 'No placeholder-only labels',
      chapter: chapterId,
      occurrences: formChecks.placeholderOnly > 0 ? formChecks.placeholderOccurrences : [],
    });
  }

  return results;
}
