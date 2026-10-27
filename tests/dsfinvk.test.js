import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { importDsfinvkLines } from '../src/core/dsfinvk.js';
import { listZip, readZipEntry, readLinesCsvFromZip, decodeText } from '../src/core/zip.js';
import { buildContext } from '../src/core/context.js';
import { createEmptyDb, normalizeDb } from '../src/core/model.js';
import { upsertProduct } from '../src/core/inventory.js';
import { mkDb, move, TODAY } from './helpers.js';

const HEADER = 'Z_KASSE_ID;Z_ERSTELLUNG;Z_NR;BON_ID;POS_ZEILE;GV_TYP;P_STORNO;ART_NR;GTIN;ARTIKELTEXT;MENGE;FAKTOR;EINHEIT;STK_BR';
const row = (o) => [o.kasse ?? 'K1', o.z ?? '2026-03-30T22:05:00+02:00', o.nr ?? '12', o.bon ?? 'B1', o.pos ?? '1', o.typ ?? 'Umsatz', o.storno ?? '0',
  o.art ?? '', o.gtin ?? '4001234567890', o.text ?? 'Joghurt', o.menge ?? '1', o.faktor ?? '1', o.einheit ?? '', o.preis ?? '1.99'].join(';');
const file = (...rows) => `${HEADER}\r\n${rows.join('\r\n')}\r\n`;
const stockOf = (db, p) => buildContext(db, { today: TODAY }).stockOf(p.id);

function shopWithStock(qty = 100) {
  const { db, p } = mkDb();
  move(db, p, 'receive', qty, '2026-03-01');
  return { db, p };
}

test('DSFinV-K lines.csv: sales are booked per day and product with the register price', () => {
  const { db, p } = shopWithStock();
  const r = importDsfinvkLines(db, file(row({ menge: '3' }), row({ bon: 'B2', menge: '2', preis: '1,99' }), row({ bon: 'B3', menge: '1', preis: '1.49' })));
  assert.deepEqual([r.ok, r.movements, r.closings.imported], [true, 1, 1]);
  assert.equal(stockOf(db, p), 94);
  const sale = db.movements.find((m) => m.type === 'sale');
  assert.equal(sale.date, '2026-03-30', 'date comes from Z_ERSTELLUNG as written');
  assert.equal(sale.qty, 6);
  assert.equal(sale.unitPriceCents, Math.round((199 * 5 + 149) / 6), 'weighted average of the register prices');
});

test('DSFinV-K: only GV_TYP Umsatz counts; cancelled positions and deposits are skipped and reported', () => {
  const { db, p } = shopWithStock();
  const r = importDsfinvkLines(db, file(row({ menge: '2' }), row({ typ: 'Pfand', menge: '1', gtin: '' }), row({ typ: 'Rabatt', menge: '1', gtin: '' }), row({ storno: '1', menge: '5' })));
  assert.ok(r.ok);
  assert.deepEqual(r.skipped, { nonSale: 2, storno: 1, unknown: 0 });
  assert.equal(stockOf(db, p), 98);
});

test('DSFinV-K: returns (negative MENGE) are netted; a net return increases stock instead', () => {
  const { db, p } = shopWithStock();
  assert.ok(importDsfinvkLines(db, file(row({ menge: '5' }), row({ bon: 'B2', menge: '-2' }))).ok);
  assert.equal(stockOf(db, p), 97);
  const only = shopWithStock(10);
  assert.ok(importDsfinvkLines(only.db, file(row({ nr: '99', menge: '-3' }))).ok);
  assert.equal(stockOf(only.db, only.p), 13);
  assert.equal(only.db.movements.at(-1).type, 'adjust');
});

test('DSFinV-K: each closing is imported once - re-reading the same file changes nothing', () => {
  const { db, p } = shopWithStock();
  const f = file(row({ menge: '4' }), row({ nr: '13', z: '2026-03-31T21:50:00+02:00', menge: '1' }));
  const first = importDsfinvkLines(db, f);
  assert.deepEqual([first.closings.imported, first.closings.skipped], [2, 0]);
  const n = db.movements.length;
  const again = importDsfinvkLines(db, f);
  assert.deepEqual([again.ok, again.movements, again.closings.imported, again.closings.skipped], [true, 0, 0, 2]);
  assert.equal(db.movements.length, n);
  assert.equal(stockOf(db, p), 95);
  const mixed = importDsfinvkLines(db, f + row({ nr: '14', z: '2026-04-01T20:00:00+02:00', menge: '2' }) + '\r\n');
  assert.deepEqual([mixed.closings.imported, mixed.closings.skipped], [1, 2]);
  assert.equal(stockOf(db, p), 93);
});

test('DSFinV-K: product match by GTIN, falls back to ART_NR; unknown products abort unless skipping is chosen', () => {
  const { db, p } = shopWithStock();
  assert.ok(importDsfinvkLines(db, file(row({ gtin: '', art: '4001234567890', menge: '1' }))).ok, 'ART_NR fallback');
  const before = db.movements.length;
  const strict = importDsfinvkLines(db, file(row({ nr: '20', menge: '1' }), row({ nr: '20', gtin: '9999999999999', text: 'Neu', menge: '1' })));
  assert.equal(strict.ok, false);
  assert.deepEqual(strict.errors.map((e) => [e.line, e.code, e.detail]), [[3, 'product_not_found', '9999999999999']]);
  assert.equal(db.movements.length, before, 'nothing booked on error');
  assert.deepEqual(db.meta.importedClosings.filter((k) => k.includes('#20')), [], 'a failed import does not mark the closing as done');
  const lenient = importDsfinvkLines(db, file(row({ nr: '20', menge: '1' }), row({ nr: '20', gtin: '9999999999999', text: 'Neu', menge: '1' })), { skipUnknown: true });
  assert.ok(lenient.ok);
  assert.deepEqual([lenient.skipped.unknown, lenient.unknownItems], [1, ['Neu']]);
});

