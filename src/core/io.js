import { parseTable, toCsv } from './csv.js';
import { parseDateInput, todayStr } from './dates.js';
import { buildContext } from './context.js';
import { addMovement, upsertProduct, upsertSupplier } from './inventory.js';
import { DB_VERSION, normalizeDb, replaceDbContents } from './model.js';
import { formatQty, parseMoneyToCents, parseNumber, round3 } from './numbers.js';

const PRODUCT_ALIASES = {
  barcode: ['ean', 'gtin', 'barkod', 'strichcode'],
  nameDe: ['name', 'artikel', 'bezeichnung', 'artikelname', 'productname', 'name_de'],
  nameTr: ['urun', 'urunadi', 'isim', 'ad', 'name_tr'],
  category: ['kategorie', 'kategori', 'warengruppe'],
  supplier: ['lieferant', 'tedarikci'],
  buyPrice: ['ek', 'einkaufspreis', 'ekpreis', 'alis', 'alisfiyati', 'purchaseprice', 'costprice', 'buy_price'],
  sellPrice: ['vk', 'verkaufspreis', 'vkpreis', 'satis', 'satisfiyati', 'price', 'preis', 'sell_price'],
  unit: ['einheit', 'birim'],
  minStock: ['mindestbestand', 'minbestand', 'minimum', 'minstok', 'min_stock'],
  packSize: ['pack', 'packungsgroesse', 'packungsgrosse', 'gebinde', 'gebindegroesse', 'koli', 'pack_size'],
  active: ['aktiv', 'aktif'],
  stock: ['bestand', 'stok', 'currentstock'],
  expiry: ['mhd', 'ablaufdatum', 'skt', 'bestbefore'],
};

const MOVEMENT_ALIASES = {
  date: ['datum', 'tarih'],
  barcode: ['ean', 'gtin', 'barkod'],
  qty: ['quantity', 'menge', 'anzahl', 'adet', 'miktar'],
  type: ['typ', 'art', 'tur'],
  unitPrice: ['preis', 'vk', 'price', 'fiyat', 'satisfiyati', 'unit_price'],
  unitCost: ['ek', 'einkaufspreis', 'maliyet', 'unit_cost'],
  expiry: ['mhd', 'ablaufdatum', 'skt', 'bestbefore'],
  branch: ['filiale', 'sube'],
  note: ['notiz', 'not', 'bemerkung'],
};

const UNIT_WORDS = {
  stk: 'Stk', stuck: 'Stk', adet: 'Stk', piece: 'Stk', pcs: 'Stk',
  kg: 'kg', kilo: 'kg',
  l: 'l', lt: 'l', liter: 'l',
  pkg: 'Pkg', pack: 'Pkg', paket: 'Pkg', packung: 'Pkg',
};
const TYPE_WORDS = {
  receive: 'receive', wareneingang: 'receive', eingang: 'receive', in: 'receive', giris: 'receive',
  sale: 'sale', verkauf: 'sale', satis: 'sale', out: 'sale',
  waste: 'waste', schwund: 'waste', verderb: 'waste', fire: 'waste', atik: 'waste',
  adjust: 'adjust', korrektur: 'adjust', inventur: 'adjust', duzeltme: 'adjust',
};
const INACTIVE = new Set(['0', 'nein', 'no', 'false', 'hayir', 'inaktiv', 'pasif']);

const plain = (s) => String(s).toLowerCase().replace(/[ışçğöüäß]/g, (c) => ({ 'ı': 'i', 'ş': 's', 'ç': 'c', 'ğ': 'g', 'ö': 'o', 'ü': 'u', 'ä': 'a', 'ß': 'ss' }[c]));

function clone(db) {
  return structuredClone(db);
}

/**
 * Imports products (upsert by barcode). All-or-nothing: if any row is invalid, nothing changes.
 * Unknown supplier names are created with the default lead time.
 */
