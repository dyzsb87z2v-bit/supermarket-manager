import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMoneyToCents, parseNumber, round3 } from '../src/core/numbers.js';
import { addDays, diffDays, isValidDateStr, parseDateInput } from '../src/core/dates.js';
import { parseCsv, toCsv } from '../src/core/csv.js';
import { addBranch, addMovement, batchesOf, deleteMovement, getStock, upsertProduct, upsertSupplier } from '../src/core/inventory.js';
import { buildContext } from '../src/core/context.js';
import { mkDb, move, TODAY } from './helpers.js';

test('money parsing handles German/English formats without float errors', () => {
  assert.equal(parseMoneyToCents('1,29'), 129);
  assert.equal(parseMoneyToCents('1.29'), 129);
  assert.equal(parseMoneyToCents('€ 2,5'), 250);
  assert.equal(parseMoneyToCents('1.299,50'), 129950);
  assert.equal(parseMoneyToCents('1,299.50'), 129950);
  assert.equal(parseMoneyToCents('1.005'), 101); // rounds half up, no 100.4999 artefact
  assert.equal(parseMoneyToCents(''), null);
  assert.ok(Number.isNaN(parseMoneyToCents('abc')));
  assert.ok(Number.isNaN(parseMoneyToCents('-3')));
  assert.ok(Number.isNaN(parseMoneyToCents('1,2,3')));
});

test('number parsing', () => {
  assert.equal(parseNumber('2,5'), 2.5);
  assert.equal(parseNumber(' 12 '), 12);
  assert.equal(parseNumber(''), null);
  assert.ok(Number.isNaN(parseNumber('1x')));
  assert.equal(round3(0.1 + 0.2), 0.3);
});

test('dates', () => {
  assert.ok(isValidDateStr('2024-02-29'));
  assert.ok(!isValidDateStr('2025-02-29'));
  assert.equal(addDays('2026-03-31', 1), '2026-04-01');
  assert.equal(diffDays('2026-04-01', '2026-03-01'), 31);
  assert.equal(parseDateInput('05.03.2026'), '2026-03-05');
  assert.equal(parseDateInput('2026-03-05'), '2026-03-05');
  assert.equal(parseDateInput('31.02.2026'), null);
});

test('csv: delimiter detection, quotes, BOM, round trip, formula guard', () => {
  const rows = parseCsv('﻿a;b;c\r\n1;"x;y";"he said ""hi"""\r\n\r\n');
  assert.deepEqual(rows, [['a', 'b', 'c'], ['1', 'x;y', 'he said "hi"']]);
  assert.deepEqual(parseCsv('a,b\n1,2'), [['a', 'b'], ['1', '2']]);
  const out = toCsv([['n', 'v'], ['=HYPERLINK("x")', '-5'], ['a;b', 'ç']]);
  assert.ok(out.startsWith('﻿'));
  assert.ok(out.includes("'=HYPERLINK"));
  assert.ok(out.includes(';-5')); // plain negative numbers stay numbers
  assert.deepEqual(parseCsv(out)[2], ['a;b', 'ç']);
});

test('product validation: name, barcode format, duplicate barcode', () => {
  const { db } = mkDb();
  assert.deepEqual(upsertProduct(db, { nameDe: '', nameTr: '' }).errors, ['name_required']);
  assert.ok(upsertProduct(db, { nameDe: 'X', barcode: '12ab' }).errors.includes('barcode_invalid'));
  assert.ok(upsertProduct(db, { nameDe: 'X', barcode: '4001234567890' }).errors.includes('barcode_duplicate'));
  assert.ok(upsertProduct(db, { nameDe: 'X', sellPriceCents: -1 }).errors.includes('sell_price_invalid'));
  const edit = upsertProduct(db, { nameDe: 'Joghurt neu', barcode: '4001234567890' }, db.products[0].id);
  assert.ok(edit.ok, 'editing keeps own barcode valid');
});

test('stock = receipts - sales - waste +/- adjustments, per branch', () => {
  const { db, p } = mkDb();
  move(db, p, 'receive', 20, '2026-03-01');
  move(db, p, 'sale', 5, '2026-03-02');
  move(db, p, 'waste', 2, '2026-03-03');
  move(db, p, 'adjust', -1, '2026-03-04');
  move(db, p, 'adjust', 3, '2026-03-04');
  assert.equal(getStock(db, p.id), 15);
  const b = addBranch(db, 'Filiale 2').branch;
  assert.equal(getStock(db, p.id, b.id), 0, 'other branch is separate');
});

test('cannot sell more than in stock, quantities validated', () => {
  const { db, p } = mkDb();
  move(db, p, 'receive', 3, '2026-03-01');
  assert.deepEqual(addMovement(db, { productId: p.id, type: 'sale', qty: 4, date: '2026-03-02' }).errors, ['insufficient_stock']);
  assert.ok(addMovement(db, { productId: p.id, type: 'sale', qty: 0, date: '2026-03-02' }).errors.includes('qty_invalid'));
  assert.ok(addMovement(db, { productId: p.id, type: 'sale', qty: 1.5, date: '2026-03-02' }).errors.includes('qty_not_integer'));
  assert.ok(addMovement(db, { productId: p.id, type: 'sale', qty: 1, date: '2026-13-01' }).errors.includes('date_invalid'));
  assert.equal(getStock(db, p.id), 3);
});

