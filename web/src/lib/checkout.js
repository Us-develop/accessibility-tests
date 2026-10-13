/**
 * Checkout from the pricing page and the account page. One module, so both
 * behave the same.
 *
 * Markup contract:
 *   <section data-checkout-scope>                    one card
 *     <input type="checkbox" class="checkout-waiver">   the withdrawal waiver, above the buttons
 *     <p class="checkout-msg" role="status"></p>      messages for this card
 *     <button class="pricing-checkout" data-kind="pack" data-pack="pack_50">
 *     <button class="pricing-checkout" data-kind="pro" data-interval="monthly">
 *   </section>
 *
 * A visitor who is not signed in is sent to sign up and comes back to
 * /pricing?checkout=<item>, where checkout starts by itself (resumeCheckout).
 * The waiver is a legal consent, so it is only carried over when this browser
 * recorded the tick itself (the wcag_checkout cookie): a link with
 * ?checkout= alone never counts as consent.
 */
import { fetchBalance } from './balance.js';

const api = (path) => (typeof globalThis.wcagApiUrl === 'function' ? globalThis.wcagApiUrl(path) : path);
const credentials = () =>
  typeof globalThis.wcagFetchCredentials === 'function' ? globalThis.wcagFetchCredentials() : 'same-origin';
const jsonHeaders = () =>
  typeof globalThis.wcagHeaders === 'function'
    ? globalThis.wcagHeaders({ 'Content-Type': 'application/json' })
    : { 'Content-Type': 'application/json' };

const INTENT_COOKIE = 'wcag_checkout';
const INTENT_MAX_AGE_SEC = 2 * 60 * 60;
const BASELINE_KEY = 'wcagCheckoutBaseline';

/** `pack_10`, `pack_50`, `pack_100`, `pro-monthly` or `pro-yearly`; anything else is null. */
export function parseCheckoutItem(value) {
  const item = String(value || '').trim();
  if (/^pack_(10|50|100)$/.test(item)) return { item, body: { kind: 'pack', packId: item } };
  if (item === 'pro-monthly' || item === 'pro-yearly') {
    return { item, body: { kind: 'pro', interval: item.slice(4) } };
  }
  return null;
}

/** The item a Buy or Subscribe button stands for. */
export function checkoutItemFromButton(btn) {
  const kind = btn.getAttribute('data-kind');
  if (kind === 'pro') return parseCheckoutItem(`pro-${btn.getAttribute('data-interval') || 'monthly'}`);
  return parseCheckoutItem(btn.getAttribute('data-pack'));
}

/** Where to send someone who must sign up first, so they come back to this item. */
export function signupHrefForItem(item) {
  return `/signup?next=${encodeURIComponent(`/pricing?checkout=${item}`)}`;
}

function rememberIntent(item) {
  document.cookie = `${INTENT_COOKIE}=${encodeURIComponent(item)}; Path=/; Max-Age=${INTENT_MAX_AGE_SEC}; SameSite=Lax`;
}

function readIntent() {
  const match = document.cookie.match(/(?:^|; )wcag_checkout=([^;]*)/);
  try {
    return match ? decodeURIComponent(match[1]) : '';
  } catch {
    return '';
  }
}