export function importProductsCsv(db, text, { branchId, today = todayStr() } = {}) {
  const { records, headers, unknownHeaders } = parseTable(text, PRODUCT_ALIASES);
  if (!headers.includes('nameDe') && !headers.includes('nameTr')) {
    return { ok: false, errors: [{ line: 1, code: 'missing_name_column' }], unknownHeaders };
  }
  if (records.length === 0) return { ok: false, errors: [{ line: 1, code: 'no_rows' }], unknownHeaders };
  const work = clone(db);
  const branch = branchId ?? work.branches[0].id;
  const startStock = buildContext(work, { branchId: branch }).stock;
  const errors = [];
  let created = 0;
  let updated = 0;
  let stockSet = 0;
  const seen = new Set();
  for (const r of records) {
    const rowErrors = [];
    const buy = parseMoneyToCents(r.buyPrice);
    const sell = parseMoneyToCents(r.sellPrice);
    if (Number.isNaN(buy)) rowErrors.push('buy_price_invalid');
    if (Number.isNaN(sell)) rowErrors.push('sell_price_invalid');
    const min = parseNumber(r.minStock);
    if (Number.isNaN(min) || (min ?? 0) < 0) rowErrors.push('min_stock_invalid');
    const pack = parseNumber(r.packSize);
    if (Number.isNaN(pack) || (pack !== null && pack <= 0)) rowErrors.push('pack_size_invalid');
    const unit = r.unit ? UNIT_WORDS[plain(r.unit)] : 'Stk';
    if (!unit) rowErrors.push('unit_invalid');
    const counted = parseNumber(r.stock);
    if (Number.isNaN(counted) || (counted ?? 0) < 0) rowErrors.push('stock_invalid');
    const expiry = r.expiry ? parseDateInput(r.expiry) : null;
    if (r.expiry && !expiry) rowErrors.push('expiry_invalid');
    if (r.barcode && seen.has(r.barcode)) rowErrors.push('barcode_duplicate');
    if (r.barcode) seen.add(r.barcode);
    if (rowErrors.length) { rowErrors.forEach((code) => errors.push({ line: r._line, code })); continue; }

    let supplierId = null;
    if (r.supplier) {
      let s = work.suppliers.find((x) => x.name.toLowerCase() === r.supplier.toLowerCase());
      if (!s) s = upsertSupplier(work, { name: r.supplier }).supplier;
      supplierId = s.id;
    }
    const existing = r.barcode ? work.products.find((p) => p.barcode === r.barcode) : null;
    const res = upsertProduct(work, {
      nameDe: r.nameDe ?? existing?.nameDe ?? '',
      nameTr: r.nameTr ?? existing?.nameTr ?? '',
      barcode: r.barcode ?? '',
      category: r.category ?? existing?.category ?? '',
      supplierId: supplierId ?? existing?.supplierId ?? null,
      unit,
      buyPriceCents: Number.isNaN(buy) ? null : buy ?? existing?.buyPriceCents ?? null,
      sellPriceCents: Number.isNaN(sell) ? null : sell ?? existing?.sellPriceCents ?? null,
      minStock: min ?? existing?.minStock ?? 0,
      packSize: pack ?? existing?.packSize ?? 1,
      active: r.active ? !INACTIVE.has(plain(r.active)) : existing?.active ?? true,
    }, existing?.id ?? null);
    if (!res.ok) { res.errors.forEach((code) => errors.push({ line: r._line, code })); continue; }
    if (res.created) created += 1; else updated += 1;
    // "stock" is a COUNTED quantity: only the difference to the current stock is booked, so
    // importing the same file twice changes nothing.
    if (counted !== null) {
      const delta = round3(counted - (startStock.get(res.product.id) ?? 0));
      if (delta !== 0) {
        const mv = addMovement(work, {
          productId: res.product.id, branchId: branch, date: today, qty: delta, note: 'Import: Bestand',
          type: delta > 0 && expiry ? 'receive' : 'adjust', expiry: delta > 0 ? expiry : null,
        });
        if (!mv.ok) mv.errors.forEach((code) => errors.push({ line: r._line, code }));
        else stockSet += 1;
      }
    }
  }
  if (errors.length) return { ok: false, errors, unknownHeaders };
  replaceDbContents(db, work);
  return { ok: true, created, updated, stockSet, unknownHeaders };
}

/**
 * Imports stock movements. `defaultType` applies when the file has no "type" column
 * ('sale' for daily sales files, 'receive' for goods-in files). All-or-nothing.
 * Products are matched by barcode; rows are applied in file order.
 */
export function importMovementsCsv(db, text, { defaultType = 'sale', branchId } = {}) {
  const { records, headers, unknownHeaders } = parseTable(text, MOVEMENT_ALIASES);
  for (const need of ['barcode', 'qty']) {
    if (!headers.includes(need)) return { ok: false, errors: [{ line: 1, code: `missing_${need}_column` }], unknownHeaders };
  }
  if (records.length === 0) return { ok: false, errors: [{ line: 1, code: 'no_rows' }], unknownHeaders };
  const work = clone(db);
  const errors = [];
  let imported = 0;
  for (const r of records) {
    const product = work.products.find((p) => p.barcode === r.barcode);
    if (!product) { errors.push({ line: r._line, code: 'product_not_found', detail: r.barcode }); continue; }
    const date = r.date ? parseDateInput(r.date) : null;
    if (!date) { errors.push({ line: r._line, code: 'date_invalid' }); continue; }
    const qty = parseNumber(r.qty);
    if (qty === null || Number.isNaN(qty)) { errors.push({ line: r._line, code: 'qty_invalid' }); continue; }
    const type = r.type ? TYPE_WORDS[plain(r.type)] : defaultType;
    if (!type) { errors.push({ line: r._line, code: 'type_invalid' }); continue; }
    const price = parseMoneyToCents(r.unitPrice);
    const cost = parseMoneyToCents(r.unitCost);
    if (Number.isNaN(price) || Number.isNaN(cost)) { errors.push({ line: r._line, code: 'price_invalid' }); continue; }
    const expiry = r.expiry ? parseDateInput(r.expiry) : null;
    if (r.expiry && !expiry) { errors.push({ line: r._line, code: 'expiry_invalid' }); continue; }
    let branch = branchId;
    if (r.branch) {
      const b = work.branches.find((x) => x.id === r.branch || x.name.toLowerCase() === r.branch.toLowerCase());
      if (!b) { errors.push({ line: r._line, code: 'branch_not_found', detail: r.branch }); continue; }
      branch = b.id;
    }
    const res = addMovement(work, {
      productId: product.id, branchId: branch, date, type, qty,
      unitPriceCents: price, unitCostCents: cost, expiry, note: r.note ?? '',
    });
    if (!res.ok) res.errors.forEach((code) => errors.push({ line: r._line, code }));
    else imported += 1;
  }
  if (errors.length) return { ok: false, errors, unknownHeaders };
  replaceDbContents(db, work);
  return { ok: true, imported, unknownHeaders };
}

