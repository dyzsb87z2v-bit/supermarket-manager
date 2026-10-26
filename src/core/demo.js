// Deterministic FAKE data for trying out the app. Barcodes use the EAN "200-299" in-store range,
// suppliers/names are invented. This data lives only in the separate "demo" workspace.
import { addDays } from './dates.js';
import { createEmptyDb, newId } from './model.js';

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SUPPLIERS = [
  { name: 'DEMO Großhandel A', phone: '000 000001', leadTimeDays: 2 },
  { name: 'DEMO Frischdienst B', phone: '000 000002', leadTimeDays: 1 },
  { name: 'DEMO Import C', phone: '000 000003', leadTimeDays: 5 },
];

// [nameDe, nameTr, category, supplierIdx, unit, buyCents, sellCents, minStock, packSize, avgDaily, shelfLifeDays|null]
const PRODUCTS = [
  ['Weißkäse 400g', 'Beyaz peynir 400g', 'Milchprodukte', 1, 'Stk', 189, 279, 12, 6, 9, 21],
  ['Joghurt 1kg', 'Yoğurt 1kg', 'Milchprodukte', 1, 'Stk', 129, 199, 10, 6, 11, 14],
  ['Ayran 250ml', 'Ayran 250ml', 'Getränke', 1, 'Stk', 35, 69, 24, 24, 20, 30],
  ['Fladenbrot', 'Ekmek', 'Backwaren', 1, 'Stk', 45, 89, 20, 10, 40, 2],
  ['Sucuk 250g', 'Sucuk 250g', 'Fleisch', 0, 'Stk', 249, 369, 8, 5, 7, 45],
  ['Bulgur 1kg', 'Bulgur 1kg', 'Trockenware', 2, 'Stk', 89, 149, 12, 10, 6, null],
  ['Rote Linsen 1kg', 'Kırmızı mercimek 1kg', 'Trockenware', 2, 'Stk', 119, 189, 12, 10, 5, null],
  ['Kichererbsen 1kg', 'Nohut 1kg', 'Trockenware', 2, 'Stk', 129, 199, 10, 10, 3, null],
  ['Weiße Bohnen 1kg', 'Kuru fasulye 1kg', 'Trockenware', 2, 'Stk', 139, 219, 10, 10, 3, null],
  ['Reis 5kg', 'Pirinç 5kg', 'Trockenware', 0, 'Stk', 599, 849, 6, 4, 3, null],
  ['Nudeln 500g', 'Makarna 500g', 'Trockenware', 0, 'Stk', 45, 79, 30, 20, 14, null],
  ['Zucker 1kg', 'Şeker 1kg', 'Trockenware', 0, 'Stk', 79, 119, 20, 12, 8, null],
  ['Mehl 2kg', 'Un 2kg', 'Trockenware', 0, 'Stk', 99, 159, 12, 10, 5, null],
  ['Olivenöl 1l', 'Zeytinyağı 1l', 'Öl & Essig', 2, 'Stk', 599, 899, 8, 6, 4, 300],
  ['Sonnenblumenöl 1l', 'Ayçiçek yağı 1l', 'Öl & Essig', 0, 'Stk', 159, 229, 12, 6, 9, 300],
  ['Tomatenmark 700g', 'Salça 700g', 'Konserven', 2, 'Stk', 189, 279, 10, 12, 6, 400],
  ['Paprikamark 700g', 'Biber salçası 700g', 'Konserven', 2, 'Stk', 199, 299, 8, 12, 4, 400],
  ['Oliven schwarz 500g', 'Siyah zeytin 500g', 'Konserven', 2, 'Stk', 229, 349, 8, 6, 4, 200],
  ['Schwarzer Tee 500g', 'Siyah çay 500g', 'Tee & Kaffee', 2, 'Stk', 449, 649, 10, 6, 5, null],
  ['Türkischer Kaffee 250g', 'Türk kahvesi 250g', 'Tee & Kaffee', 2, 'Stk', 349, 499, 6, 6, 3, 240],
  ['Datteln 500g', 'Hurma 500g', 'Süßwaren', 2, 'Stk', 249, 399, 6, 6, 2, 150],
  ['Halva 400g', 'Helva 400g', 'Süßwaren', 2, 'Stk', 199, 319, 6, 6, 2, 180],
  ['Lokum 250g', 'Lokum 250g', 'Süßwaren', 2, 'Stk', 159, 259, 6, 12, 3, 180],
  ['Baklava 500g', 'Baklava 500g', 'Süßwaren', 1, 'Stk', 599, 899, 4, 4, 3, 6],
  ['Sonnenblumenkerne 500g', 'Ayçekirdeği 500g', 'Snacks', 0, 'Stk', 139, 219, 10, 10, 6, 180],
  ['Mineralwasser 1,5l', 'Su 1,5l', 'Getränke', 0, 'Stk', 25, 49, 36, 12, 30, null],
  ['Cola 1l', 'Kola 1l', 'Getränke', 0, 'Stk', 69, 119, 24, 12, 12, 180],
  ['Tomaten', 'Domates', 'Obst & Gemüse', 1, 'kg', 140, 249, 15, 0.5, 14, 6],
  ['Gurken', 'Salatalık', 'Obst & Gemüse', 1, 'kg', 100, 189, 10, 0.5, 9, 6],
  ['Petersilie Bund', 'Maydanoz demet', 'Obst & Gemüse', 1, 'Stk', 25, 59, 15, 10, 16, 4],
  ['Zitronen', 'Limon', 'Obst & Gemüse', 1, 'kg', 150, 279, 6, 0.5, 4, 14],
  ['Frische Hähnchenbrust', 'Taze tavuk göğsü', 'Fleisch', 1, 'kg', 580, 849, 8, 1, 6, 5],
];

