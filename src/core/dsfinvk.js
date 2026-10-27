// Importer for the "Bonpos" file (lines.csv) of the DSFinV-K, the standardised export that German
// cash registers with a TSE must be able to produce (BZSt: same file/field names for every vendor).
// Field names follow DSFinV-K 2.3. NOT tested against a real register export yet — only against
// files built from the specification.
import { parseTable } from './csv.js';
import { isValidDateStr } from './dates.js';
import { addMovement } from './inventory.js';
import { replaceDbContents } from './model.js';
import { parseMoneyToCents, parseNumber, round3 } from './numbers.js';

const ALIASES = {
  Z_KASSE_ID: [], Z_ERSTELLUNG: [], Z_NR: [], GV_TYP: [], P_STORNO: [], ART_NR: [], GTIN: [], ARTIKELTEXT: [],
  MENGE: [], FAKTOR: [], EINHEIT: [], STK_BR: [], BON_ID: [], POS_ZEILE: [],
};

// Register unit (EINHEIT) -> family. Empty means "Stück" per the specification.
const unitFamily = (einheit) => {
  const u = String(einheit ?? '').trim().toLowerCase().replace('ü', 'u');
  if (['', 'stuck', 'stueck', 'stk', 'st', 'stk.', 'pcs', 'piece', 'adet'].includes(u)) return 'piece';
  if (['kg', 'kilo'].includes(u)) return 'kg';
  if (['l', 'lt', 'liter', 'litre'].includes(u)) return 'l';
  return u; // unsupported (e.g. g, ml): reported as mismatch, never converted silently
};
const productFamily = (unit) => (unit === 'Stk' || unit === 'Pkg' ? 'piece' : unit);

/**
 * Books the sales of one or more daily closings from lines.csv text.
 *  - only GV_TYP "Umsatz" rows count (Pfand, Rabatt, Gutscheine ... are skipped)
 *  - rows with P_STORNO = 1 are skipped; negative MENGE (returns) is netted against the same product and day
 *  - rows are grouped per day and product; a net negative quantity is booked as a stock adjustment (+)
 *  - each closing (Z_KASSE_ID + Z_NR) is imported only once, so re-reading a file never double-counts
 *  - all-or-nothing: any error leaves the data untouched
 * Product match: GTIN = barcode of the product, else ART_NR.
 */
export function importDsfinvkLines(db, text, { branchId, skipUnknown = false } = {}) {
  const { records, headers } = parseTable(text, ALIASES);
  const need = ['MENGE', 'Z_ERSTELLUNG'];
  if (!need.every((h) => headers.includes(h)) || !(headers.includes('GTIN') || headers.includes('ART_NR'))) {
    return { ok: false, errors: [{ line: 1, code: 'dsfinvk_columns_missing' }] };
  }
  if (records.length === 0) return { ok: false, errors: [{ line: 1, code: 'no_rows' }] };

  const work = structuredClone(db);
  work.meta.importedClosings ??= [];
  const done = new Set(work.meta.importedClosings);
  const branch = branchId ?? work.branches[0].id;
  const byBarcode = new Map(work.products.filter((p) => p.barcode).map((p) => [p.barcode, p]));

  const errors = [];
  const skipped = { nonSale: 0, storno: 0, unknown: 0 };
  const unknownItems = new Set();
  const closingKeys = new Set();
  const skippedClosings = new Set();
  const groups = new Map(); // `${date}|${productId}` -> { date, product, plus, minus, plusValue }

  for (const r of records) {
    const date = String(r.Z_ERSTELLUNG ?? '').slice(0, 10);
    if (!isValidDateStr(date)) { errors.push({ line: r._line, code: 'date_invalid' }); continue; }
    const key = `${r.Z_KASSE_ID ?? ''}#${r.Z_NR ?? r.Z_ERSTELLUNG}`;
    if (done.has(key)) { skippedClosings.add(key); continue; }
    closingKeys.add(key);

    if (r.GV_TYP && r.GV_TYP.trim().toLowerCase() !== 'umsatz') { skipped.nonSale += 1; continue; }
    if (String(r.P_STORNO ?? '').trim() === '1') { skipped.storno += 1; continue; }

    const qty = parseNumber(r.MENGE);
    if (qty === null || Number.isNaN(qty) || qty === 0) { errors.push({ line: r._line, code: 'qty_invalid' }); continue; }
    const product = (r.GTIN && byBarcode.get(r.GTIN)) || (r.ART_NR && byBarcode.get(r.ART_NR)) || null;
    if (!product) {
      if (skipUnknown) { skipped.unknown += 1; unknownItems.add(r.ARTIKELTEXT || r.GTIN || r.ART_NR || '?'); }
      else errors.push({ line: r._line, code: 'product_not_found', detail: r.GTIN || r.ART_NR || r.ARTIKELTEXT });
      continue;
    }
    if (unitFamily(r.EINHEIT) !== productFamily(product.unit)) {
      errors.push({ line: r._line, code: 'unit_mismatch', detail: `${r.EINHEIT || 'Stück'} ≠ ${product.unit}` });
      continue;
    }
    const price = parseMoneyToCents(r.STK_BR);
    if (Number.isNaN(price)) { errors.push({ line: r._line, code: 'price_invalid' }); continue; }
    const factor = parseNumber(r.FAKTOR);
    const unitPrice = price !== null && (factor === null || factor === 1) ? price : null; // price per other reference amount: not used

    const gkey = `${date}|${product.id}`;
    const g = groups.get(gkey) ?? { date, product, plus: 0, minus: 0, plusValue: 0, priced: true };
    if (qty > 0) {
      g.plus = round3(g.plus + qty);
      if (unitPrice === null) g.priced = false; else g.plusValue += unitPrice * qty;
    } else g.minus = round3(g.minus - qty);
    groups.set(gkey, g);
  }
  if (errors.length) return { ok: false, errors };

  let movements = 0;
  for (const g of [...groups.values()].sort((a, b) => a.date.localeCompare(b.date))) {
    const net = round3(g.plus - g.minus);
    if (net === 0) continue;
    const base = { productId: g.product.id, branchId: branch, date: g.date };
    const res = net > 0
      ? addMovement(work, { ...base, type: 'sale', qty: net, unitPriceCents: g.priced && g.plus > 0 ? Math.round(g.plusValue / g.plus) : null, note: 'DSFinV-K' })
      : addMovement(work, { ...base, type: 'adjust', qty: -net, note: 'DSFinV-K Retoure' });
    if (!res.ok) res.errors.forEach((code) => errors.push({ line: '-', code, detail: g.product.nameDe || g.product.nameTr }));
    else movements += 1;
  }
  if (errors.length) return { ok: false, errors };

  work.meta.importedClosings.push(...closingKeys);
  replaceDbContents(db, work);
  return { ok: true, movements, closings: { imported: closingKeys.size, skipped: skippedClosings.size }, skipped, unknownItems: [...unknownItems].slice(0, 20) };
}