test('sale snapshots the price at the time of sale', () => {
  const { db, p } = mkDb();
  move(db, p, 'receive', 10, '2026-03-01');
  const m = move(db, p, 'sale', 1, '2026-03-02');
  assert.equal(m.unitPriceCents, 199);
  p.sellPriceCents = 299;
  assert.equal(db.movements.find((x) => x.id === m.id).unitPriceCents, 199);
});

test('deleting a receipt that would make stock negative is refused', () => {
  const { db, p } = mkDb();
  const r = move(db, p, 'receive', 5, '2026-03-01');
  move(db, p, 'sale', 4, '2026-03-02');
  assert.deepEqual(deleteMovement(db, r.id).errors, ['would_make_negative']);
  const last = db.movements[1];
  assert.ok(deleteMovement(db, last.id).ok);
  assert.equal(getStock(db, p.id), 5);
});

test('expiry batches are consumed first-expired-first-out', () => {
  const { db, p } = mkDb();
  move(db, p, 'receive', 10, '2026-03-01', { expiry: '2026-04-20' });
  move(db, p, 'receive', 10, '2026-03-05', { expiry: '2026-04-05' });
  move(db, p, 'receive', 4, '2026-03-06'); // no expiry
  move(db, p, 'sale', 12, '2026-03-10');
  const ctx = buildContext(db, { today: TODAY });
  assert.deepEqual(batchesOf(ctx, p.id), [
    { expiry: '2026-04-20', qty: 8 },
    { expiry: null, qty: 4 },
  ]);
  assert.equal(ctx.stockOf(p.id), 12);
});

test('suppliers: validation and duplicates', () => {
  const { db } = mkDb();
  assert.ok(upsertSupplier(db, { name: 'test gh' }).errors.includes('supplier_duplicate'));
  assert.ok(upsertSupplier(db, { name: 'B', leadTimeDays: -1 }).errors.includes('lead_time_invalid'));
  assert.ok(upsertSupplier(db, { name: '' }).errors.includes('name_required'));
});

test('quick daily sales: books many lines at once with price snapshots', async () => {
  const { recordDailySales } = await import('../src/core/inventory.js');
  const { db, p } = mkDb();
  const p2 = upsertProduct(db, { nameDe: 'Tee', unit: 'kg', buyPriceCents: 300, sellPriceCents: 500, packSize: 0.5 }).product;
  move(db, p, 'receive', 10, '2026-03-01');
  move(db, p2, 'receive', 4, '2026-03-01');
  const r = recordDailySales(db, { date: '2026-03-05', branchId: 'main', entries: [
    { productId: p.id, qty: 3 }, { productId: p2.id, qty: '1,5'.replace(',', '.') }, { productId: p.id, qty: 0 }, { productId: p2.id, qty: '' },
  ] });
  assert.deepEqual([r.ok, r.count], [true, 2]);
  assert.equal(getStock(db, p.id), 7);
  assert.equal(getStock(db, p2.id), 2.5);
  const sale = db.movements.find((m) => m.type === 'sale' && m.productId === p.id);
  assert.deepEqual([sale.date, sale.unitPriceCents], ['2026-03-05', 199]);
});

test('quick daily sales is all-or-nothing and reports which product failed', async () => {
  const { recordDailySales } = await import('../src/core/inventory.js');
  const { db, p } = mkDb();
  const p2 = upsertProduct(db, { nameDe: 'Tee', unit: 'Stk' }).product;
  move(db, p, 'receive', 10, '2026-03-01');
  move(db, p2, 'receive', 2, '2026-03-01');
  const before = db.movements.length;
  const r = recordDailySales(db, { date: '2026-03-05', branchId: 'main', entries: [{ productId: p.id, qty: 3 }, { productId: p2.id, qty: 5 }] });
  assert.equal(r.ok, false);
  assert.deepEqual(r.errors.map((e) => [e.productId, e.code, e.available]), [[p2.id, 'insufficient_stock', 2]]);
  assert.equal(db.movements.length, before);
  assert.equal(recordDailySales(db, { date: '2026-03-05', branchId: 'main', entries: [{ productId: p.id, qty: 0 }] }).errors[0].code, 'nothing_to_record');
  assert.equal(recordDailySales(db, { date: 'bad', branchId: 'main', entries: [{ productId: p.id, qty: 1 }] }).errors[0].code, 'date_invalid');
  assert.equal(recordDailySales(db, { date: '2026-03-05', branchId: 'main', entries: [{ productId: p.id, qty: 1.5 }] }).errors[0].code, 'qty_not_integer');
});
