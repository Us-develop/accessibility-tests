import { decodeSession, SESSION_COOKIE } from './session.mjs';
import { findProjectByDomain } from './projects.mjs';
import { filterRunsForViewer, listRunsForDomain } from './audit-list.js';

/**
 * Viewer identity for domain history. Prefer Express/Astro `access` (already
 * validated). Fall back to the signed `wcag_sid` cookie — standalone Astro
 * drops the 4th-arg locals object, so pages must not rely on Astro.locals alone.
 */
export function viewerFromAstro(astro) {
  const access = astro?.locals?.access || null;
  const sessionToken = astro?.cookies?.get?.(SESSION_COOKIE)?.value || '';
  return { access, sessionToken };
}

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
