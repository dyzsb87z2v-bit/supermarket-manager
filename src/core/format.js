// Locale-aware display formatting. The locale is set once by the UI language registry entry
// (`formatLocale`); the core logic itself never depends on it.
let locale = 'de-DE';
const cache = new Map();

const memo = (key, make) => {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
};

export function setFormatLocale(l) {
  locale = l;
  cache.clear();
}

export function formatEuro(cents) {
  if (cents === null || cents === undefined) return '—';
  return memo(`eur:${locale}`, () => new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR' })).format(cents / 100);
}

export function formatQty(q) {
  return memo(`qty:${locale}`, () => new Intl.NumberFormat(locale, { maximumFractionDigits: 3 })).format(q);
}

/** Percent value (already in percent units, e.g. 32.26) with at most one decimal; `sign` adds + for positive values. */
export function formatPct(p, { sign = false } = {}) {
  return memo(`pct:${locale}:${sign}`, () => new Intl.NumberFormat(locale, { maximumFractionDigits: 1, signDisplay: sign ? 'exceptZero' : 'auto' })).format(p);
}

/** ISO date "YYYY-MM-DD" -> "31.03.2026" / "31 Mar 2026" depending on locale. Calendar days have no time zone. */
export function formatDate(iso) {
  if (!iso) return '';
  return memo(`date:${locale}`, () => new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }))
    .format(new Date(`${iso}T00:00:00Z`));
}

/** Short weekday + day/month, e.g. "Di., 31.03." */
export function formatDayShort(iso) {
  return memo(`day:${locale}`, () => new Intl.DateTimeFormat(locale, { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'UTC' }))
    .format(new Date(`${iso}T00:00:00Z`));
}

export function pluralCategory(n) {
  return memo(`pr:${locale}`, () => new Intl.PluralRules(locale)).select(n);
}
