/**
 * Commercial catalog: guest snapshot, prepaid token packs, Pro, Us-diensten.
 * `priceCents` / Pro amounts are VAT-inclusive Belgian shelf prices.
 */

export const NONE_PLAN_ID = 'none';
export const PRO_PLAN_ID = 'pro';
/** Us's own website, for the few links that leave the app. */
export const US_SERVICES_URL = 'https://about-us.be/contact/';
/** The one in-app route to a person at Us: a page with the lead form. */
export const CONTACT_PATH = '/contact';
/** Where a lead came from. Anything else is stored as "other". */
export const LEAD_SOURCES = Object.freeze([
  'teaser',
  'home',
  'scan-limit',
  'pricing',
  'account',
  'report',
  'history',
  'developer-guide',
  'footer',
  'login',
  'contact',
]);

/** Link to the contact form, remembering where the visitor came from. */
export function contactHref(source = 'contact') {
  return `${CONTACT_PATH}?source=${encodeURIComponent(LEAD_SOURCES.includes(source) ? source : 'contact')}`;
}
export const PRO_PAGES_PER_MONTH = 300;
export const MAX_PAGES_PER_CUSTOMER_RUN = 50;
export const TOKEN_TTL_MONTHS = 12;
export const FREEBIE_PACK_ID = 'freebie';

export const TOKEN_PACKS = [
  {
    id: 'pack_10',
    tokens: 10,
    priceCents: 1000,
    name: '10 tokens',
    envName: 'STRIPE_PRICE_PACK_10',
  },
  {
    id: 'pack_50',
    tokens: 50,
    priceCents: 4500,
    name: '50 tokens',
    envName: 'STRIPE_PRICE_PACK_50',
  },
  {
    id: 'pack_100',
    tokens: 100,
    priceCents: 8000,
    name: '100 tokens',
    envName: 'STRIPE_PRICE_PACK_100',
  },
];

/**
 * What a paid scan includes, per tier. The pricing page lists these, and the
 * server checks the same flags before serving a Pro-only feature, so the page
 * can never promise something the server refuses.
 * "Token tier" is an account without Pro that pays per page with tokens.
 */
const TOKEN_TIER_FEATURES = Object.freeze({
  fullReport: true,
  developerGuide: true,
  statement: true,
  manualChecklist: true,
  history: true,
  salesReport: false,
  jira: false,
});
const PRO_TIER_FEATURES = Object.freeze({ ...TOKEN_TIER_FEATURES, salesReport: true, jira: true });

/** Order and wording of the feature list on the pricing page. */
export const PLAN_FEATURE_LABELS = Object.freeze([
  ['fullReport', 'Full report: every issue, where it is and how to fix it'],
  ['developerGuide', 'Developer fix list'],
  ['statement', 'Draft accessibility statement'],
  ['manualChecklist', 'Manual checklist and overall score'],
  ['history', 'Scan history and score trend'],
  ['salesReport', 'Sales report and PDF export'],
  ['jira', 'Export fixes to Jira'],
]);

/**
 * Feature list of a plan for display: every feature, marked included or not.
 * @param {string} planId NONE_PLAN_ID (tokens only) or PRO_PLAN_ID
 * @returns {{ key: string, label: string, included: boolean }[]}
 */
export function planFeatureList(planId) {
  const plan = DEFAULT_PLANS.find((p) => p.id === planId);
  return PLAN_FEATURE_LABELS.map(([key, label]) => ({ key, label, included: plan?.features?.[key] === true }));
}

export const DEFAULT_PLANS = [
  {
    id: NONE_PLAN_ID,
    name: 'No subscription',
    maxPagesPerScan: MAX_PAGES_PER_CUSTOMER_RUN,
    maxScansPerMonth: null,
    maxPagesPerMonth: 0,
    maxProjects: null,
    features: { ...TOKEN_TIER_FEATURES, deliverables: true, tokens: true },
    priceCents: 0,
    yearlyPriceCents: 0,
    billingInterval: null,
    active: true,
  },
  {
    id: PRO_PLAN_ID,
    name: 'Pro',
    maxPagesPerScan: MAX_PAGES_PER_CUSTOMER_RUN,
    maxScansPerMonth: null,
    maxPagesPerMonth: PRO_PAGES_PER_MONTH,
    maxProjects: null,
    features: { ...PRO_TIER_FEATURES, deliverables: true, tokens: true, dashboard: true },
    priceCents: 4900,
    yearlyPriceCents: 49000,
    billingInterval: 'monthly',
    active: true,
  },
];

export const LEGACY_PLAN_IDS = ['free', 'starter', 'agency'];

export function currentPeriod(date = new Date()) {
  return date.toISOString().slice(0, 7);
}

export function periodBounds(period) {
  const [year, month] = String(period || currentPeriod())
    .split('-')
    .map((n) => Number(n));
  const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
  const end = new Date(Date.UTC(year, month, 1, 0, 0, 0));
  return { start: start.toISOString(), end: end.toISOString() };
}

export function tokenPackById(packId) {
  return TOKEN_PACKS.find((pack) => pack.id === packId) || null;
}

export function commercialCtas() {
  return {
    tokens: '/pricing#tokens',
    pro: '/pricing#pro',
    services: contactHref('scan-limit'),
  };
}

export function addMonthsUtc(date, months) {
  const next = new Date(date.getTime());
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
}

export function isActiveProSubscription(subscription) {
  if (!subscription || subscription.planId !== PRO_PLAN_ID) return false;
  const status = String(subscription.status || '');
  return status === 'active' || status === 'trialing' || status === 'past_due';
}

export function entitlementError(message, { status = 429, code = 'plan_scan_limit' } = {}) {
  return Object.assign(new Error(message), {
    status,
    code,
    ctas: commercialCtas(),
  });
}
