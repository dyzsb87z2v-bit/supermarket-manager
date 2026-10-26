import { isValidDateStr, todayStr } from './dates.js';
import { MOVEMENT_TYPES, UNITS, newId } from './model.js';
import { buildContext, movementDelta } from './context.js';
import { round3 } from './numbers.js';

const isCents = (v) => v === null || (Number.isInteger(v) && v >= 0);

export function validateProduct(db, input, existingId = null) {
  const errors = [];
  const nameDe = String(input.nameDe ?? '').trim();
  const nameTr = String(input.nameTr ?? '').trim();
  const barcode = String(input.barcode ?? '').trim();
  if (!nameDe && !nameTr) errors.push('name_required');
  if (barcode) {
    if (!/^\d{6,14}$/.test(barcode)) errors.push('barcode_invalid');
    else if (db.products.some((p) => p.barcode === barcode && p.id !== existingId)) errors.push('barcode_duplicate');
  }
  if (!isCents(input.buyPriceCents ?? null)) errors.push('buy_price_invalid');
  if (!isCents(input.sellPriceCents ?? null)) errors.push('sell_price_invalid');
  if (!UNITS.includes(input.unit ?? 'Stk')) errors.push('unit_invalid');
  const min = input.minStock ?? 0;
  if (!Number.isFinite(min) || min < 0) errors.push('min_stock_invalid');
  const pack = input.packSize ?? 1;
  if (!Number.isFinite(pack) || pack <= 0) errors.push('pack_size_invalid');
  if (input.supplierId && !db.suppliers.some((s) => s.id === input.supplierId)) errors.push('supplier_not_found');
  return errors;
}

/** Creates (no id) or updates (id given) a product. Mutates db. */
export function upsertProduct(db, input, id = null) {
  const errors = validateProduct(db, input, id);
  if (errors.length) return { ok: false, errors };
  const data = {
    nameDe: String(input.nameDe ?? '').trim(),
    nameTr: String(input.nameTr ?? '').trim(),
    barcode: String(input.barcode ?? '').trim(),
    category: String(input.category ?? '').trim(),
    supplierId: input.supplierId || null,
    unit: input.unit ?? 'Stk',
    buyPriceCents: input.buyPriceCents ?? null,
    sellPriceCents: input.sellPriceCents ?? null,
    minStock: round3(input.minStock ?? 0),
    packSize: round3(input.packSize ?? 1),
    active: input.active !== false,
  };
  if (id) {
    const p = db.products.find((x) => x.id === id);
    if (!p) return { ok: false, errors: ['product_not_found'] };
    Object.assign(p, data);
    return { ok: true, product: p, created: false };
  }
  const product = { id: newId('p'), createdAt: todayStr(), ...data };
  db.products.push(product);
  return { ok: true, product, created: true };
}

export function upsertSupplier(db, input, id = null) {
  const name = String(input.name ?? '').trim();
  const lead = input.leadTimeDays ?? db.settings.defaultLeadTimeDays;
  const errors = [];
  if (!name) errors.push('name_required');
  if (!Number.isInteger(lead) || lead < 0 || lead > 60) errors.push('lead_time_invalid');
  if (db.suppliers.some((s) => s.name.toLowerCase() === name.toLowerCase() && s.id !== id)) errors.push('supplier_duplicate');
  if (errors.length) return { ok: false, errors };
  const data = { name, phone: String(input.phone ?? '').trim(), leadTimeDays: lead, note: String(input.note ?? '').trim() };
  if (id) {
    const s = db.suppliers.find((x) => x.id === id);
    if (!s) return { ok: false, errors: ['supplier_not_found'] };
    Object.assign(s, data);
    return { ok: true, supplier: s };
  }
  const supplier = { id: newId('s'), ...data };
  db.suppliers.push(supplier);
  return { ok: true, supplier };
}

export function addBranch(db, name) {
  const n = String(name ?? '').trim();
  if (!n) return { ok: false, errors: ['name_required'] };
  if (db.branches.some((b) => b.name.toLowerCase() === n.toLowerCase())) return { ok: false, errors: ['branch_duplicate'] };
  const branch = { id: newId('b'), name: n };
  db.branches.push(branch);
  return { ok: true, branch };
}

