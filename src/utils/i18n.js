/**
 * Minimal i18n: locale strings live in /locales/<lang>.json.
 * Only languages in SUPPORTED are ever read from disk, so a user-supplied
 * ?lang= value can never be used to build an arbitrary file path.
 */
const fs = require('fs/promises');
const path = require('path');

const LOCALES_DIR = path.join(__dirname, '..', '..', 'locales');
const SUPPORTED = ['en', 'fr'];
const DEFAULT_LANG = 'en';
const cache = new Map();

/** Pick a supported language from a query value; anything else (or an array) falls back to English. */
function resolveLang(value) {
  const lang = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return SUPPORTED.includes(lang) ? lang : DEFAULT_LANG;
}

async function loadLocale(lang) {
  const safe = resolveLang(lang);
  if (!cache.has(safe)) {
    const raw = await fs.readFile(path.join(LOCALES_DIR, `${safe}.json`), 'utf8');
    cache.set(safe, JSON.parse(raw));
  }
  return { lang: safe, strings: cache.get(safe) };
}

/** Today's date formatted for the locale, e.g. "Sunday 22 November 2026" / "dimanche 22 novembre 2026". */
function formatToday(locale, now = new Date()) {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'full' }).format(now);
}

module.exports = { SUPPORTED, DEFAULT_LANG, resolveLang, loadLocale, formatToday };
