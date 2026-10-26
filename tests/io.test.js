import test from 'node:test';
import assert from 'node:assert/strict';
import { exportBackup, exportMovementsCsv, exportProductsCsv, importMovementsCsv, importProductsCsv, parseBackup } from '../src/core/io.js';
import { createEmptyDb } from '../src/core/model.js';
import { generateDemoDb } from '../src/core/demo.js';
import { createStore, memoryBackend } from '../src/core/store.js';
import { buildContext } from '../src/core/context.js';
import { lowStockAlerts } from '../src/core/alerts.js';
import { buildOrderSuggestions } from '../src/core/forecast.js';
import { mkDb, move, TODAY } from './helpers.js';

const PRODUCTS_CSV = `Barcode;Artikel;Ürün;Kategorie;Lieferant;EK;VK;Einheit;Mindestbestand
4000000000011;Fladenbrot;Ekmek;Backwaren;Bäckerei X;0,45;0,89;Stk;20
4000000000028;Tomaten;Domates;Gemüse;;1,40;2,49;kg;15
`;

test('product CSV import creates products and suppliers; re-import updates (idempotent)', () => {
  const db = createEmptyDb();
  const r = importProductsCsv(db, PRODUCTS_CSV);
  assert.deepEqual([r.ok, r.created, r.updated], [true, 2, 0]);
  assert.equal(db.products.length, 2);
  assert.equal(db.suppliers[0].name, 'Bäckerei X');
  assert.equal(db.products[0].buyPriceCents, 45);
  assert.equal(db.products[1].unit, 'kg');
  const again = importProductsCsv(db, PRODUCTS_CSV);
  assert.deepEqual([again.created, again.updated], [0, 2]);
  assert.equal(db.products.length, 2);
});

test('product CSV import is all-or-nothing and reports line numbers', () => {
  const db = createEmptyDb();
  const bad = PRODUCTS_CSV + '4000000000035;Kaputt;;;;abc;1;Stk;1\n';
  const r = importProductsCsv(db, bad);
  assert.equal(r.ok, false);
  assert.deepEqual(r.errors, [{ line: 4, code: 'buy_price_invalid' }]);
  assert.equal(db.products.length, 0, 'nothing imported when any row is invalid');
});

test('product CSV import: missing name column and unknown headers', () => {
  const db = createEmptyDb();
  assert.equal(importProductsCsv(db, 'barcode;foo\n123456789;x').errors[0].code, 'missing_name_column');
  const r = importProductsCsv(db, 'name;barcode;whatever\nA;4000000000011;1');
  assert.ok(r.ok);
  assert.deepEqual(r.unknownHeaders, ['whatever']);
});

test('sales CSV import applies movements; failure leaves db untouched', () => {
  const { db, p } = mkDb();
  move(db, p, 'receive', 10, '2026-03-01');
  const ok = importMovementsCsv(db, 'Datum;EAN;Menge\n02.03.2026;4001234567890;3\n2026-03-03;4001234567890;2', { defaultType: 'sale' });
  assert.deepEqual([ok.ok, ok.imported], [true, 2]);
  assert.equal(buildContext(db, { today: TODAY }).stockOf(p.id), 5);
  const before = db.movements.length;
  const bad = importMovementsCsv(db, 'date;barcode;qty\n2026-03-04;4001234567890;2\n2026-03-04;4001234567890;99\n2026-03-04;999999999;1', { defaultType: 'sale' });
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.errors.map((e) => [e.line, e.code]), [[3, 'insufficient_stock'], [4, 'product_not_found']]);
  assert.equal(db.movements.length, before);
});

test('receipts CSV import with expiry and cost', () => {
  const { db, p } = mkDb();
  const r = importMovementsCsv(db, 'date;barcode;qty;unit_cost;expiry\n2026-03-01;4001234567890;12;0,95;15.04.2026', { defaultType: 'receive' });
  assert.ok(r.ok);
  assert.equal(db.movements[0].expiry, '2026-04-15');
  assert.equal(db.movements[0].unitCostCents, 95);
});

test('CSV export -> import round trip keeps product data', () => {
  const { db } = mkDb();
  const csv = exportProductsCsv(db);
  const fresh = createEmptyDb();
  const r = importProductsCsv(fresh, csv);
  assert.ok(r.ok, JSON.stringify(r.errors));
  const { id, createdAt, supplierId, ...a } = db.products[0];
  const { id: i2, createdAt: c2, supplierId: s2, ...b } = fresh.products[0];
  assert.deepEqual(b, a);
  assert.ok(exportMovementsCsv(db).startsWith('﻿date;'));
});

