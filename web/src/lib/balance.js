/**
 * What a signed-in customer has left to scan with: tokens, and for Pro the
 * pages left this month. One place for the header, the homepage, the account
 * page and the report, so they always say the same thing.
 *
 * Runs in the browser. The numbers come from GET /api/account/usage.
 */

import { pageLang, t, tn } from '../../../i18n/index.mjs';

function apiUrl(path) {
  return typeof globalThis.wcagApiUrl === 'function' ? globalThis.wcagApiUrl(path) : path;
}

function credentials() {
  return typeof globalThis.wcagFetchCredentials === 'function' ? globalThis.wcagFetchCredentials() : 'same-origin';
}

function headers() {
  return typeof globalThis.wcagHeaders === 'function' ? globalThis.wcagHeaders() : {};
}

/**
 * @typedef {{ pro: boolean, tokens: number, pagesUsed: number, pagesPerMonth: number, pagesLeft: number }} Balance
 */

/** @param {any} data response of /api/account/usage */
export function balanceFromUsage(data) {
  const pro = data?.pro === true;
  const pagesPerMonth = Number(data?.pagesPerMonth || 0);
  const pagesUsed = Number(data?.pagesScanned || 0);
  return {
    pro,
    tokens: Number(data?.tokens?.tokens || 0),
    pagesUsed,
    pagesPerMonth,
    pagesLeft: pro ? Math.max(0, pagesPerMonth - pagesUsed) : 0,
  };
}

/**
 * The customer's balance, or null for a guest, for staff, or when it cannot be read.
 * @returns {Promise<Balance | null>}
 */
export async function fetchBalance() {
  try {
    const res = await fetch(apiUrl('/api/account/usage'), { credentials: credentials(), headers: headers() });
    if (!res.ok) return null;
    return balanceFromUsage(await res.json());
  } catch {
    return null;
  }
}

/** Short form for tight places, e.g. "12 tokens · 240 Pro pages". Language of the page unless given. */
export function balanceShort(balance, lang = pageLang()) {
  if (!balance) return '';
  const tokens = tn(lang, 'balance.tokens', balance.tokens);
  return balance.pro ? `${tokens} · ${tn(lang, 'balance.proPages', balance.pagesLeft)}` : tokens;
}

/** Full sentence for screen readers and wider places. */
export function balanceLong(balance, lang = pageLang()) {
  if (!balance) return '';
  const tokens = tn(lang, 'balance.tokensLeft', balance.tokens);
  if (!balance.pro) return tokens;
  return `${t(lang, 'balance.proLeft', { left: balance.pagesLeft, total: balance.pagesPerMonth })} · ${tokens}`;
}

/** Nothing left to scan with. */
export function balanceEmpty(balance) {
  return Boolean(balance) && balance.tokens === 0 && (!balance.pro || balance.pagesLeft === 0);
}

/**
 * Tell every balance display on the page to refresh, after something changed
 * it (a scan started, a payment landed).
 */
export function announceBalanceChanged() {
  document.dispatchEvent(new CustomEvent('wcag:balance-changed'));
}
