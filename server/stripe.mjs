import { randomBytes } from 'crypto';
import Stripe from 'stripe';
import {
  ensureCustomerSubscription,
  findPaymentByStripeIntent,
  getSubscription,
  getSubscriptionByStripeCustomer,
  getSubscriptionByStripeSubscription,
  insertPayment,
  upsertSubscription,
  updatePaymentInvoiceUrl,
} from './billing.mjs';
import {
  NONE_PLAN_ID,
  PRO_PLAN_ID,
  TOKEN_PACKS,
  tokenPackById,
} from './plan-catalog.mjs';
import { clawbackTokensForPaymentIntent, findTokenLotByCheckoutSession, grantTokenPack } from './tokens.mjs';
import { companyInvoiceFooter } from './company.mjs';
import { mergeConsentContext } from './consents.mjs';
import { WITHDRAWAL_WAIVER_TEXT } from './legal-versions.mjs';

const STRIPE_API_VERSION = '2026-08-26.dahlia';

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

export function warnStripeTaxCodeIfUnset() {
  if (String(process.env.STRIPE_TAX_CODE || '').trim()) return;
  console.warn('[stripe] STRIPE_TAX_CODE is unset; products may lack a tax code until it is set.');
}

export function priceIdForPack(packId) {
  const pack = tokenPackById(packId);
  if (!pack) return '';
  return String(process.env[pack.envName] || '').trim();
}

export function priceIdForPro(interval) {
  if (interval === 'year' || interval === 'yearly') {
    return String(process.env.STRIPE_PRICE_PRO_YEARLY || '').trim();
  }
  return String(process.env.STRIPE_PRICE_PRO_MONTHLY || '').trim();
}

export function packIdFromPrice(priceId) {
  const needle = String(priceId || '').trim();
  if (!needle) return null;
  return TOKEN_PACKS.find((pack) => priceIdForPack(pack.id) === needle)?.id || null;
}

export function proIntervalFromPrice(priceId) {
  const needle = String(priceId || '').trim();
  if (!needle) return null;
  if (priceIdForPro('monthly') && needle === priceIdForPro('monthly')) return 'monthly';
  if (priceIdForPro('yearly') && needle === priceIdForPro('yearly')) return 'yearly';
  return null;
}