test('backup round trip and workspace separation', () => {
  const { db } = mkDb();
  const text = exportBackup(db);
  assert.ok(parseBackup(text, { expectDemo: false }).ok);
  assert.equal(parseBackup(text, { expectDemo: true }).errors[0], 'workspace_mismatch');
  assert.equal(parseBackup('{"nope":1}', { expectDemo: false }).errors[0], 'invalid_data');
  assert.equal(parseBackup('not json', { expectDemo: false }).errors[0], 'invalid_data');
  const demoText = exportBackup(generateDemoDb(TODAY));
  assert.equal(parseBackup(demoText, { expectDemo: false }).errors[0], 'workspace_mismatch');
});

test('demo data is deterministic, flagged as demo, and produces alerts and suggestions', () => {
  const a = generateDemoDb(TODAY);
  const b = generateDemoDb(TODAY);
  assert.equal(a.meta.isDemo, true);
  assert.equal(a.products.length, b.products.length);
  assert.equal(a.movements.length, b.movements.length);
  assert.ok(a.products.length >= 30);
  assert.ok(a.products.every((p) => p.barcode.startsWith('200') && p.barcode.length === 13));
  const ctx = buildContext(a, { today: TODAY });
  assert.ok([...ctx.stock.values()].every((v) => v >= 0), 'demo never has negative stock');
  assert.ok(lowStockAlerts(ctx).length > 0);
  assert.ok(buildOrderSuggestions(ctx).length > 0);
});

test('store keeps real and demo data apart', async () => {
  const store = createStore(memoryBackend());
  const demo = generateDemoDb(TODAY);
  await store.save('demo', demo);
  const real = await store.load('real');
  assert.equal(real.products.length, 0, 'real workspace untouched by demo');
  assert.equal(real.meta.isDemo, false);
  await assert.rejects(() => store.save('real', demo), /workspace_mismatch/);
  await assert.rejects(() => store.save('demo', real), /workspace_mismatch/);
  await assert.rejects(() => store.load('other'), /unknown_workspace/);
  assert.equal((await store.load('demo')).products.length, demo.products.length);
});

const LEGACY_CSV = `sku;nameDe;nameTr;barcode;category;stock;sold14;minStock;lead;targetDays;pack;buyPrice;sellPrice;supplier;expiry
DEMO-1001;Reis 1 kg;Pirinç 1 kg;4000000000011;Trockenwaren;8;28;4;3;14;6;1.40;2.29;Lieferant X;
DEMO-1002;Öl;Yağ;4000000000028;Öl;20;14;5;4;14;6;1.60;2.49;Lieferant X;15.04.2027
`;

test('product CSV with "stock" books counted stock, keeps pack size, ignores sku/sold14', () => {
  const db = createEmptyDb();
  const r = importProductsCsv(db, LEGACY_CSV, { today: TODAY });
  assert.deepEqual([r.ok, r.created, r.stockSet], [true, 2, 2]);
  assert.ok(r.unknownHeaders.includes('sold14') && r.unknownHeaders.includes('sku'));
  assert.deepEqual(db.products.map((p) => p.packSize), [6, 6]);
  const ctx = buildContext(db, { today: TODAY });
  assert.deepEqual(db.products.map((p) => ctx.stockOf(p.id)), [8, 20]);
  assert.equal(db.movements.find((m) => m.type === 'receive').expiry, '2027-04-15');
  assert.equal(db.movements.every((m) => m.date === TODAY), true);
});

test('re-importing the same stock file changes nothing; a new count books only the difference', () => {
  const db = createEmptyDb();
  importProductsCsv(db, LEGACY_CSV, { today: TODAY });
  const n = db.movements.length;
  const again = importProductsCsv(db, LEGACY_CSV, { today: TODAY });
  assert.equal(again.stockSet, 0);
  assert.equal(db.movements.length, n);
  const recount = importProductsCsv(db, LEGACY_CSV.replace(';8;28;', ';5;28;'), { today: TODAY });
  assert.equal(recount.stockSet, 1);
  const ctx = buildContext(db, { today: TODAY });
  assert.equal(ctx.stockOf(db.products[0].id), 5);
});

test('invalid stock value rejects the whole product import', () => {
  const db = createEmptyDb();
  const r = importProductsCsv(db, 'name;barcode;stock\nA;4000000000011;5\nB;4000000000028;-2', { today: TODAY });
  assert.deepEqual(r.errors, [{ line: 3, code: 'stock_invalid' }]);
  assert.equal(db.products.length, 0);
  assert.equal(db.movements.length, 0);
});
