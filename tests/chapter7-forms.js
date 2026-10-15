/**
 * Chapter 7: Form Labels, Instructions, and Validation
 * Based on: module-forms-checklist.pdf
 */
import { pageCollect } from './describe-els.js';
import { say } from './scan-text.js';

export const chapterId = 'forms';

export async function runFormChecks(page) {
  const results = [];

  const formChecks = await pageCollect(page, function collector(describeEls, limit) {
    const inputs = Array.from(
      document.querySelectorAll(
        'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]), textarea, select'
      )
    );
    const missingLabel = [];
    const placeholderOnly = [];

    inputs.forEach((input) => {
      const id = input.getAttribute('id');
      const ariaLabel = input.getAttribute('aria-label');
      const ariaLabelledby = input.getAttribute('aria-labelledby');
      const placeholder = input.getAttribute('placeholder');
      const byFor = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
      const label = byFor || input.closest('label');
      const title = input.getAttribute('title');
      const hasLabel = !!(label?.textContent?.trim() || ariaLabel || ariaLabelledby || title?.trim());
      // Each unlabelled input is reported once: under the placeholder rule when a
      // placeholder is standing in for the label, otherwise as a missing label.
      if (!hasLabel && placeholder?.trim()) placeholderOnly.push(input);
      else if (!hasLabel) missingLabel.push(input);
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
      rule: say('chk.form-labels.rule'),
      status: formChecks.missingLabel === 0 ? 'pass' : 'fail',
      message:
        formChecks.missingLabel > 0
          ? say('chk.form-labels.missing', { n: formChecks.missingLabel })
          : say('chk.form-labels.ok'),
      chapter: chapterId,
      occurrences: formChecks.missingLabel > 0 ? formChecks.missingOccurrences : [],
    });

    results.push({
      id: 'placeholder-not-only-label',
      rule: say('chk.placeholder-not-only-label.rule'),
      status: formChecks.placeholderOnly === 0 ? 'pass' : 'fail',
      message:
        formChecks.placeholderOnly > 0
          ? say('chk.placeholder-not-only-label.found', { n: formChecks.placeholderOnly })
          : say('chk.placeholder-not-only-label.ok'),
      chapter: chapterId,
      occurrences: formChecks.placeholderOnly > 0 ? formChecks.placeholderOccurrences : [],
    });
  }

  return results;
}