const eur = (c) => (c === null || c === undefined ? '' : (c / 100).toFixed(2).replace('.', ','));
const qtyStr = (q) => String(q).replace('.', ',');

export function exportProductsCsv(db, branchStock) {
  const supplierName = new Map(db.suppliers.map((s) => [s.id, s.name]));
  const rows = [['barcode', 'name_de', 'name_tr', 'category', 'supplier', 'buy_price', 'sell_price', 'unit', 'min_stock', 'pack_size', 'active', 'stock']];
  for (const p of db.products) {
    rows.push([p.barcode, p.nameDe, p.nameTr, p.category, supplierName.get(p.supplierId) ?? '', eur(p.buyPriceCents), eur(p.sellPriceCents),
      p.unit, qtyStr(p.minStock), qtyStr(p.packSize), p.active ? 'ja' : 'nein', branchStock ? qtyStr(branchStock.get(p.id) ?? 0) : '']);
  }
  return toCsv(rows);
}

export function exportMovementsCsv(db) {
  const byId = new Map(db.products.map((p) => [p.id, p]));
  const branch = new Map(db.branches.map((b) => [b.id, b.name]));
  const rows = [['date', 'branch', 'barcode', 'name', 'type', 'qty', 'unit_price', 'unit_cost', 'expiry', 'note']];
  for (const m of [...db.movements].sort((a, b) => a.date.localeCompare(b.date))) {
    const p = byId.get(m.productId);
    rows.push([m.date, branch.get(m.branchId) ?? '', p?.barcode ?? '', p?.nameDe || p?.nameTr || '', m.type, qtyStr(m.qty), eur(m.unitPriceCents), eur(m.unitCostCents), m.expiry ?? '', m.note]);
  }
  return toCsv(rows);
}

export function exportReportCsv(report) {
  const rows = [];
  rows.push(['report', report.kind, report.kind === 'daily' ? report.date : `${report.from} .. ${report.to}`]);
  rows.push(['units_sold', qtyStr(report.units)], ['revenue_eur', eur(report.revenueCents)], ['gross_profit_eur', eur(report.grossProfitCents)],
    ['waste_units', qtyStr(report.wasteUnits)], ['stock_value_at_cost_eur', eur(report.stockValueCents)]);
  rows.push([], ['top_products', 'qty', 'revenue_eur']);
  for (const t of report.top) rows.push([t.product?.nameDe || t.product?.nameTr || '', qtyStr(t.qty), eur(t.revenueCents)]);
  rows.push([], ['low_stock', 'stock', 'min_stock']);
  for (const a of report.lowStock) rows.push([a.product.nameDe || a.product.nameTr, qtyStr(a.stock), qtyStr(a.product.minStock)]);
  rows.push([], ['expiring', 'qty', 'expiry']);
  for (const a of report.expiring) rows.push([a.product.nameDe || a.product.nameTr, qtyStr(a.qty), a.expiry]);
  rows.push([], ['order_suggestion', 'supplier', 'qty', 'unit']);
  for (const g of report.orders) for (const l of g.lines) rows.push([l.product.nameDe || l.product.nameTr, g.supplier?.name ?? '', qtyStr(l.suggestedQty), l.product.unit]);
  return toCsv(rows);
}

export function exportBackup(db) {
  return JSON.stringify({ app: 'supermarket-manager', ...db }, null, 1);
}

/** Parses a JSON backup. A demo backup can never be loaded into the real workspace (and vice versa). */
export function parseBackup(text, { expectDemo }) {
  let raw;
  try { raw = JSON.parse(text); } catch { return { ok: false, errors: ['invalid_data'] }; }
  if (raw?.app !== 'supermarket-manager' || raw.version !== DB_VERSION) return { ok: false, errors: ['invalid_data'] };
  let db;
  try { db = normalizeDb(raw); } catch { return { ok: false, errors: ['invalid_data'] }; }
  delete db.app;
  if (Boolean(db.meta.isDemo) !== Boolean(expectDemo)) return { ok: false, errors: ['workspace_mismatch'] };
  return { ok: true, db };
}

export { formatQty };
