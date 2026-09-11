import { randomBytes } from 'crypto';
import Stripe from 'stripe';
import {
  ensureFreeSubscription,
  findPaymentByStripeIntent,
  getSubscription,
  getSubscriptionByStripeCustomer,
  getSubscriptionByStripeSubscription,
  insertPayment,
  listPlans,
  upsertSubscription,
} from './billing.mjs';

const STRIPE_API_VERSION = '2026-08-26.dahlia';
const PAID_PLAN_IDS = ['starter', 'pro', 'agency'];

function parseBooleanEnv(name, defaultValue = false) {
  const raw = process.env[name];
  if (raw == null) return defaultValue;
  const value = String(raw).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(value)) return true;
  if (['0', 'false', 'no', 'off'].includes(value)) return false;
  return defaultValue;
}

export function publicAppBase() {
  return String(process.env.PUBLIC_BASE_URL || '').trim().replace(/\/$/, '') || 'http://localhost:3456';
}

export function stripeSecretKey() {
  return String(process.env.STRIPE_SECRET_KEY || process.env.STRIPE_API_KEY || '').trim();
}

export function stripeWebhookSecret() {
  return String(process.env.STRIPE_WEBHOOK_SECRET || '').trim();
}

export function stripeConfigured() {
  return Boolean(stripeSecretKey());
}

export function automaticTaxEnabled() {
  return parseBooleanEnv('STRIPE_AUTOMATIC_TAX', true);
}

export function priceEnvName(planId) {
  return `STRIPE_PRICE_${String(planId || '').toUpperCase()}`;
}

export function priceIdForPlan(planId) {
  if (!PAID_PLAN_IDS.includes(planId)) return '';
  return String(process.env[priceEnvName(planId)] || '').trim();
}

export function planIdFromPrice(priceId) {
  const needle = String(priceId || '').trim();
  if (!needle) return null;
  for (const planId of PAID_PLAN_IDS) {
    if (priceIdForPlan(planId) === needle) return planId;
  }
  return null;
}

export function integrationIdentifier() {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz';
  const bytes = randomBytes(8);
  let suffix = '';
  for (const byte of bytes) suffix += alphabet[byte % 26];
  return `wcag-upgrade-${suffix}`;
}

/** @type {Stripe | null} */
let cachedClient = null;
let cachedKey = '';

export function getStripe() {
  const key = stripeSecretKey();
  if (!key) {
    throw Object.assign(new Error('Stripe is not configured.'), { status: 503, code: 'stripe_unconfigured' });
  }
  if (cachedClient && cachedKey === key) return cachedClient;
  cachedClient = new Stripe(key, { apiVersion: STRIPE_API_VERSION });
  cachedKey = key;
  return cachedClient;
}

export async function billingPublicConfig() {
  const plans = await listPlans();
  return {
    configured: stripeConfigured(),
    automaticTax: automaticTaxEnabled(),
    currency: 'eur',
    plans: plans.map((plan) => ({
      id: plan.id,
      name: plan.name,
      maxPagesPerScan: plan.maxPagesPerScan,
      maxScansPerMonth: plan.maxScansPerMonth,
      maxProjects: plan.maxProjects,
      priceCents: plan.priceCents,
      billingInterval: plan.billingInterval,
      features: plan.features || {},
      checkoutReady: plan.id === 'free' ? false : Boolean(stripeConfigured() && priceIdForPlan(plan.id)),
    })),
  };
}

function isoCountry(value) {
  const raw = String(value || '').trim();
  if (/^[A-Za-z]{2}$/.test(raw)) return raw.toUpperCase();
  return '';
}

function unixToIso(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n * 1000).toISOString();
}

function periodFromStripeSubscription(sub) {
  const item = sub?.items?.data?.[0];
  return {
    start: unixToIso(sub?.current_period_start || item?.current_period_start),
    end: unixToIso(sub?.current_period_end || item?.current_period_end),
  };
}