export function integrationIdentifier(prefix = 'wcag-pay') {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz';
  const bytes = randomBytes(8);
  let suffix = '';
  for (const byte of bytes) suffix += alphabet[byte % 26];
  return `${prefix}-${suffix}`;
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

/** Test helper: inject a stub client. Pass null to reset. */
export function setStripeClientForTests(client) {
  cachedClient = client || null;
  cachedKey = client ? stripeSecretKey() || '__test__' : '';
}

export async function billingPublicConfig() {
  return {
    configured: stripeConfigured(),
    automaticTax: automaticTaxEnabled(),
    currency: 'eur',
    servicesUrl: 'https://about-us.be/contact/',
    packs: TOKEN_PACKS.map((pack) => ({
      id: pack.id,
      name: pack.name,
      tokens: pack.tokens,
      priceCents: pack.priceCents,
      checkoutReady: Boolean(stripeConfigured() && priceIdForPack(pack.id)),
    })),
    pro: {
      id: PRO_PLAN_ID,
      name: 'Pro',
      monthlyPriceCents: 4900,
      yearlyPriceCents: 49000,
      maxPagesPerScan: 50,
      maxPagesPerMonth: 300,
      checkoutReadyMonthly: Boolean(stripeConfigured() && priceIdForPro('monthly')),
      checkoutReadyYearly: Boolean(stripeConfigured() && priceIdForPro('yearly')),
    },
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
      return 'incomplete';
    case 'paused':
      return 'paused';
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
  const interval = proIntervalFromPrice(typeof priceId === 'string' ? priceId : '') ||
    (stripeSub.items?.data?.[0]?.price?.recurring?.interval === 'year' ? 'yearly' : 'monthly');
  const canceled =
    stripeSub.status === 'canceled' ||
    stripeSub.status === 'unpaid' ||
    stripeSub.status === 'incomplete_expired';
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
  const existing = (await getSubscription(userId)) || (await ensureCustomerSubscription(userId));
  const period = periodFromStripeSubscription(stripeSub);
  return upsertSubscription({
    id: existing.id,
    userId,
    planId: canceled ? NONE_PLAN_ID : PRO_PLAN_ID,
    status: canceled ? 'canceled' : localStatusFromStripe(stripeSub.status),
    currentPeriodStart: period.start || existing.currentPeriodStart,
    currentPeriodEnd: period.end || existing.currentPeriodEnd,
    cancelAtPeriodEnd: Boolean(stripeSub.cancel_at_period_end),
    billingInterval: canceled ? existing.billingInterval : interval,
    stripeSubscriptionId: canceled ? existing.stripeSubscriptionId : stripeSub.id,
    stripeCustomerId: customer || existing.stripeCustomerId,
    createdAt: existing.createdAt,
  });
}

export async function recordStripeInvoice(invoice) {
  if (!invoice) return null;
  const amount = Number(invoice.amount_paid || 0);
  const invoiceUrl = invoice.hosted_invoice_url || null;
  const intentId =
    typeof invoice.payment_intent === 'string'
      ? invoice.payment_intent
      : invoice.payment_intent?.id || invoice.id;
  const existing = intentId ? await findPaymentByStripeIntent(intentId) : null;
  if (existing) {
    if (invoiceUrl && !existing.invoiceUrl) {
      return (await updatePaymentInvoiceUrl(intentId, invoiceUrl)) || existing;
    }
    return existing;
  }
  if (amount <= 0) return null;
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
    description: invoice.lines?.data?.[0]?.description || 'Us accessibility',
    stripePaymentIntentId: intentId,
    invoiceUrl,
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

async function invoiceUrlFromSession(session) {
  if (!session) return null;
  if (session.invoice && typeof session.invoice === 'object') {
    return session.invoice.hosted_invoice_url || null;
  }
  if (session.invoice) {
    try {
      const invoice = await getStripe().invoices.retrieve(String(session.invoice));
      return invoice?.hosted_invoice_url || null;
    } catch {
      return null;
    }
  }
  return null;
}

async function storeStripeConsentFromSession(session) {
  const consentId = session?.metadata?.consentId;
  if (!consentId || !session.consent) return;
  await mergeConsentContext(consentId, { stripeConsent: session.consent, checkoutSessionId: session.id });
}

export async function fulfillPaymentSession(session) {
  if (!session || session.mode !== 'payment') return null;
  if (session.payment_status === 'unpaid') return null;
  const sessionId = session.id;
  if (sessionId) {
    const existing = await findTokenLotByCheckoutSession(sessionId);
    if (existing) {
      await storeStripeConsentFromSession(session);
      return existing;
    }
  }
  const packId = session.metadata?.packId || packIdFromPrice(session.metadata?.priceId);
  const pack = tokenPackById(packId);
  const tokens = Number(session.metadata?.tokens || pack?.tokens || 0);
  const userId = session.metadata?.userId || session.client_reference_id;
  if (!userId || tokens <= 0) return null;
  const intentId =
    typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id || null;
  const lot = await grantTokenPack({
    userId,
    packId: pack?.id || packId,
    tokens,
    stripeCheckoutSessionId: sessionId,
    stripePaymentIntentId: intentId,
    purchasedAt: unixToIso(session.created) || new Date().toISOString(),
  });
  const invoiceUrl = await invoiceUrlFromSession(session);
  if (intentId) {
    const already = await findPaymentByStripeIntent(intentId);
    if (!already) {
      await insertPayment({
        id: randomBytes(10).toString('hex'),
        userId,
        amountCents: Number(session.amount_total || pack?.priceCents || 0),
        currency: String(session.currency || 'eur').toLowerCase(),
        status: 'paid',
        description: pack?.name || 'Token pack',
        stripePaymentIntentId: intentId,
        invoiceUrl,
        createdAt: unixToIso(session.created) || new Date().toISOString(),
      });
    } else if (invoiceUrl && !already.invoiceUrl) {
      await updatePaymentInvoiceUrl(intentId, invoiceUrl);
    }
  }
  await storeStripeConsentFromSession(session);
  return lot;
}

export async function fulfillCheckoutSession(session) {
  if (!session) return null;
  if (session.payment_status === 'unpaid') return null;
  if (session.mode === 'payment') return fulfillPaymentSession(session);
  if (session.mode !== 'subscription') return null;
  const stripeSub = await subscriptionFromSession(session);
  if (!stripeSub) return null;
  const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;
  const result = await applyStripeSubscription(stripeSub, {
    userId: session.metadata?.userId || session.client_reference_id,
    customerId,
  });
  await storeStripeConsentFromSession(session);
  return result;
}

function paymentIntentIdFromCharge(charge) {
  if (!charge) return null;
  if (typeof charge.payment_intent === 'string') return charge.payment_intent;
  return charge.payment_intent?.id || null;
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
    case 'charge.refunded':
    case 'charge.refund.updated': {
      const intentId = paymentIntentIdFromCharge(object);
      if (intentId) await clawbackTokensForPaymentIntent(intentId);
      return { ok: true, type };
    }
    default:
      return { ok: true, ignored: true, type };
  }
}

async function attachEuVatIfPresent(stripe, customerId, user) {
  const vat = String(user?.vatNumber || '').trim().toUpperCase();
  if (!vat || !customerId || typeof stripe.customers?.createTaxId !== 'function') return;
  try {
    await stripe.customers.createTaxId(customerId, { type: 'eu_vat', value: vat });
  } catch (err) {
    const code = String(err?.code || err?.raw?.code || '');
    if (code === 'resource_already_exists' || code === 'tax_id_already_exists') return;
    console.warn('[stripe] createTaxId failed:', err?.message || err);
  }
}

export async function ensureStripeCustomer(user) {
  const stripe = getStripe();
  const existing = await getSubscription(user.id);
  if (existing?.stripeCustomerId) {
    try {
      const customer = await stripe.customers.retrieve(existing.stripeCustomerId);
      if (customer && !customer.deleted) {
        await attachEuVatIfPresent(stripe, customer.id, user);
        return customer.id;
      }
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
  const sub = existing || (await ensureCustomerSubscription(user.id));
  await upsertSubscription({
    ...sub,
    stripeCustomerId: customer.id,
  });
  await attachEuVatIfPresent(stripe, customer.id, user);
  return customer.id;
}

function checkoutTaxFields() {
  const tax = automaticTaxEnabled();
  return {
    customer_update: { address: 'auto', name: 'auto' },
    tax_id_collection: { enabled: true },
    automatic_tax: { enabled: tax },
    consent_collection: { terms_of_service: 'required' },
    custom_text: {
      terms_of_service_acceptance: { message: WITHDRAWAL_WAIVER_TEXT },
    },
  };
}

function assertAutomaticTaxForCheckout() {
  if (process.env.NODE_ENV === 'production' && !automaticTaxEnabled()) {
    throw Object.assign(new Error('Stripe Tax must be enabled in production before checkout.'), {
      status: 503,
      code: 'stripe_tax_disabled',
    });
  }
}

export async function createCheckoutSession({ user, kind, packId, interval, consentId } = {}) {
  assertAutomaticTaxForCheckout();
  const stripe = getStripe();
  const customerId = await ensureStripeCustomer(user);
  const base = publicAppBase();
  const modeKind = String(kind || '').trim().toLowerCase();
  const consentMeta = consentId ? { consentId: String(consentId) } : {};

  if (modeKind === 'pack') {
    const pack = tokenPackById(packId);
    if (!pack) {
      throw Object.assign(new Error('Choose a token pack of 10, 50, or 100.'), { status: 400 });
    }
    const price = priceIdForPack(pack.id);
    if (!price) {
      throw Object.assign(new Error('That token pack is not connected to Stripe yet.'), {
        status: 503,
        code: 'stripe_price_missing',
      });
    }
    const footer = companyInvoiceFooter();
    return stripe.checkout.sessions.create({
      mode: 'payment',
      customer: customerId,
      client_reference_id: user.id,
      success_url: `${base}/account?billing=success`,
      cancel_url: `${base}/pricing?billing=cancel`,
      line_items: [{ price, quantity: 1 }],
      metadata: { userId: user.id, packId: pack.id, tokens: String(pack.tokens), ...consentMeta },
      integration_identifier: integrationIdentifier('wcag-pack'),
      allow_promotion_codes: true,
      invoice_creation: footer
        ? { enabled: true, invoice_data: { footer } }
        : { enabled: true },
      ...checkoutTaxFields(),
    });
  }

  if (modeKind !== 'pro' && modeKind !== 'subscription') {
    throw Object.assign(new Error('Choose Pro or a token pack.'), { status: 400 });
  }
  const billingInterval = interval === 'yearly' || interval === 'year' ? 'yearly' : 'monthly';
  const price = priceIdForPro(billingInterval);
  if (!price) {
    throw Object.assign(new Error('Pro is not connected to Stripe yet.'), {
      status: 503,
      code: 'stripe_price_missing',
    });
  }
  return stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    client_reference_id: user.id,
    success_url: `${base}/account?billing=success`,
    cancel_url: `${base}/pricing?billing=cancel`,
    line_items: [{ price, quantity: 1 }],
    metadata: {
      userId: user.id,
      planId: PRO_PLAN_ID,
      interval: billingInterval,
      ...consentMeta,
    },
    subscription_data: {
      metadata: { userId: user.id, planId: PRO_PLAN_ID, interval: billingInterval },
    },
    integration_identifier: integrationIdentifier('wcag-pro'),
    allow_promotion_codes: true,
    ...checkoutTaxFields(),
  });
}

export async function createPortalSession({ user }) {
  const stripe = getStripe();
  const customerId = await ensureStripeCustomer(user);
  return stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${publicAppBase()}/account?billing=portal`,
  });
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
