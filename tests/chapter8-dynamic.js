/**
 * Chapter 8: Dynamic Updates, AJAX, and Single-Page Applications
 * Based on: module-dynamic-updates-checklist.pdf
 */
export const chapterId = 'dynamicUpdates';

export async function runDynamicChecks(page) {
  const results = [];

  // Auto-refresh meta
  const refreshMeta = await page.evaluate(() => {
    const meta = document.querySelector('meta[http-equiv="refresh"]');
    return !!meta;
  });

  results.push({
    id: 'no-auto-refresh',
    rule: 'Page MUST NOT refresh or reload automatically',
    status: !refreshMeta ? 'pass' : 'fail',
    message: refreshMeta ? 'Meta refresh found - may auto-reload page' : 'No meta refresh',
    chapter: chapterId,
  });

  // ARIA live regions (SPA often use these)
  const liveRegions = await page.evaluate(() => {
    const live = document.querySelectorAll('[aria-live]');
    return live.length;
  });

  results.push({
    id: 'dynamic-announcements',
    rule: 'Dynamic content changes SHOULD be announced (aria-live, etc.)',
    status: 'info',
    message: `Found ${liveRegions} aria-live region(s) - verify status messages are announced`,
    chapter: chapterId,
  });

  const statusRoleCount = await page.evaluate(() => {
    return document.querySelectorAll('[role="status"], [role="alert"]').length;
  });
  results.push({
    id: 'dynamic-status-roles',
    rule: 'Status and alert regions (role=status / role=alert) — verify messages for users',
    status: 'info',
    message:
      statusRoleCount > 0
        ? `Found ${statusRoleCount} element(s) with role="status" or role="alert" — confirm important updates are communicated`
        : 'No role="status" or role="alert" regions found (not required on every page)',
    chapter: chapterId,
  });

  const ariaBusyCount = await page.evaluate(() => {
    return document.querySelectorAll('[aria-busy="true"]').length;
  });
  results.push({
    id: 'dynamic-aria-busy',
    rule: 'Loading state (aria-busy) — verify assistive tech users get appropriate feedback',
    status: 'info',
    message:
      ariaBusyCount > 0
        ? `Found ${ariaBusyCount} element(s) with aria-busy="true" — ensure content updates are announced when loading finishes`
        : 'No aria-busy="true" while testing initial load (SPA loading states may appear after interaction)',
    chapter: chapterId,
  });

  const spaHint = await page.evaluate(() => {
    const text = (document.body && document.body.innerText ? document.body.innerText : '').trim();
    const hasSpaRoot = !!document.querySelector('#root, #app, [data-reactroot], [ng-version], [data-v-app]');
    return { textLen: text.length, hasSpaRoot };
  });
  if (spaHint.hasSpaRoot && spaHint.textLen < 80) {
    results.push({
      id: 'spa-may-be-unrendered',
      rule: 'Page looks client-rendered; automated checks may have missed in-app content',
      status: 'warn',
      message: `SPA root detected with only ${spaHint.textLen} characters of text at scan time. Enable WAIT_FOR_NETWORKIDLE or test URLs after hydration. This chapter cannot certify dynamic updates.`,
      chapter: chapterId,
    });
  }

  return results;
}