function localStatusFromStripe(status) {
  switch (status) {
    case 'active':
    case 'trialing':
      return 'active';
    case 'past_due':
      return 'past_due';
    case 'unpaid':
      return 'unpaid';
    case 'canceled':
    case 'incomplete_expired':
      return 'canceled';
    case 'incomplete':
    case 'paused':
      return String(status);
    default:
      return status ? String(status) : 'active';
  }
}

async function resolveUserId({ userId, customerId, subscriptionId }) {
  if (userId) return userId;
  const byCustomer = await getSubscriptionByStripeCustomer(customerId);
  if (byCustomer?.userId) return byCustomer.userId;
  const bySub = await getSubscriptionByStripeSubscription(subscriptionId);
  return bySub?.userId || null;
}

export async function applyStripeSubscription(stripeSub, { userId: knownUserId, customerId } = {}) {
  if (!stripeSub?.id) return null;
  const priceId = stripeSub.items?.data?.[0]?.price?.id || stripeSub.items?.data?.[0]?.price;
  const mappedPlan = planIdFromPrice(typeof priceId === 'string' ? priceId : '') || stripeSub.metadata?.planId || null;
  const canceled = stripeSub.status === 'canceled' || stripeSub.status === 'unpaid' || stripeSub.status === 'incomplete_expired';
  const planId = canceled ? 'free' : mappedPlan;
  if (!canceled && !planId) {
    console.warn(`[stripe] unknown price ${priceId} on ${stripeSub.id}`);
    return null;
  }
  const customer = customerId || (typeof stripeSub.customer === 'string' ? stripeSub.customer : stripeSub.customer?.id);
  const userId = await resolveUserId({
    userId: knownUserId || stripeSub.metadata?.userId,
    customerId: customer,
    subscriptionId: stripeSub.id,
  });
  if (!userId) {
    console.warn(`[stripe] no local user for subscription ${stripeSub.id}`);
    return null;
  }
  const existing = (await getSubscription(userId)) || (await ensureFreeSubscription(userId));
  const period = periodFromStripeSubscription(stripeSub);
  return upsertSubscription({
    id: existing.id,
    userId,
    planId: planId || 'free',
    status: canceled ? 'canceled' : localStatusFromStripe(stripeSub.status),
    currentPeriodStart: period.start || existing.currentPeriodStart,
    currentPeriodEnd: period.end || existing.currentPeriodEnd,
    stripeSubscriptionId: canceled ? existing.stripeSubscriptionId : stripeSub.id,
    stripeCustomerId: customer || existing.stripeCustomerId,
    createdAt: existing.createdAt,
  });
}

export async function recordStripeInvoice(invoice) {
  const amount = Number(invoice?.amount_paid || 0);
  if (!invoice || amount <= 0) return null;
  const intentId =
    typeof invoice.payment_intent === 'string'
      ? invoice.payment_intent
      : invoice.payment_intent?.id || invoice.id;
  const existing = await findPaymentByStripeIntent(intentId);
  if (existing) return existing;
  const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
  const subscriptionId =
    typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription?.id;
  const userId = await resolveUserId({
    userId: invoice.subscription_details?.metadata?.userId || invoice.metadata?.userId,
    customerId,
    subscriptionId,
  });
  if (!userId) return null;
  return insertPayment({
    id: randomBytes(10).toString('hex'),
    userId,
    amountCents: amount,
    currency: String(invoice.currency || 'eur').toLowerCase(),
    status: 'paid',
    description: invoice.lines?.data?.[0]?.description || 'Subscription',
    stripePaymentIntentId: intentId,
    invoiceUrl: invoice.hosted_invoice_url || null,
    createdAt: unixToIso(invoice.created) || new Date().toISOString(),
  });
}

async function subscriptionFromSession(session) {
  if (session?.subscription && typeof session.subscription === 'object') return session.subscription;
  if (session?.subscription) {
    return getStripe().subscriptions.retrieve(String(session.subscription));
  }
  return null;
}