/** Builds a demo database with ~60 days of fake history ending at `today`. */
export function generateDemoDb(today, seed = 42) {
  const rand = rng(seed);
  const db = createEmptyDb({ isDemo: true });
  db.settings.shopName = 'DEMO Markt (Beispieldaten)';
  db.suppliers = SUPPLIERS.map((s) => ({ id: newId('s'), note: 'Erfundener Lieferant', ...s }));
  const HISTORY = 60;
  PRODUCTS.forEach((row, i) => {
    const [nameDe, nameTr, category, sIdx, unit, buy, sell, minStock, packSize, avgDaily, shelf] = row;
    const product = {
      id: newId('p'), createdAt: addDays(today, -HISTORY), nameDe, nameTr,
      barcode: `2000000${String(i + 1).padStart(5, '0')}`.slice(0, 13).padEnd(13, '0'),
      category, supplierId: db.suppliers[sIdx].id, unit, buyPriceCents: buy, sellPriceCents: sell,
      minStock, packSize, active: true,
    };
    db.products.push(product);
    const base = { branchId: 'main', productId: product.id, note: '' };
    const step = unit === 'kg' ? 0.5 : 1;
    let stock = 0;
    const push = (m) => db.movements.push({ id: newId('m'), unitPriceCents: null, unitCostCents: null, expiry: null, ...base, ...m });
    const restock = (date) => {
      const qty = Math.max(packSize, Math.ceil((avgDaily * 10) / packSize) * packSize);
      push({ date, type: 'receive', qty, unitCostCents: buy, expiry: shelf ? addDays(date, shelf) : null });
      stock += qty;
    };
    restock(addDays(today, -HISTORY));
    for (let d = HISTORY - 1; d >= 0; d -= 1) {
      const date = addDays(today, -d);
      const weekend = [5, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay());
      let qty = Math.round(avgDaily * (0.6 + rand() * 0.8) * (weekend ? 1.4 : 1) / step) * step;
      qty = Math.min(qty, stock);
      if (qty > 0) { push({ date, type: 'sale', qty, unitPriceCents: sell, unitCostCents: buy }); stock -= qty; }
      if (shelf && shelf <= 7 && rand() < 0.08 && stock >= step) { push({ date, type: 'waste', qty: step, unitCostCents: buy }); stock -= step; }
      // Leave some products running low / sold out on purpose so alerts and suggestions show up.
      const keepLow = i % 5 === 0 && d < 12;
      if (stock <= minStock && !keepLow && d > 0) restock(date);
    }
  });
  return db;
}
