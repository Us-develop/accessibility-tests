/**
 * What the signed-in viewer may use. Staff may use everything; a customer gets
 * what their plan includes (planAllows in plan-catalog.mjs); a guest gets nothing.
 *
 * Every Pro-only surface asks here, on the server. Hiding a button in the page
 * is for clarity only and never the check itself.
 */
import { getSubscription } from './billing.mjs';
import { planAllows } from './plan-catalog.mjs';

/** Features that need Pro. */
export const PRO_FEATURES = Object.freeze(['salesReport', 'jira']);

/**
 * @param {{ role?: string, userId?: string } | null | undefined} access
 * @param {string} feature
 * @returns {Promise<boolean>}
 */
export async function accessAllows(access, feature) {
  if (!access) return false;
  if (access.role === 'staff') return true;
  if (access.role !== 'customer' || !access.userId) return false;
  return planAllows(await getSubscription(access.userId), feature);
}

/**
 * All Pro features at once, for a page that needs to know what to show.
 * @returns {Promise<Record<string, boolean>>}
 */
export async function entitlementsFor(access) {
  const entries = await Promise.all(PRO_FEATURES.map(async (feature) => [feature, await accessAllows(access, feature)]));
  return Object.fromEntries(entries);
}
