import { createEmptyDb } from '../src/core/model.js';
import { addMovement, upsertProduct, upsertSupplier } from '../src/core/inventory.js';

export const TODAY = '2026-03-31';

export function mkDb() {
  const db = createEmptyDb();
  const s = upsertSupplier(db, { name: 'Test GH', leadTimeDays: 2 }).supplier;
  const p = upsertProduct(db, { nameDe: 'Joghurt', nameTr: 'Yoğurt', barcode: '4001234567890', supplierId: s.id, unit: 'Stk', buyPriceCents: 100, sellPriceCents: 199, minStock: 5, packSize: 6 }).product;
  return { db, s, p };
}

export function move(db, p, type, qty, date, extra = {}) {
  const r = addMovement(db, { productId: p.id, type, qty, date, ...extra });
  if (!r.ok) throw new Error(`move failed: ${r.errors}`);
  return r.movement;
}
