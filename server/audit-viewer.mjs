import { decodeSession } from './session.mjs';
import { findProjectByDomain } from './projects.mjs';
import { filterRunsForViewer, listRunsForDomain } from './audit-list.js';

/**
 * Domain history for the current browser session: staff see every run,
 * customers see only runs on their account (including attached guest teasers).
 * Staff/customer role comes from the signed session or Express `access` (Astro.locals),
 * never from an unsigned wcag_ui / wcag_access cookie.
 */
export async function listVisibleRunsForDomain(dbPool, reportsBase, domain, { sessionToken, access } = {}) {
  const allRuns = await listRunsForDomain(dbPool, reportsBase, domain);
  const session = decodeSession(sessionToken || '');
  const role = session?.role || access?.role || '';
  const userId = session?.sub || access?.userId || null;
  let allowedRunIds = [];
  if (role === 'customer' && userId) {
    const project = await findProjectByDomain(userId, domain);
    allowedRunIds = project?.runIds || [];
  }
  return filterRunsForViewer(allRuns, { role, userId, allowedRunIds });
}
