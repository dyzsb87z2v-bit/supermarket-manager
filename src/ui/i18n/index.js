// One lookup function (t) and one missing-key policy:
//  - dev hosts (localhost) : visible marker + console.error, so tests and developers see the gap
//  - production            : fall back along the registry chain to German, console.warn once
// No call site may pass a literal fallback.
import { LOCALES, SOURCE_LOCALE, localeByCode } from '../../core/locales.js';
import { pluralCategory, setFormatLocale } from '../../core/format.js';
import { pseudoize } from './pseudo.js';

const packs = new Map();
let current = SOURCE_LOCALE;
const reported = new Set();

const isDevHost = () => {
  try {
    return ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) || /[?&]debug=1/.test(location.search);
  } catch { return false; }
};

async function loadPack(code) {
  if (packs.has(code)) return packs.get(code);
  let pack;
  if (code === 'en-XA') pack = pseudoize((await loadPack(SOURCE_LOCALE)));
  else pack = (await import(`./${code}.js`)).default;
  packs.set(code, pack);
  return pack;
}

/** Loads the language (and its fallback chain) and applies lang/dir/number-format settings. */
export async function setLang(code) {
  const loc = localeByCode(code) ?? localeByCode(SOURCE_LOCALE);
  for (const c of [loc.code, ...loc.fallback]) await loadPack(c);
  current = loc.code;
  setFormatLocale(loc.formatLocale);
  const root = document.documentElement;
  root.lang = loc.code === 'en-XA' ? 'en' : loc.code;
  root.dir = loc.dir;
  return loc.code;
}

export const getLang = () => current;

function lookup(key) {
  const loc = localeByCode(current);
  for (const c of [loc.code, ...loc.fallback]) {
    const v = packs.get(c)?.[key];
    if (v !== undefined) return { value: v, from: c };
  }
  return null;
}

function report(level, key) {
  const id = `${current}:${key}`;
  if (reported.has(id)) return;
  reported.add(id);
  console[level](`i18n: missing key "${key}" for "${current}"`);
}

function interpolate(template, vars, key) {
  return template.replace(/\{(\w+)\}/g, (_, name) => {
    if (vars && name in vars) return String(vars[name]);
    report('error', `${key} (variable {${name}})`);
    return `{${name}}`;
  });
}

export function t(key, vars) {
  const hit = lookup(key);
  if (!hit) {
    if (isDevHost()) { report('error', key); return `⟦missing:${key}⟧`; }
    report('warn', key);
    return key;
  }
  if (hit.from !== current) report(isDevHost() ? 'error' : 'warn', key);
  return interpolate(hit.value, vars, key);
}

/** Plural-aware lookup: picks `${key}.${one|other|...}` by CLDR category of n; {n} is available. */
export function tn(key, n, vars = {}) {
  const cat = pluralCategory(n);
  const exact = lookup(`${key}.${cat}`) ? `${key}.${cat}` : `${key}.other`;
  return t(exact, { n, ...vars });
}

export const supportedLanguages = () => LOCALES.filter((l) => l.status !== 'pseudo');
