/** Commercial catalog: guest snapshot, prepaid token packs, Pro, Us-diensten. */

export const NONE_PLAN_ID = 'none';
export const PRO_PLAN_ID = 'pro';
export const US_SERVICES_URL = 'https://about-us.be/contact/';
export const PRO_PAGES_PER_MONTH = 300;
export const MAX_PAGES_PER_CUSTOMER_RUN = 50;
export const TOKEN_TTL_MONTHS = 12;

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

export const DEFAULT_PLANS = [
  {
    id: NONE_PLAN_ID,
    name: 'No subscription',
    maxPagesPerScan: MAX_PAGES_PER_CUSTOMER_RUN,
    maxScansPerMonth: null,
    maxPagesPerMonth: 0,
    maxProjects: null,
    features: { deliverables: true, tokens: true },
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
    features: { deliverables: true, tokens: true, dashboard: true },
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
    services: US_SERVICES_URL,
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
