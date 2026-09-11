import { decodeSession } from './session.mjs';
import { findProjectByDomain } from './projects.mjs';
import { filterRunsForViewer, listRunsForDomain } from './audit-list.js';

/**
 * Domain history for the current browser session: staff see every run,
 * customers see only runs on their account (including attached guest teasers).
 */
export async function listVisibleRunsForDomain(dbPool, reportsBase, domain, { sessionToken, uiHint } = {}) {
  const allRuns = await listRunsForDomain(dbPool, reportsBase, domain);
  const session = decodeSession(sessionToken || '');
  const role = session?.role || (uiHint === '1' ? 'staff' : uiHint === 'c' ? 'customer' : '');
  const userId = session?.sub || null;
  let allowedRunIds = [];
  if (role === 'customer' && userId) {
    const project = await findProjectByDomain(userId, domain);
    allowedRunIds = project?.runIds || [];
  }
  return filterRunsForViewer(allRuns, { role, userId, allowedRunIds });
}
