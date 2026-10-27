// Completeness gate for UI language packs. Pure functions: take the registry and packs, return violations.
import { PRODUCTION_LOCALES, SOURCE_LOCALE } from '../src/core/locales.js';

const PLACEHOLDER = /\{(\w+)\}/g;
const placeholders = (s) => [...String(s).matchAll(PLACEHOLDER)].map((m) => m[1]).sort();

// Technical terms and column names that must stay as written in every language.
export const DO_NOT_TRANSLATE = ['EAN', 'CSV', 'Excel', 'DELETE', 'IndexedDB', 'POS', 'Enter', 'UTF-8', 'Stk', 'Pkg', 'kg', 'Artikel', 'EK', 'VK', 'Menge', 'Datum',
  'Barkod', 'name', 'qty', 'stock', 'barcode', 'Deutsch', 'Türkçe', 'Save', 'as', 'MHD', 'SKT',
  'DSFinV-K', 'lines.csv', 'MENGE', 'Z_ERSTELLUNG', 'GTIN', 'ART_NR', 'TSE', 'ZIP', 'Kassenabschluss'];

// Values that are legitimately identical to the German source (true cognates / symbols) per locale.
export const ALLOW_IDENTICAL = {
  tr: ['app.demoBadge', 'unit.kg', 'supplier.phone', 'settings.exportTitle', 'settings.wsReal'],
  fa: [],
};

const SCRIPT_RE = { Latin: /\p{Script=Latin}/gu, Arabic: /\p{Script=Arabic}/gu };

function letterShare(text, scripts) {
  let clean = text.replace(PLACEHOLDER, ' ').replace(/[\d\p{P}\p{S}\s]/gu, '');
  // terms are compared in the same stripped form as the text (punctuation/underscores removed)
  for (const term of DO_NOT_TRANSLATE) clean = clean.split(term.replace(/[\d\p{P}\p{S}\s]/gu, '')).join('');
  const letters = clean.match(/\p{L}/gu) ?? [];
  if (letters.length === 0) return 1;
  const inScript = letters.filter((ch) => scripts.some((s) => ch.match(SCRIPT_RE[s]))).length;
  return inScript / letters.length;
}

const pluralBase = (key) => key.replace(/\.(zero|one|two|few|many|other)$/, '');
const isPlural = (key) => /\.(zero|one|two|few|many|other)$/.test(key);

/** @returns {string[]} human-readable violations; empty = pass */
export function checkPacks(packs, { locales = PRODUCTION_LOCALES, source = SOURCE_LOCALE, allowIdentical = ALLOW_IDENTICAL } = {}) {
  const v = [];
  if (locales.length === 0) return ['registry is empty (gate would pass vacuously)'];
  const src = packs[source];
  if (!src) return [`source pack "${source}" missing`];
  for (const loc of locales) {
    const pack = packs[loc.code];
    if (!pack) { v.push(`${loc.code}: no pack for registry entry`); continue; }
    if (loc.status === 'live' && !(loc.reviewedBy && loc.reviewedAt)) v.push(`${loc.code}: status live without review record`);
    for (const k of Object.keys(src)) if (!(k in pack)) v.push(`${loc.code}: missing key ${k}`);
    for (const k of Object.keys(pack)) if (!(k in src)) v.push(`${loc.code}: extra key ${k}`);
    const cats = new Intl.PluralRules(loc.pluralLocale).resolvedOptions().pluralCategories;
    const bases = new Set(Object.keys(src).filter(isPlural).map(pluralBase));
    for (const b of bases) for (const c of cats) if (!(`${b}.${c}` in pack)) v.push(`${loc.code}: plural ${b} lacks category "${c}"`);
    for (const [k, val] of Object.entries(pack)) {
      if (!(k in src)) continue;
      if (typeof val !== 'string' || val.trim() === '') { v.push(`${loc.code}: empty value ${k}`); continue; }
      if (JSON.stringify(placeholders(val)) !== JSON.stringify(placeholders(src[k]))) v.push(`${loc.code}: placeholder mismatch ${k}`);
      if (loc.code !== source && val === src[k] && /\p{L}/u.test(val) && !(allowIdentical[loc.code] ?? []).includes(k)) v.push(`${loc.code}: untranslated copy ${k}`);
      if (letterShare(val, loc.scripts) < 0.5) v.push(`${loc.code}: wrong script ${k}`);
    }
  }
  return v;
}