function clearIntent() {
  document.cookie = `${INTENT_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
}

function scopeOf(el) {
  return el.closest('[data-checkout-scope]') || document;
}

function showMessage(scope, text, isError = false) {
  const msg = scope.querySelector('.checkout-msg');
  if (!msg) return;
  msg.textContent = text || '';
  msg.setAttribute('role', isError ? 'alert' : 'status');
}

async function saveBaseline() {
  const balance = await fetchBalance();
  if (!balance) return;
  try {
    localStorage.setItem(BASELINE_KEY, JSON.stringify({ tokens: balance.tokens, pro: balance.pro, at: Date.now() }));
  } catch {
    /* storage may be unavailable; the success page then just shows the current balance */
  }
}

/**
 * Start Stripe Checkout for a button's item.
 * @param {HTMLButtonElement} btn
 */
export async function startCheckout(btn) {
  const scope = scopeOf(btn);
  const parsed = checkoutItemFromButton(btn);
  if (!parsed) {
    showMessage(scope, 'Could not start checkout.', true);
    return;
  }
  const waiver = scope.querySelector('.checkout-waiver');
  if (!(waiver instanceof HTMLInputElement) || !waiver.checked) {
    showMessage(scope, 'Tick the box above first: it is needed before we can take payment.', true);
    waiver?.setAttribute('aria-invalid', 'true');
    waiver?.focus?.();
    return;
  }
  waiver.removeAttribute('aria-invalid');
  btn.disabled = true;
  showMessage(scope, 'Starting checkout…');
  try {
    const auth = await fetch(api('/api/auth/status'), { credentials: credentials() })
      .then((r) => r.json())
      .catch(() => ({}));
    if (auth.authenticated !== true || auth.role !== 'customer') {
      // Remember that the box was ticked for this item, then sign up and come back.
      rememberIntent(parsed.item);
      window.location.href = signupHrefForItem(parsed.item);
      return;
    }
    await saveBaseline();
    const res = await fetch(api('/api/billing/checkout'), {
      method: 'POST',
      credentials: credentials(),
      headers: jsonHeaders(),
      body: JSON.stringify({ ...parsed.body, withdrawalWaiver: true }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.url) {
      clearIntent();
      window.location.href = data.url;
      return;
    }
    showMessage(scope, data.error || 'Could not start checkout.', true);
  } catch {
    showMessage(scope, 'Could not start checkout. Check your connection and try again.', true);
  } finally {
    if (btn.isConnected) btn.disabled = false;
  }
}

/**
 * On /pricing?checkout=<item>: continue the purchase the visitor began before
 * signing up. Starts checkout by itself only when this browser recorded their
 * tick for the same item; otherwise it brings them to the right card and asks
 * for the tick.
 */
export async function resumeCheckout() {
  const url = new URL(window.location.href);
  const parsed = parseCheckoutItem(url.searchParams.get('checkout'));
  if (!parsed) return;
  url.searchParams.delete('checkout');
  history.replaceState(history.state, '', url.pathname + url.search + url.hash);

  const selector =
    parsed.body.kind === 'pro'
      ? `.pricing-checkout[data-kind="pro"][data-interval="${parsed.body.interval}"]`
      : `.pricing-checkout[data-pack="${parsed.body.packId}"]`;
  const btn = document.querySelector(selector);
  if (!(btn instanceof HTMLButtonElement)) return;
  const scope = scopeOf(btn);
  const waiver = scope.querySelector('.checkout-waiver');

  const auth = await fetch(api('/api/auth/status'), { credentials: credentials() })
    .then((r) => r.json())
    .catch(() => ({}));
  const signedIn = auth.authenticated === true && auth.role === 'customer';
  const consented = readIntent() === parsed.item;

  if (signedIn && consented && waiver instanceof HTMLInputElement) {
    waiver.checked = true;
    showMessage(scope, 'Welcome back. Taking you to payment…');
    await startCheckout(btn);
    return;
  }
  // No recorded tick (or not signed in): show the card and let them decide.
  if (scope instanceof HTMLElement) scope.scrollIntoView({ block: 'center' });
  showMessage(scope, signedIn ? 'Tick the box above, then choose your option again to continue to payment.' : '');
  (waiver instanceof HTMLElement ? waiver : btn).focus();
}

/** Bind Buy / Subscribe clicks once per page lifetime (survives view transitions). */
export function bindCheckout() {
  if (globalThis.__wcagBillingCheckoutBound) return;
  globalThis.__wcagBillingCheckoutBound = true;
  document.addEventListener(
    'click',
    (event) => {
      const target = event.target instanceof Element ? event.target : event.target?.parentElement;
      const btn = target?.closest?.('.pricing-checkout, .token-buy');
      if (!(btn instanceof HTMLButtonElement)) return;
      event.preventDefault();
      startCheckout(btn);
    },
    true
  );
}

/**
 * After returning from Stripe (/account?billing=success): the webhook that
 * grants tokens or Pro can land a moment after the redirect, so poll the
 * balance until it differs from what it was before checkout.
 *
 * @param {(state: { balance: import('./balance.js').Balance | null, settled: boolean, timedOut: boolean }) => void} onUpdate
 * @param {{ attempts?: number, everyMs?: number }} [opts]
 */
export async function watchPaymentLanding(onUpdate, { attempts = 20, everyMs = 3000 } = {}) {
  let baseline = null;
  try {
    baseline = JSON.parse(localStorage.getItem(BASELINE_KEY) || 'null');
    if (baseline && Date.now() - Number(baseline.at || 0) > 2 * 60 * 60 * 1000) baseline = null;
  } catch {
    baseline = null;
  }
  for (let i = 0; i < attempts; i += 1) {
    const balance = await fetchBalance();
    const changed = balance && (!baseline || balance.tokens > baseline.tokens || (balance.pro && !baseline.pro));
    if (changed) {
      try {
        localStorage.removeItem(BASELINE_KEY);
      } catch {
        /* ignore */
      }
      onUpdate({ balance, settled: true, timedOut: false });
      return;
    }
    onUpdate({ balance, settled: false, timedOut: false });
    await new Promise((resolve) => setTimeout(resolve, everyMs));
  }
  onUpdate({ balance: await fetchBalance(), settled: false, timedOut: true });
}