export async function fulfillCheckoutSession(session) {
  if (!session || session.mode !== 'subscription') return null;
  if (session.payment_status === 'unpaid') return null;
  const stripeSub = await subscriptionFromSession(session);
  if (!stripeSub) return null;
  const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;
  return applyStripeSubscription(stripeSub, {
    userId: session.metadata?.userId || session.client_reference_id,
    customerId,
  });
}

export async function handleStripeEvent(event) {
  const type = event?.type;
  const object = event?.data?.object;
  switch (type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
      await fulfillCheckoutSession(object);
      return { ok: true, type };
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      await applyStripeSubscription(object);
      return { ok: true, type };
    case 'invoice.paid':
      await recordStripeInvoice(object);
      return { ok: true, type };
    case 'invoice.payment_failed': {
      const subId = typeof object?.subscription === 'string' ? object.subscription : object?.subscription?.id;
      if (subId) {
        const local = await getSubscriptionByStripeSubscription(subId);
        if (local) {
          await upsertSubscription({ ...local, status: 'past_due' });
        }
      }
      return { ok: true, type };
    }
    default:
      return { ok: true, ignored: true, type };
  }
}

export async function ensureStripeCustomer(user) {
  const stripe = getStripe();
  const existing = await getSubscription(user.id);
  if (existing?.stripeCustomerId) {
    try {
      const customer = await stripe.customers.retrieve(existing.stripeCustomerId);
      if (customer && !customer.deleted) return customer.id;
    } catch {
      /* create a replacement customer below */
    }
  }
  const country = isoCountry(user.country);
  const customer = await stripe.customers.create({
    email: user.email,
    name: user.name || undefined,
    metadata: { userId: user.id },
    address: country
      ? {
          line1: user.addressLine1 || undefined,
          line2: user.addressLine2 || undefined,
          city: user.city || undefined,
          postal_code: user.postalCode || undefined,
          country,
        }
      : undefined,
  });
  const sub = existing || (await ensureFreeSubscription(user.id));
  await upsertSubscription({
    ...sub,
    stripeCustomerId: customer.id,
  });
  return customer.id;
}

export async function createCheckoutSession({ user, planId }) {
  if (!PAID_PLAN_IDS.includes(planId)) {
    throw Object.assign(new Error('Choose Starter, Pro, or Agency.'), { status: 400 });
  }
  const price = priceIdForPlan(planId);
  if (!price) {
    throw Object.assign(new Error('That plan is not connected to Stripe yet.'), { status: 503, code: 'stripe_price_missing' });
  }
  const stripe = getStripe();
  const customerId = await ensureStripeCustomer(user);
  const base = publicAppBase();
  const tax = automaticTaxEnabled();
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    client_reference_id: user.id,
    success_url: `${base}/account?billing=success`,
    cancel_url: `${base}/pricing?billing=cancel`,
    line_items: [{ price, quantity: 1 }],
    metadata: { userId: user.id, planId },
    subscription_data: {
      metadata: { userId: user.id, planId },
    },
    customer_update: { address: 'auto', name: 'auto' },
    tax_id_collection: { enabled: true },
    automatic_tax: { enabled: tax },
    integration_identifier: integrationIdentifier(),
    allow_promotion_codes: true,
  });
  return session;
}

export async function createPortalSession({ user }) {
  const stripe = getStripe();
  const customerId = await ensureStripeCustomer(user);
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${publicAppBase()}/account`,
  });
  return session;
}

export function constructWebhookEvent(rawBody, signature) {
  const secret = stripeWebhookSecret();
  if (!secret) {
    throw Object.assign(new Error('Stripe webhook signing secret is not configured.'), {
      status: 503,
      code: 'stripe_webhook_unconfigured',
    });
  }
  return getStripe().webhooks.constructEvent(rawBody, signature, secret);
}

export { PAID_PLAN_IDS };
