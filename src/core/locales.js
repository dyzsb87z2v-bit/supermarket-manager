// Single registry of UI languages. The UI, the language switcher and the completeness tests
// all derive from this list; do not re-list language codes anywhere else.
//
// status: 'live' needs a native-speaker review record (reviewedBy/reviewedAt);
//         'beta' = drafted, not yet reviewed by a native speaker; 'pseudo' = dev/test only.
export const SOURCE_LOCALE = 'de';

export const LOCALES = [
  { code: 'de', endonym: 'Deutsch', dir: 'ltr', scripts: ['Latin'], formatLocale: 'de-DE', fallback: ['de'], status: 'beta', reviewedBy: null, reviewedAt: null },
  { code: 'tr', endonym: 'Türkçe', dir: 'ltr', scripts: ['Latin'], formatLocale: 'tr-TR', fallback: ['de'], status: 'beta', reviewedBy: null, reviewedAt: null },
  // Persian keeps Latin digits and Gregorian dates on purpose (matches prices and barcodes).
  { code: 'fa', endonym: 'فارسی', dir: 'rtl', scripts: ['Arabic'], formatLocale: 'de-DE', fallback: ['de'], status: 'beta', reviewedBy: null, reviewedAt: null },
  { code: 'en-XA', endonym: 'Pseudo', dir: 'ltr', scripts: ['Latin'], formatLocale: 'de-DE', fallback: ['de'], status: 'pseudo', reviewedBy: null, reviewedAt: null },
];

export const PRODUCTION_LOCALES = LOCALES.filter((l) => l.status !== 'pseudo');
export const localeByCode = (code) => LOCALES.find((l) => l.code === code) ?? null;

/** Picks the best supported language from an ordered preference list (e.g. navigator.languages). */
export function pickLocale(preferences = [], { allowPseudo = false } = {}) {
  const pool = allowPseudo ? LOCALES : PRODUCTION_LOCALES;
  for (const pref of preferences) {
    const base = String(pref).toLowerCase().split('-')[0];
    const hit = pool.find((l) => l.code.toLowerCase() === String(pref).toLowerCase() || l.code === base);
    if (hit) return hit.code;
  }
  return SOURCE_LOCALE;
}