test('DSFinV-K: unit mismatch and insufficient stock reject the whole file', () => {
  const { db, p } = shopWithStock(2);
  const kg = importDsfinvkLines(db, file(row({ einheit: 'g', menge: '500' })));
  assert.equal(kg.errors[0].code, 'unit_mismatch');
  const stock = importDsfinvkLines(db, file(row({ menge: '1' }), row({ nr: '31', menge: '5' })));
  assert.equal(stock.ok, false);
  assert.equal(stock.errors[0].code, 'insufficient_stock');
  assert.equal(stockOf(db, p), 2);
  assert.equal(db.meta.importedClosings.length, 0);
});

test('DSFinV-K: kg products accept EINHEIT kg with decimal MENGE; Stück products reject fractions', () => {
  const db = createEmptyDb();
  const tomato = upsertProduct(db, { nameDe: 'Tomaten', barcode: '4000000000011', unit: 'kg', sellPriceCents: 249 }).product;
  move(db, tomato, 'receive', 20, '2026-03-01');
  assert.ok(importDsfinvkLines(db, file(row({ gtin: '4000000000011', einheit: 'kg', menge: '1,250', preis: '2.49000' }))).ok);
  assert.equal(stockOf(db, tomato), 18.75);
  const { db: db2 } = shopWithStock();
  assert.equal(importDsfinvkLines(db2, file(row({ menge: '1.5' }))).errors[0].code, 'qty_not_integer');
});

test('DSFinV-K: not a lines.csv / empty / bad date', () => {
  const { db } = shopWithStock();
  assert.equal(importDsfinvkLines(db, 'a;b\n1;2').errors[0].code, 'dsfinvk_columns_missing');
  assert.equal(importDsfinvkLines(db, `${HEADER}\n`).errors[0].code, 'no_rows');
  assert.equal(importDsfinvkLines(db, file(row({ z: 'gestern' }))).errors[0].code, 'date_invalid');
});

test('importedClosings survives backup validation and is part of every new database', () => {
  assert.deepEqual(createEmptyDb().meta.importedClosings, []);
  const db = createEmptyDb();
  db.meta.importedClosings = [1];
  assert.throws(() => normalizeDb(db), /invalid_data/);
});

/* ---------- ZIP reader ---------- */

function crc32(buf) {
  let c; let crc = 0xffffffff;
  for (const b of buf) { c = (crc ^ b) & 0xff; for (let k = 0; k < 8; k += 1) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1; crc = (crc >>> 8) ^ c; }
  return (crc ^ 0xffffffff) >>> 0;
}
function makeZip(files, { deflate }) {
  const parts = []; const central = []; let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const raw = Buffer.from(content);
    const data = deflate ? zlib.deflateRawSync(raw) : raw;
    const nameBuf = Buffer.from(name);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(crc32(raw), 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(nameBuf.length, 26);
    const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(deflate ? 8 : 0, 10);
    cd.writeUInt32LE(crc32(raw), 16); cd.writeUInt32LE(data.length, 20); cd.writeUInt32LE(raw.length, 24); cd.writeUInt16LE(nameBuf.length, 28); cd.writeUInt32LE(offset, 42);
    parts.push(local, nameBuf, data); central.push(cd, nameBuf); offset += 30 + nameBuf.length + data.length;
  }
  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(Object.keys(files).length, 8); eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12); eocd.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...parts, cdBuf, eocd]));
}

for (const deflate of [false, true]) {
  test(`ZIP reader finds lines.csv in a DSFinV-K archive (${deflate ? 'deflate' : 'stored'}) and the import works end-to-end`, async () => {
    const csv = file(row({ menge: '2', text: 'Käse ü' }));
    const zip = makeZip({ 'export/index.xml': '<x/>', 'export/transactions.csv': 'a;b', 'export/lines.csv': csv }, { deflate });
    assert.deepEqual(listZip(zip).map((e) => e.name), ['export/index.xml', 'export/transactions.csv', 'export/lines.csv']);
    assert.equal(await readLinesCsvFromZip(zip), csv);
    const { db, p } = shopWithStock();
    assert.ok(importDsfinvkLines(db, await readLinesCsvFromZip(zip)).ok);
    assert.equal(stockOf(db, p), 98);
  });
}

test('ZIP reader: missing lines.csv, garbage and Windows-1252 text are handled', async () => {
  await assert.rejects(() => readLinesCsvFromZip(makeZip({ 'a.csv': 'x' }, { deflate: false })), /zip_unsupported/);
  assert.throws(() => listZip(new Uint8Array([1, 2, 3, 4])), /zip_unsupported/);
  assert.equal(decodeText(Uint8Array.from([0x4b, 0xe4, 0x73, 0x65])), 'Käse', 'invalid UTF-8 falls back to Windows-1252');
  assert.equal(decodeText(new TextEncoder().encode('Käse')), 'Käse');
});
