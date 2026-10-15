/**
 * Translations: Dutch is the primary language, English the second.
 *
 * One module for the Astro pages, the Svelte components, the browser scripts and
 * the Express server, so a text exists in one place.
 *
 *   import { t } from '<root>/i18n/index.mjs';
 *   t(lang, 'header.startScan')                    -> "Nieuwe scan starten"
 *   t(lang, 'balance.tokensLeft', { n: 3 })        -> "3 tokens over"
 *   tn(lang, 'balance.tokens', 1)                  -> "1 token"   (picks .one / .other)
 *
 * Rules:
 * - Keys are `area.name`. Every key exists in both languages with the same
 *   {placeholders}; tests/i18n.test.js checks that.
 * - Dutch addresses the reader as "u".
 * - A page says <html lang="nl"> only when everything on it is translated. A
 *   part that is still English carries lang="en" itself.
 *
 * The language comes from the `wcag_lang` cookie; without one it is the default.
 */
import nlApp from './nl.mjs';
import enApp from './en.mjs';
import nlReport from './report.nl.mjs';
import enReport from './report.en.mjs';
import nlServer from './server.nl.mjs';
import enServer from './server.en.mjs';

/**
 * Each language is split by area so a reviewer can read one part at a time:
 * `nl.mjs` / `en.mjs` for the site and account, `report.*.mjs` for the report
 * pages, `server.*.mjs` for messages the server sends. A key lives in exactly
 * one file (tests/i18n.test.js checks that).
 */
export const DICTIONARY_PARTS = Object.freeze({
  nl: Object.freeze({ app: nlApp, report: nlReport, server: nlServer }),
  en: Object.freeze({ app: enApp, report: enReport, server: enServer }),
});
const nl = { ...nlApp, ...nlReport, ...nlServer };
const en = { ...enApp, ...enReport, ...enServer };

export const LANGS = Object.freeze(['nl', 'en']);
export const LANG_COOKIE = 'wcag_lang';
export const LANG_COOKIE_MAX_AGE_SEC = 365 * 24 * 60 * 60;

const DICTIONARIES = { nl, en };

/** `nl`, `en`, or null for anything else. */
export function normalizeLang(value) {
  const lang = String(value || '').trim().toLowerCase().slice(0, 2);
  return LANGS.includes(lang) ? lang : null;
}

/**
 * Language for visitors who have not chosen one. Dutch, unless the server sets
 * WCAG_DEFAULT_LANG=en (useful while a translation is still being reviewed).
 */
export function defaultLang() {
  const fromEnv = typeof process !== 'undefined' ? normalizeLang(process.env?.WCAG_DEFAULT_LANG) : null;
  return fromEnv || 'nl';
}

/** Language chosen in a Cookie header, or the default. */
export function langFromCookieHeader(header) {
  const match = String(header || '').match(/(?:^|;\s*)wcag_lang=([^;]*)/);
  return (match && normalizeLang(match[1])) || defaultLang();
}

/** In the browser: the language of the page being shown. */
export function pageLang() {
  if (typeof document === 'undefined') return defaultLang();
  return normalizeLang(document.documentElement.lang) || defaultLang();
}

function fill(template, vars) {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name) => (vars[name] == null ? whole : String(vars[name])));
}

/**
 * Translate a key. Falls back to English, then to the key itself, so a missing
 * text is visible in the page instead of breaking it.
 */
export function t(lang, key, vars) {
  const dict = DICTIONARIES[normalizeLang(lang) || defaultLang()];
  const template = dict[key] ?? en[key] ?? key;
  return fill(template, vars);
}

/** Plural form: uses `key.one` when n is 1, otherwise `key.other`. `{n}` is filled in. */
export function tn(lang, key, n, vars) {
  return t(lang, `${key}.${Number(n) === 1 ? 'one' : 'other'}`, { n, ...vars });
}

/** A `t` bound to one language, for templates: `const tr = translator(lang)`. */
export function translator(lang) {
  const fixed = normalizeLang(lang) || defaultLang();
  const tr = (key, vars) => t(fixed, key, vars);
  tr.n = (key, n, vars) => tn(fixed, key, n, vars);
  tr.lang = fixed;
  return tr;
}

/**
 * Language of the `error` in a server answer. The server says which language it
 * wrote it in (`errorLang`, see server/server-messages.mjs); without that it is English.
 */
export function serverMessageLang(data) {
  return normalizeLang(data?.errorLang) || 'en';
}

/** Locale for dates and numbers. */
export function dateLocale(lang) {
  return normalizeLang(lang) === 'en' ? 'en-GB' : 'nl-BE';
}

/** Set-Cookie value that remembers the chosen language. */
export function langSetCookie(lang, { secure = false } = {}) {
  const value = normalizeLang(lang) || defaultLang();
  return `${LANG_COOKIE}=${value}; Path=/; Max-Age=${LANG_COOKIE_MAX_AGE_SEC}; SameSite=Lax${secure ? '; Secure' : ''}`;
}

/** Every key of a dictionary, for tests. */
export function dictionary(lang) {
  return DICTIONARIES[lang];
}
