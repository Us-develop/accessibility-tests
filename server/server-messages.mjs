/**
 * Messages the server sends, in the visitor's language.
 *
 * The server code keeps writing its messages in English. Just before a JSON
 * answer leaves, `localizeJsonMessages` looks the English `error` up in
 * i18n/server.en.mjs and replaces it with the text in the visitor's language.
 * The answer then also says which language the message is in (`errorLang`),
 * so the page can mark a message that is still English with lang="en".
 *
 * Only requests that carry the language cookie are translated: browsers get it
 * on their first page view (web/src/middleware.js). API calls without it keep
 * the English messages.
 */
import { DICTIONARY_PARTS, LANG_COOKIE, normalizeLang, t } from '../i18n/index.mjs';

const ENGLISH = DICTIONARY_PARTS.en.server;

/** Exact English text -> key. */
const EXACT = new Map();
/** Templates with {placeholders}, as patterns that capture the values. */
const PATTERNS = [];

for (const [key, text] of Object.entries(ENGLISH)) {
  const names = [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
  if (names.length === 0) {
    EXACT.set(text, key);
    continue;
  }
  const source = text
    .split(/\{\w+\}/)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('(.+?)');
  PATTERNS.push({ key, names, re: new RegExp(`^${source}$`) });
}

/**
 * @param {string} message English text as the server wrote it
 * @param {string} lang
 * @returns {{ text: string, lang: string }} the message, and the language it is in
 */
export function translateServerMessage(message, lang) {
  const target = normalizeLang(lang);
  const text = String(message ?? '');
  if (!target || target === 'en') return { text, lang: 'en' };
  const exact = EXACT.get(text);
  if (exact) return { text: t(target, exact), lang: target };
  for (const { key, names, re } of PATTERNS) {
    const match = text.match(re);
    if (match) {
      const vars = Object.fromEntries(names.map((name, i) => [name, match[i + 1]]));
      return { text: t(target, key, vars), lang: target };
    }
  }
  // Not in the dictionary (yet): send it as it is, marked as English.
  return { text, lang: 'en' };
}

/** The language the visitor chose or was given, or null when the request has no language cookie. */
export function requestLang(req) {
  const match = String(req?.headers?.cookie || '').match(new RegExp(`(?:^|;\\s*)${LANG_COOKIE}=([^;]*)`));
  return match ? normalizeLang(match[1]) : null;
}

/** Express middleware: translate `error` in JSON answers and say which language it is in. */
export function localizeJsonMessages(req, res, next) {
  const lang = requestLang(req);
  if (!lang) return next();
  const json = res.json.bind(res);
  res.json = (body) => {
    if (body && typeof body === 'object' && !Array.isArray(body) && typeof body.error === 'string') {
      const out = translateServerMessage(body.error, lang);
      return json({ ...body, error: out.text, errorLang: out.lang });
    }
    return json(body);
  };
  return next();
}
