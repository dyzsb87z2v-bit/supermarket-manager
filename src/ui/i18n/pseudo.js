// Pseudo-locale: accents letters, pads ~35% and wraps every value in markers so a test can
// find any visible text that did not come from a language pack (= a missed string) and any
// layout that will not survive text expansion. Placeholders like {n} are left untouched.
const MAP = { a: 'à', e: 'é', i: 'ï', o: 'ô', u: 'ü', c: 'ç', n: 'ñ', s: 'ş', y: 'ÿ', A: 'Å', E: 'É', I: 'Ï', O: 'Ö', U: 'Û' };

export function pseudoValue(value) {
  const parts = String(value).split(/(\{\w+\})/);
  const body = parts.map((p) => (/^\{\w+\}$/.test(p) ? p : p.replace(/[aeiouycnsAEIOU]/g, (c) => MAP[c]))).join('');
  const dots = Math.ceil(String(value).replace(/\{\w+\}/g, '').length * 0.35);
  const pad = Array.from({ length: Math.ceil(dots / 3) }, () => '···').join(' '); // breakable, like real words
  return `⟦${body}${pad ? ' ' + pad : ''}⟧`;
}

export function pseudoize(pack) {
  return Object.fromEntries(Object.entries(pack).map(([k, v]) => [k, pseudoValue(v)]));
}
