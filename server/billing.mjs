import { createHmac, timingSafeEqual } from 'crypto';
import { countFoundingSubscribers, getUserByEmail, getUserById, hasActiveSubscription, updateUser } from './users.mjs';
import { attachRunToUser } from './projects.mjs';
import { isValidGuestToken, readGuestTokenRecord } from './guest.mjs';

const FOUNDING_LIMIT = 50;

function stripeKey() {
  return String(process.env.STRIPE_SECRET_KEY || '').trim();
}

export function stripeConfigured() {
  return Boolean(stripeKey() && (process.env.STRIPE_PRICE_MONTHLY || process.env.STRIPE_PRICE_YEARLY));
}

export function pricingPublic() {
  return {
    monthly: 49,
    yearly: 490,
    foundingMonthly: 39,
    foundingRemaining: Math.max(0, FOUNDING_LIMIT - countFoundingSubscribers()),
    currency: 'EUR',
    pageCredits: Number(process.env.PAGE_CREDITS_PER_MONTH || 300),
    maxUrlsPerRun: Number(process.env.CUSTOMER_MAX_URLS_PER_RUN || 50),
    configured: stripeConfigured(),
  };
}

async function stripeForm(path, params, method = 'POST') {
  const key = stripeKey();
  if (!key) {
    throw Object.assign(new Error('Stripe is not configured.'), { status: 503 });
  }
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: method === 'GET' ? undefined : new URLSearchParams(params),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = data?.error?.message || 'Stripe request failed.';
    throw Object.assign(new Error(message), { status: res.status >= 400 && res.status < 500 ? 400 : 502 });
  }
  return data;
}

function publicBase() {
  return String(process.env.PUBLIC_BASE_URL || '').trim().replace(/\/$/, '') || 'http://localhost:3456';
}

function priceId(interval, founding) {
  if (founding && process.env.STRIPE_PRICE_FOUNDING_MONTHLY) {
    return String(process.env.STRIPE_PRICE_FOUNDING_MONTHLY).trim();
  }
  if (interval === 'year') return String(process.env.STRIPE_PRICE_YEARLY || '').trim();
  return String(process.env.STRIPE_PRICE_MONTHLY || '').trim();
}

export async function createCheckoutSession({ user, interval, guestToken }) {
  if (hasActiveSubscription(user)) {
    throw Object.assign(new Error('You already have an active subscription. Manage it in Account.'), { status: 400 });
  }
  const founding = interval !== 'year' && countFoundingSubscribers() < FOUNDING_LIMIT;
  const price = priceId(interval, founding);
  if (!price) {
    throw Object.assign(new Error('Stripe prices are not configured. Set STRIPE_PRICE_MONTHLY.'), { status: 503 });
  }
  let customerId = user.stripeCustomerId;
  if (!customerId) {
    const customer = await stripeForm('customers', {
      email: user.email,
      name: user.name || user.email,
      'metadata[userId]': user.id,
    });
    customerId = customer.id;
    updateUser(user.id, { stripeCustomerId: customerId });
  }
  const session = await stripeForm('checkout/sessions', {
    mode: 'subscription',
    customer: customerId,
    'line_items[0][price]': price,
    'line_items[0][quantity]': '1',
    success_url: `${publicBase()}/account?checkout=success`,
    cancel_url: `${publicBase()}/pricing?checkout=cancel`,
    client_reference_id: user.id,
    'metadata[userId]': user.id,
    'metadata[guestToken]': guestToken || '',
    'metadata[founding]': founding ? '1' : '0',
    'subscription_data[metadata][userId]': user.id,
    'automatic_tax[enabled]': process.env.STRIPE_AUTOMATIC_TAX === 'false' ? 'false' : 'true',
    'tax_id_collection[enabled]': 'true',
    'consent_collection[terms_of_service]': 'required',
    'custom_text[submit][message]':
      'By starting the subscription you agree that the service begins immediately. You can cancel in Account.',
  });
  return session;
}

export async function createPortalSession(user) {
  if (!user.stripeCustomerId) {
    throw Object.assign(new Error('No billing customer yet. Subscribe first.'), { status: 400 });
  }
  return stripeForm('billing_portal/sessions', {
    customer: user.stripeCustomerId,
    return_url: `${publicBase()}/account`,
  });
}

export function verifyStripeSignature(rawBody, header) {
  const secret = String(process.env.STRIPE_WEBHOOK_SECRET || '').trim();
  if (!secret) return true;
  const parts = String(header || '')
    .split(',')
    .map((p) => p.trim());
  const ts = parts.find((p) => p.startsWith('t='))?.slice(2);
  const v1 = parts.find((p) => p.startsWith('v1='))?.slice(3);
  if (!ts || !v1) return false;
  const signed = `${ts}.${rawBody}`;
  const expected = createHmac('sha256', secret).update(signed).digest('hex');
  const a = Buffer.from(v1);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function applySubscriptionToUser(userId, subscription, extra = {}) {
  if (!userId) return;
  const status = String(subscription?.status || extra.status || 'active');
  updateUser(userId, {
    stripeSubscriptionId: subscription?.id || extra.subscriptionId || null,
    stripeCustomerId: subscription?.customer || extra.customerId || undefined,
    subscriptionStatus: status === 'active' || status === 'trialing' ? 'active' : status,
    foundingPrice: extra.founding ? true : undefined,
  });
}

async function attachGuestIfPresent(userId, guestToken) {
  if (!userId || !isValidGuestToken(guestToken)) return;
  const binding = readGuestTokenRecord(guestToken);
  if (!binding?.domain || !binding?.runId) return;
  attachRunToUser(userId, binding.domain, binding.runId);
}

export async function handleStripeWebhook(event) {
  const type = event?.type;
  const obj = event?.data?.object || {};
  if (type === 'checkout.session.completed') {
    const userId = obj.client_reference_id || obj.metadata?.userId;
    const user = userId ? getUserById(userId) : getUserByEmail(obj.customer_details?.email);
    if (!user) return;
    applySubscriptionToUser(user.id, { id: obj.subscription, customer: obj.customer, status: 'active' }, {
      founding: obj.metadata?.founding === '1',
      customerId: obj.customer,
      subscriptionId: obj.subscription,
    });
    await attachGuestIfPresent(user.id, obj.metadata?.guestToken);
    return;
  }
  if (type === 'invoice.paid') {
    const userId = obj.subscription_details?.metadata?.userId || obj.metadata?.userId;
    const user = userId ? getUserById(userId) : null;
    if (user) applySubscriptionToUser(user.id, { id: obj.subscription, customer: obj.customer, status: 'active' });
    return;
  }
  if (type === 'customer.subscription.deleted' || type === 'customer.subscription.updated') {
    const userId = obj.metadata?.userId;
    let user = userId ? getUserById(userId) : null;
    if (!user && obj.customer) {
      /* ignore */
    }
    if (user) {
      applySubscriptionToUser(user.id, obj, { customerId: obj.customer, subscriptionId: obj.id });
    }
  }
}
