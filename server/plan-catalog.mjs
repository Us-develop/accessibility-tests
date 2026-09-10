/** Catalog of subscription plans. Stripe is not wired; prices are for display. */

export const DEFAULT_PLANS = [
  {
    id: 'free',
    name: 'Free',
    maxPagesPerScan: 1,
    maxScansPerMonth: 30,
    maxProjects: 10,
    features: { deliverables: false, apiAccess: false, priorityQueue: false },
    priceCents: 0,
    billingInterval: 'monthly',
    active: true,
  },
  {
    id: 'starter',
    name: 'Starter',
    maxPagesPerScan: 10,
    maxScansPerMonth: 100,
    maxProjects: 25,
    features: { deliverables: true, apiAccess: false, priorityQueue: false },
    priceCents: 2900,
    billingInterval: 'monthly',
    active: true,
  },
  {
    id: 'pro',
    name: 'Pro',
    maxPagesPerScan: 50,
    maxScansPerMonth: 500,
    maxProjects: 100,
    features: { deliverables: true, apiAccess: true, priorityQueue: false },
    priceCents: 7900,
    billingInterval: 'monthly',
    active: true,
  },
  {
    id: 'agency',
    name: 'Agency',
    maxPagesPerScan: null,
    maxScansPerMonth: null,
    maxProjects: null,
    features: { deliverables: true, apiAccess: true, priorityQueue: true },
    priceCents: 19900,
    billingInterval: 'monthly',
    active: true,
  },
];

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