export function getStock(db, productId, branchId) {
  return buildContext(db, { branchId }).stockOf(productId);
}

/**
 * Records a stock movement. Types: receive (+), sale (-), waste (-), adjust (signed qty).
 * Sales and waste may never push stock below zero (record the missing receipt or an adjustment first).
 */
export function addMovement(db, input) {
  const errors = [];
  const product = db.products.find((p) => p.id === input.productId);
  if (!product) errors.push('product_not_found');
  const branchId = input.branchId ?? db.branches[0].id;
  if (!db.branches.some((b) => b.id === branchId)) errors.push('branch_not_found');
  const date = input.date ?? todayStr();
  if (!isValidDateStr(date)) errors.push('date_invalid');
  if (!MOVEMENT_TYPES.includes(input.type)) errors.push('type_invalid');
  const qty = round3(Number(input.qty));
  if (!Number.isFinite(qty) || qty === 0) errors.push('qty_invalid');
  else if (input.type !== 'adjust' && qty < 0) errors.push('qty_invalid');
  if (product && Number.isFinite(qty) && (product.unit === 'Stk' || product.unit === 'Pkg') && !Number.isInteger(qty)) {
    errors.push('qty_not_integer');
  }
  let expiry = null;
  if (input.expiry) {
    if (!isValidDateStr(input.expiry)) errors.push('expiry_invalid');
    else if (input.type === 'receive') expiry = input.expiry;
  }
  if (!isCents(input.unitPriceCents ?? null) || !isCents(input.unitCostCents ?? null)) errors.push('price_invalid');
  if (errors.length) return { ok: false, errors };

  const delta = movementDelta({ type: input.type, qty });
  if (delta < 0) {
    const current = buildContext(db, { branchId }).stockOf(product.id);
    if (round3(current + delta) < 0) return { ok: false, errors: ['insufficient_stock'], available: current };
  }
  const movement = {
    id: newId('m'),
    date,
    branchId,
    productId: product.id,
    type: input.type,
    qty,
    // Prices are snapshotted so later price changes do not rewrite history.
    unitPriceCents: input.type === 'sale' ? (input.unitPriceCents ?? product.sellPriceCents ?? null) : null,
    unitCostCents: input.unitCostCents ?? product.buyPriceCents ?? null,
    expiry,
    note: String(input.note ?? '').trim(),
  };
  db.movements.push(movement);
  return { ok: true, movement };
}

export function deleteMovement(db, id) {
  const idx = db.movements.findIndex((m) => m.id === id);
  if (idx < 0) return { ok: false, errors: ['movement_not_found'] };
  const m = db.movements[idx];
  const ctx = buildContext(db, { branchId: m.branchId });
  if (round3(ctx.stockOf(m.productId) - movementDelta(m)) < 0) return { ok: false, errors: ['would_make_negative'] };
  db.movements.splice(idx, 1);
  return { ok: true };
}

/**
 * Remaining quantity per expiry date, derived (never stored): outflows consume the earliest
 * expiry first (FEFO). Quantity without an expiry date is consumed last.
 */
export function batchesOf(ctx, productId) {
  const ins = new Map(); // expiry|'' -> qty
  let out = 0;
  for (const m of ctx.movementsOf(productId)) {
    const d = movementDelta(m);
    if (d > 0) {
      const key = m.type === 'receive' && m.expiry ? m.expiry : '';
      ins.set(key, (ins.get(key) ?? 0) + d);
    } else out += -d;
  }
  const batches = [...ins].map(([expiry, qty]) => ({ expiry: expiry || null, qty }))
    .sort((a, b) => (a.expiry === null) - (b.expiry === null) || (a.expiry ?? '').localeCompare(b.expiry ?? ''));
  for (const b of batches) {
    const take = Math.min(b.qty, out);
    b.qty = round3(b.qty - take);
    out = round3(out - take);
  }
  return batches.filter((b) => b.qty > 0);
}
