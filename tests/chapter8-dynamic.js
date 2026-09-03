/**
 * Chapter 8: Dynamic Updates, AJAX, and Single-Page Applications
 * Based on: module-dynamic-updates-checklist.pdf
 */
import { pageCollect } from './describe-els.js';

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
    rule: 'Page MUST NOT refresh or reload automatically',
    status: !refreshMeta.found ? 'pass' : 'fail',
    message: refreshMeta.found ? 'Meta refresh found - may auto-reload page' : 'No meta refresh',
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
    rule: 'Dynamic content changes SHOULD be announced (aria-live, etc.)',
    status: 'info',
    message: `Found ${liveRegions.count} aria-live region(s) - verify status messages are announced`,
    chapter: chapterId,
    occurrences: liveRegions.occurrences,
  });

  const statusRole = await pageCollect(page, function collector(describeEls, limit) {
    const els = Array.from(document.querySelectorAll('[role="status"], [role="alert"]'));
    return { count: els.length, occurrences: describeEls(els, limit) };
  });
  results.push({
    id: 'dynamic-status-roles',
    rule: 'Status and alert regions (role=status / role=alert) — verify messages for users',
    status: 'info',
    message:
      statusRole.count > 0
        ? `Found ${statusRole.count} element(s) with role="status" or role="alert" — confirm important updates are communicated`
        : 'No role="status" or role="alert" regions found (not required on every page)',
    chapter: chapterId,
    occurrences: statusRole.occurrences,
  });

  const ariaBusy = await pageCollect(page, function collector(describeEls, limit) {
    const els = Array.from(document.querySelectorAll('[aria-busy="true"]'));
    return { count: els.length, occurrences: describeEls(els, limit) };
  });
  results.push({
    id: 'dynamic-aria-busy',
    rule: 'Loading state (aria-busy) — verify assistive tech users get appropriate feedback',
    status: 'info',
    message:
      ariaBusy.count > 0
        ? `Found ${ariaBusy.count} element(s) with aria-busy="true" — ensure content updates are announced when loading finishes`
        : 'No aria-busy="true" while testing initial load (SPA loading states may appear after interaction)',
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
      rule: 'Page looks client-rendered; automated checks may have missed in-app content',
      status: 'warn',
      message: `SPA root detected with only ${spaHint.textLen} characters of text at scan time. Enable WAIT_FOR_NETWORKIDLE or test URLs after hydration. This chapter cannot certify dynamic updates.`,
      chapter: chapterId,
      occurrences: spaHint.occurrences,
    });
  }

  return results;
}
