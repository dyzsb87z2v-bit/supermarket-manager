export const round3 = (x) => Math.round((x + Number.EPSILON) * 1000) / 1000;

/**
 * Parses a money string ("1,29", "1.29", "1.299,50", "€ 2,5") into integer cents.
 * Returns null for empty input and NaN for unparsable input. Never negative.
 */
export function parseMoneyToCents(input) {
  if (input === null || input === undefined) return null;
  if (typeof input === 'number') return Number.isFinite(input) && input >= 0 ? Math.round(input * 100) : NaN;
  let s = String(input).replace(/[€\s]|eur/gi, '');
  if (s === '') return null;
  if (!/^\d[\d.,]*$/.test(s)) return NaN;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    // the later separator is the decimal one
    const dec = Math.max(lastComma, lastDot);
    s = s.slice(0, dec).replace(/[.,]/g, '') + '.' + s.slice(dec + 1);
  } else if (lastComma >= 0) {
    if ((s.match(/,/g) || []).length > 1) return NaN;
    s = s.replace(',', '.');
  } else if ((s.match(/\./g) || []).length > 1) {
    return NaN;
  }
  const [intPart, fracRaw = ''] = s.split('.');
  if (!/^\d+$/.test(intPart) || (fracRaw && !/^\d+$/.test(fracRaw))) return NaN;
  let cents = Number(intPart) * 100 + Number((fracRaw + '00').slice(0, 2));
  if (fracRaw.length > 2 && Number(fracRaw[2]) >= 5) cents += 1;
  return cents;
}

/** Parses a quantity ("12", "2,5", "2.5"). Returns null for empty, NaN for invalid. */
export function parseNumber(input) {
  if (input === null || input === undefined) return null;
  if (typeof input === 'number') return Number.isFinite(input) ? input : NaN;
  const s = String(input).trim().replace(',', '.');
  if (s === '') return null;
  if (!/^-?\d+(\.\d+)?$/.test(s)) return NaN;
  return Number(s);
}

export function formatEuro(cents) {
  if (cents === null || cents === undefined) return '—';
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(cents / 100);
}

export function formatQty(q) {
  return new Intl.NumberFormat('de-DE', { maximumFractionDigits: 3 }).format(q);
}
