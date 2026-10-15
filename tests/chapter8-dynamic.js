/**
 * Chapter 8: Dynamic Updates, AJAX, and Single-Page Applications
 * Based on: module-dynamic-updates-checklist.pdf
 */
import { pageCollect } from './describe-els.js';
import { say } from './scan-text.js';

export const chapterId = 'dynamicUpdates';

export async function runDynamicChecks(page) {
  const results = [];

  // Auto-refresh meta
  const refreshMeta = await pageCollect(page, function collector(describeEls, limit) {
    const meta = document.querySelector('meta[http-equiv="refresh"]');
    return { found: !!meta, occurrences: meta ? describeEls([meta], limit) : [] };
  });

  results.push({
    id: 'no-auto-refresh',
    rule: say('chk.no-auto-refresh.rule'),
    status: !refreshMeta.found ? 'pass' : 'fail',
    message: refreshMeta.found ? say('chk.no-auto-refresh.found') : say('chk.no-auto-refresh.ok'),
    chapter: chapterId,
    occurrences: refreshMeta.found ? refreshMeta.occurrences : [],
  });

  // ARIA live regions (SPA often use these)
  const liveRegions = await pageCollect(page, function collector(describeEls, limit) {
    const live = Array.from(document.querySelectorAll('[aria-live]'));
    return { count: live.length, occurrences: describeEls(live, limit) };
  });

  results.push({
    id: 'dynamic-announcements',
    rule: say('chk.dynamic-announcements.rule'),
    status: 'info',
    message: say('chk.dynamic-announcements.count', { n: liveRegions.count }),
    chapter: chapterId,
    occurrences: liveRegions.occurrences,
  });

  const statusRole = await pageCollect(page, function collector(describeEls, limit) {
    const els = Array.from(document.querySelectorAll('[role="status"], [role="alert"]'));
    return { count: els.length, occurrences: describeEls(els, limit) };
  });
  results.push({
    id: 'dynamic-status-roles',
    rule: say('chk.dynamic-status-roles.rule'),
    status: 'info',
    message:
      statusRole.count > 0
        ? say('chk.dynamic-status-roles.found', { n: statusRole.count })
        : say('chk.dynamic-status-roles.none'),
    chapter: chapterId,
    occurrences: statusRole.occurrences,
  });

  const ariaBusy = await pageCollect(page, function collector(describeEls, limit) {
    const els = Array.from(document.querySelectorAll('[aria-busy="true"]'));
    return { count: els.length, occurrences: describeEls(els, limit) };
  });
  results.push({
    id: 'dynamic-aria-busy',
    rule: say('chk.dynamic-aria-busy.rule'),
    status: 'info',
    message:
      ariaBusy.count > 0
        ? say('chk.dynamic-aria-busy.found', { n: ariaBusy.count })
        : say('chk.dynamic-aria-busy.none'),
    chapter: chapterId,
    occurrences: ariaBusy.occurrences,
  });

  const spaHint = await pageCollect(page, function collector(describeEls, limit) {
    const text = (document.body && document.body.innerText ? document.body.innerText : '').trim();
    const roots = Array.from(document.querySelectorAll('#root, #app, [data-reactroot], [ng-version], [data-v-app]'));
    return { textLen: text.length, hasSpaRoot: roots.length > 0, occurrences: describeEls(roots, limit) };
  });
  if (spaHint.hasSpaRoot && spaHint.textLen < 80) {
    results.push({
      id: 'spa-may-be-unrendered',
      rule: say('chk.spa-may-be-unrendered.rule'),
      status: 'warn',
      message: say('chk.spa-may-be-unrendered.found', { n: spaHint.textLen }),
      chapter: chapterId,
      occurrences: spaHint.occurrences,
    });
  }

  return results;
}
