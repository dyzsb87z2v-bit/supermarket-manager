// Dates are plain "YYYY-MM-DD" strings (local calendar days). No time zones involved.

export function todayStr(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function isValidDateStr(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function toDayNumber(s) {
  const [y, m, d] = s.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}

export function fromDayNumber(n) {
  return new Date(n * 86400000).toISOString().slice(0, 10);
}

export function addDays(s, n) {
  return fromDayNumber(toDayNumber(s) + n);
}

/** Whole days from b to a (a - b). */
export function diffDays(a, b) {
  return toDayNumber(a) - toDayNumber(b);
}

/** Accepts YYYY-MM-DD, DD.MM.YYYY and DD/MM/YYYY. Returns ISO string or null. */
export function parseDateInput(input) {
  const s = String(input ?? '').trim();
  if (!s) return null;
  if (isValidDateStr(s)) return s;
  const m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  if (m) {
    const iso = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    return isValidDateStr(iso) ? iso : null;
  }
  return null;
}
