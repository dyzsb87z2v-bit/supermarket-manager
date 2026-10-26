import { h, download, copyText } from './dom.js';
import { fa, errorText } from './i18n.js';
import { todayStr, addDays, parseDateInput } from '../core/dates.js';
import { buildContext } from '../core/context.js';
import { MOVEMENT_TYPES, UNITS, categoriesOf, createEmptyDb } from '../core/model.js';
import { addBranch, addMovement, batchesOf, deleteMovement, upsertProduct, upsertSupplier } from '../core/inventory.js';
import { buildOrderSuggestions, formatOrderText } from '../core/forecast.js';
import { expiryAlerts, lowStockAlerts } from '../core/alerts.js';
import { dailyReport, weeklyReport } from '../core/reports.js';
import { exportBackup, exportMovementsCsv, exportProductsCsv, exportReportCsv, importMovementsCsv, importProductsCsv, parseBackup } from '../core/io.js';
import { generateDemoDb } from '../core/demo.js';
import { createStore, indexedDbBackend, memoryBackend } from '../core/store.js';
import { formatEuro, formatQty, parseMoneyToCents, parseNumber } from '../core/numbers.js';

const T = fa;
const root = document.getElementById('app');

const state = {
  store: null,
  ws: 'real',
  db: null,
  branchId: null,
  tab: 'home',
  ordersSub: 'suggest',
  reportKind: 'daily',
  reportDate: todayStr(),
  productQuery: '',
  draft: { productId: null, type: 'sale', date: todayStr() },
  saveError: null,
  storageKind: 'memory',
};

/* ---------- persistence ---------- */

let saveChain = Promise.resolve();
function persist() {
  const { ws, db } = state;
  saveChain = saveChain
    .then(() => state.store.save(ws, db))
    .then(() => { state.saveError = null; })
    .catch((e) => { state.saveError = e.message || String(e); renderBanners(); });
  return saveChain;
}

function lsGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
function lsSet(key, v) { try { localStorage.setItem(key, v); } catch { /* storage may be blocked */ } }

async function loadWorkspace(ws) {
  let db = await state.store.load(ws);
  if (ws === 'demo' && db.products.length === 0) {
    db = generateDemoDb(todayStr());
    await state.store.save('demo', db);
  }
  state.ws = ws;
  state.db = db;
  state.branchId = db.branches[0].id;
  state.draft = { productId: null, type: 'sale', date: todayStr() };
  lsSet('smm:ws', ws);
}

/* ---------- small UI helpers ---------- */

let toastTimer;
function toast(msg) {
  document.querySelector('.toast')?.remove();
  document.body.append(h('div', { class: 'toast', role: 'status', text: msg }));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => document.querySelector('.toast')?.remove(), 2600);
}

function openSheet(title, body) {
  const bg = h('div', { class: 'sheet-bg' });
  const close = () => { bg.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  bg.addEventListener('click', (e) => { if (e.target === bg) close(); });
  bg.append(h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('h2', {}, h('span', { text: title }), h('button', { class: 'small', onclick: close, text: T.close })), body));
  document.body.append(bg);
  return { close };
}

const field = (label, input, hint) => h('label', { class: 'f' }, h('span', { text: label }), input, hint ? h('span', { class: 'hint', text: hint }) : null);
const errList = (codes) => h('ul', { class: 'errors', role: 'alert' }, codes.map((c) => h('li', { text: errorText(c) })));
const pname = (p) => p.nameDe || p.nameTr;
const eurIn = (c) => (c === null || c === undefined ? '' : (c / 100).toFixed(2).replace('.', ','));
const qtyIn = (q) => String(q).replace('.', ',');
const ctx = () => buildContext(state.db, { today: todayStr(), branchId: state.branchId });

function nameBlock(p) {
  return h('div', { class: 'grow' },
    h('div', { class: 'name ltr', text: p.nameDe || p.nameTr }),
    p.nameDe && p.nameTr ? h('div', { class: 'sub ltr', text: p.nameTr }) : null);
}

function importReport(res, container) {
  container.replaceChildren();
  if (res.ok) {
    const parts = [];
    if (res.created !== undefined) parts.push(`${res.created} کالای جدید، ${res.updated} کالای به‌روزشده`);
    if (res.imported !== undefined) parts.push(`${res.imported} رکورد ثبت شد`);
    container.append(h('p', { class: 'banner', text: `انجام شد: ${parts.join(' / ')}` }));
  } else {
    container.append(
      h('p', { class: 'banner bad', text: 'هیچ چیزی وارد نشد، چون فایل خطا دارد. خطاها را در فایل اصلاح و دوباره امتحان کنید:' }),
      h('ul', { class: 'errors' }, res.errors.slice(0, 25).map((e) =>
        h('li', { text: `ردیف ${e.line}: ${errorText(e.code)}${e.detail ? ` (${e.detail})` : ''}` }))),
      res.errors.length > 25 ? h('p', { class: 'muted', text: `و ${res.errors.length - 25} خطای دیگر…` }) : null);
  }
  if (res.unknownHeaders?.length) {
    container.append(h('p', { class: 'muted', text: `ستون‌های ناشناخته نادیده گرفته شد: ${res.unknownHeaders.join(', ')}` }));
  }
}

function filePicker(label, onText) {
  const input = h('input', { type: 'file', accept: '.csv,.txt,.json,text/csv,application/json', hidden: true });
  input.addEventListener('change', async () => {
    const f = input.files?.[0];
    if (f) await onText(await f.text(), f.name);
    input.value = '';
  });
  return h('span', {}, input, h('button', { onclick: () => input.click(), text: label }));
}

/* ---------- screens ---------- */

function screenHome() {
  const c = ctx();
  const db = state.db;
  const rep = dailyReport(db, todayStr(), { branchId: state.branchId, today: todayStr() });
  const low = lowStockAlerts(c);
  const exp = expiryAlerts(c);
  const orders = buildOrderSuggestions(c);
  const orderLines = orders.reduce((n, g) => n + g.lines.length, 0);
  const out = h('main');

  if (db.products.length === 0) {
    out.append(h('div', { class: 'card' },
      h('h2', { text: 'شروع کار' }),
      h('p', { text: 'هنوز کالایی ثبت نکرده‌اید. سه راه دارید:' }),
      h('div', { class: 'btns' },
        h('button', { class: 'primary', onclick: () => openProductSheet(null), text: 'ثبت اولین کالا' }),
        h('button', { onclick: () => { state.tab = 'settings'; render(); }, text: 'ورود از فایل CSV' }),
        state.ws === 'real' ? h('button', { onclick: async () => { await loadWorkspace('demo'); render(); }, text: 'دیدن نسخهٔ نمونه' }) : null)));
  }

  out.append(h('div', { class: 'grid2' },
    h('div', { class: 'stat' }, h('b', { class: 'num', text: formatEuro(rep.revenueCents) }), h('span', { text: 'فروش امروز' })),
    h('div', { class: 'stat' }, h('b', { class: 'num', text: formatQty(rep.units) }), h('span', { text: 'تعداد فروش امروز' })),
    h('div', { class: 'stat' }, h('b', { class: 'num', text: String(low.length) }), h('span', { text: 'کالای کم‌موجود/تمام‌شده' })),
    h('div', { class: 'stat' }, h('b', { class: 'num', text: String(exp.length) }), h('span', { text: 'هشدار تاریخ انقضا' }))));

  const lastBackup = db.meta.lastBackupAt;
  if (state.ws === 'real' && db.movements.length > 0 && (!lastBackup || addDays(todayStr(), -7) > lastBackup)) {
    out.append(h('div', { class: 'banner warn' },
      h('p', { text: 'داده‌ها فقط داخل مرورگر همین گوشی ذخیره می‌شوند. اگر مرورگر پاک شود یا گوشی عوض شود از بین می‌روند. یک فایل پشتیبان بگیرید.' }),
      h('button', { class: 'small', onclick: () => doBackup(), text: 'دریافت پشتیبان' })));
  }

  const listCard = (title, items, render1, more) => h('div', { class: 'card' }, h('h2', { text: title }),
    items.length === 0 ? h('p', { class: 'muted', text: 'مورد خاصی نیست.' }) : items.slice(0, 5).map(render1),
    items.length > 5 ? h('p', { class: 'muted', text: `و ${items.length - 5} مورد دیگر…` }) : null, more);

  out.append(
    listCard('کمبود موجودی', low, (a) => h('div', { class: 'row' }, nameBlock(a.product),
      h('span', { class: 'num', text: `${formatQty(a.stock)} ${a.product.unit}` }), h('span', { class: `chip ${a.level}`, text: T.level[a.level] }))),
    listCard('نزدیک انقضا', exp, (a) => h('div', { class: 'row' }, nameBlock(a.product),
      h('span', { class: 'num', text: `${formatQty(a.qty)} ${a.product.unit}` }),
      h('span', { class: `chip ${a.level}`, text: a.daysLeft < 0 ? T.level.expired : `${a.daysLeft} روز` }))),
    h('div', { class: 'card' }, h('h2', { text: 'پیشنهاد سفارش' }),
      h('p', { text: orderLines ? `${orderLines} کالا نیاز به سفارش دارد.` : 'فعلاً سفارشی لازم نیست.' }),
      orderLines ? h('button', { onclick: () => { state.tab = 'orders'; render(); }, text: 'دیدن پیشنهاد' }) : null));
  return out;
}

/* products */

function stockChip(p, c) {
  const s = c.stockOf(p.id);
  if (c.movementsOf(p.id).length && s <= 0) return h('span', { class: 'chip out', text: T.level.out });
  if (p.minStock > 0 && s <= p.minStock) return h('span', { class: 'chip low', text: T.level.low });
  return null;
}

function screenProducts() {
  const c = ctx();
  const list = h('div', { class: 'card' });
  const draw = () => {
    const needle = state.productQuery.trim().toLowerCase();
    const items = state.db.products.filter((p) => !needle || [p.nameDe, p.nameTr, p.barcode, p.category].join(' ').toLowerCase().includes(needle));
    const nodes = items.length === 0
      ? [h('p', { class: 'muted', text: state.db.products.length ? 'موردی پیدا نشد.' : T.noData })]
      : items.slice(0, 200).map((p) => h('button', { class: 'row', onclick: () => openProductSheet(p) },
        nameBlock(p),
        h('div', {},
          h('div', { class: 'num', text: `${formatQty(c.stockOf(p.id))} ${p.unit}` }),
          h('div', { class: 'sub num', text: formatEuro(p.sellPriceCents) })),
        stockChip(p, c), p.active ? null : h('span', { class: 'chip', text: 'غیرفعال' })));
    list.replaceChildren(...nodes);
    if (items.length > 200) list.append(h('p', { class: 'muted', text: 'فقط ۲۰۰ مورد اول نمایش داده شد؛ جستجو کنید.' }));
  };
  const search = h('input', { type: 'search', placeholder: T.search, value: state.productQuery, 'aria-label': T.search,
    oninput: (e) => { state.productQuery = e.target.value; draw(); } });
  draw();
  return h('main', {}, search, list, h('button', { class: 'primary fab', 'aria-label': 'کالای جدید', onclick: () => openProductSheet(null), text: '+' }));
}

function openProductSheet(product) {
  const db = state.db;
  const isNew = !product;
  const p = product ?? { nameDe: '', nameTr: '', barcode: '', category: '', supplierId: null, unit: 'Stk', buyPriceCents: null, sellPriceCents: null, minStock: 0, packSize: 1, active: true };
  const f = {
    nameDe: h('input', { value: p.nameDe, dir: 'auto', autocomplete: 'off' }),
    nameTr: h('input', { value: p.nameTr, dir: 'auto', autocomplete: 'off' }),
    barcode: h('input', { value: p.barcode, inputMode: 'numeric', dir: 'ltr', autocomplete: 'off' }),
    category: h('input', { value: p.category, list: 'cats', dir: 'auto' }),
    supplier: h('select', {}, h('option', { value: '', text: '— بدون تأمین‌کننده —' }),
      db.suppliers.map((s) => h('option', { value: s.id, text: s.name, selected: s.id === p.supplierId }))),
    unit: h('select', {}, UNITS.map((u) => h('option', { value: u, text: T.units[u], selected: u === p.unit }))),
    buy: h('input', { value: eurIn(p.buyPriceCents), inputMode: 'decimal', dir: 'ltr', placeholder: '0,00' }),
    sell: h('input', { value: eurIn(p.sellPriceCents), inputMode: 'decimal', dir: 'ltr', placeholder: '0,00' }),
    min: h('input', { value: qtyIn(p.minStock), inputMode: 'decimal', dir: 'ltr' }),
    pack: h('input', { value: qtyIn(p.packSize), inputMode: 'decimal', dir: 'ltr' }),
    active: h('input', { type: 'checkbox', checked: p.active }),
  };
  const errBox = h('div');
  const margin = h('p', { class: 'muted' });
  const updMargin = () => {
    const b = parseMoneyToCents(f.buy.value);
    const s = parseMoneyToCents(f.sell.value);
    margin.textContent = b > 0 || s > 0 ? (Number.isFinite(b) && Number.isFinite(s) && s > 0 && b !== null
      ? `حاشیهٔ سود خام (روی قیمت فروش): ${(((s - b) / s) * 100).toFixed(1)}٪ — مالیات بر ارزش افزوده در نظر گرفته نشده` : '') : '';
  };
  f.buy.addEventListener('input', updMargin); f.sell.addEventListener('input', updMargin); updMargin();

  const save = () => {
    const buy = parseMoneyToCents(f.buy.value);
    const sell = parseMoneyToCents(f.sell.value);
    const min = parseNumber(f.min.value);
    const pack = parseNumber(f.pack.value);
    const pre = [];
    if (Number.isNaN(buy)) pre.push('buy_price_invalid');
    if (Number.isNaN(sell)) pre.push('sell_price_invalid');
    if (Number.isNaN(min)) pre.push('min_stock_invalid');
    if (Number.isNaN(pack)) pre.push('pack_size_invalid');
    if (pre.length) { errBox.replaceChildren(errList(pre)); return; }
    const res = upsertProduct(db, {
      nameDe: f.nameDe.value, nameTr: f.nameTr.value, barcode: f.barcode.value, category: f.category.value,
      supplierId: f.supplier.value || null, unit: f.unit.value, buyPriceCents: buy, sellPriceCents: sell,
      minStock: min ?? 0, packSize: pack ?? 1, active: f.active.checked,
    }, product?.id ?? null);
    if (!res.ok) { errBox.replaceChildren(errList(res.errors)); return; }
    persist(); sheet.close(); toast('ذخیره شد'); render();
  };

  const c = ctx();
  const extra = [];
  if (!isNew) {
    const batches = batchesOf(c, product.id);
    extra.push(h('div', { class: 'card' },
      h('p', {}, `موجودی فعلی (شعبهٔ انتخاب‌شده): `, h('b', { class: 'num', text: `${formatQty(c.stockOf(product.id))} ${product.unit}` })),
      batches.some((b) => b.expiry) ? h('div', {}, batches.map((b) => h('div', { class: 'sub num', text: `${formatQty(b.qty)} ${product.unit} — ${b.expiry ?? 'بدون تاریخ انقضا'}` }))) : null,
      h('div', { class: 'btns' },
        h('button', { class: 'small', onclick: () => { state.draft.productId = product.id; state.tab = 'stock'; sheet.close(); render(); }, text: 'ثبت ورود/فروش' }))));
  }
  const body = h('div', { class: 'form' }, ...extra,
    field('نام آلمانی (Deutsch)', f.nameDe), field('نام ترکی (Türkçe)', f.nameTr),
    field('بارکد (EAN)', f.barcode, 'فقط عدد، ۶ تا ۱۴ رقم؛ اختیاری'),
    field('دسته‌بندی', f.category), h('datalist', { id: 'cats' }, categoriesOf(db).map((x) => h('option', { value: x }))),
    field('تأمین‌کننده', f.supplier), field('واحد', f.unit),
    h('div', { class: 'grid2' }, field('قیمت خرید (€)', f.buy), field('قیمت فروش (€)', f.sell)), margin,
    h('div', { class: 'grid2' }, field('حداقل موجودی', f.min, 'زیر این مقدار هشدار می‌دهد'), field('اندازهٔ بسته سفارش', f.pack, 'سفارش به مضرب این عدد گرد می‌شود')),
    h('label', { class: 'row' }, f.active, h('span', { text: 'فعال (در پیشنهاد سفارش و هشدارها دیده شود)' })),
    errBox,
    h('div', { class: 'btns' },
      h('button', { class: 'primary', onclick: save, text: T.save }),
      !isNew && !db.movements.some((m) => m.productId === product.id)
        ? h('button', { class: 'danger', onclick: () => {
          if (!confirm('این کالا حذف شود؟')) return;
          db.products.splice(db.products.indexOf(product), 1); persist(); sheet.close(); render();
        }, text: 'حذف کالا' }) : null));
  const sheet = openSheet(isNew ? 'کالای جدید' : 'ویرایش کالا', body);
}

/* stock */

function screenStock() {
  const db = state.db;
  const c = ctx();
  const d = state.draft;
  const selected = () => db.products.find((p) => p.id === d.productId) ?? null;

  const search = h('input', { type: 'search', placeholder: T.search, 'aria-label': T.search, autocomplete: 'off' });
  const results = h('div');
  const chosen = h('div');
  const qty = h('input', { inputMode: 'decimal', dir: 'ltr', placeholder: '0', 'aria-label': 'مقدار' });
  const date = h('input', { type: 'date', value: d.date, dir: 'ltr', onchange: (e) => { d.date = e.target.value; } });
  const expiry = h('input', { type: 'date', dir: 'ltr' });
  const cost = h('input', { inputMode: 'decimal', dir: 'ltr', placeholder: 'اختیاری' });
  const note = h('input', { placeholder: 'اختیاری' });
  const extraReceive = h('div', { class: 'grid2' }, field('تاریخ انقضا', expiry), field('قیمت خرید واحد (€)', cost));
  const errBox = h('div');
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'نوع رکورد' });

  const drawSeg = () => {
    seg.replaceChildren(...MOVEMENT_TYPES.map((t) => h('button', { 'aria-pressed': d.type === t ? 'true' : 'false',
      onclick: () => { d.type = t; drawSeg(); } , text: T.moveTypes[t] })));
    extraReceive.hidden = d.type !== 'receive';
  };
  const drawChosen = () => {
    const p = selected();
    chosen.replaceChildren(p ? h('div', { class: 'card' }, h('div', { class: 'row' }, nameBlock(p),
      h('span', { class: 'num', text: `${formatQty(c.stockOf(p.id))} ${p.unit}` }),
      h('button', { class: 'small', onclick: () => { d.productId = null; drawChosen(); search.focus(); }, text: 'تغییر' }))) : '');
    search.hidden = Boolean(p);
    if (p && d.type === 'receive' && !cost.value) cost.placeholder = eurIn(p.buyPriceCents) || 'اختیاری';
  };
  const drawResults = () => {
    const q = search.value.trim().toLowerCase();
    results.replaceChildren();
    if (!q || selected()) return;
    const exact = db.products.find((p) => p.barcode && p.barcode === q);
    const hits = exact ? [exact] : db.products.filter((p) => p.active && [p.nameDe, p.nameTr, p.barcode].join(' ').toLowerCase().includes(q)).slice(0, 6);
    results.append(...hits.map((p) => h('button', { class: 'row', onclick: () => { d.productId = p.id; search.value = ''; drawResults(); drawChosen(); qty.focus(); } },
      nameBlock(p), h('span', { class: 'num sub', text: `${formatQty(c.stockOf(p.id))} ${p.unit}` }))));
    if (!hits.length) results.append(h('p', { class: 'muted', text: 'کالایی پیدا نشد.' }));
  };
  search.addEventListener('input', drawResults);

  const submit = () => {
    const p = selected();
    if (!p) { errBox.replaceChildren(errList(['product_not_found'])); return; }
    const q = parseNumber(qty.value);
    const unitCost = parseMoneyToCents(cost.value);
    if (q === null || Number.isNaN(q)) { errBox.replaceChildren(errList(['qty_invalid'])); return; }
    if (Number.isNaN(unitCost)) { errBox.replaceChildren(errList(['price_invalid'])); return; }
    const res = addMovement(db, {
      productId: p.id, branchId: state.branchId, type: d.type, qty: q, date: date.value || todayStr(),
      expiry: d.type === 'receive' && expiry.value ? expiry.value : null, unitCostCents: d.type === 'receive' ? unitCost : null, note: note.value,
    });
    if (!res.ok) {
      errBox.replaceChildren(errList(res.errors), res.available !== undefined ? h('p', { class: 'muted', text: `موجودی فعلی: ${formatQty(res.available)} ${p.unit}` }) : '');
      return;
    }
    persist();
    d.productId = null;
    toast(`${T.moveTypes[d.type]} ثبت شد: ${pname(p)}`);
    render();
  };

  drawSeg(); drawChosen();
  const form = h('div', { class: 'card form' }, h('h2', { text: 'ثبت حرکت موجودی' }), search, results, chosen, seg,
    h('div', { class: 'grid2' }, field(d.type === 'adjust' ? 'مقدار (برای کم کردن منفی بنویسید)' : 'مقدار', qty), field('تاریخ', date)),
    extraReceive, field('یادداشت', note), errBox, h('button', { class: 'primary', onclick: submit, text: 'ثبت' }));

  const byId = new Map(db.products.map((p) => [p.id, p]));
  const recent = db.movements.filter((m) => m.branchId === state.branchId).slice(-20).reverse();
  const history = h('div', { class: 'card' }, h('h2', { text: 'آخرین رکوردها' }),
    recent.length === 0 ? h('p', { class: 'muted', text: T.noData }) : recent.map((m) => {
      const p = byId.get(m.productId);
      return h('div', { class: 'row' }, h('div', { class: 'grow' }, h('div', { class: 'name ltr', text: p ? pname(p) : '?' }),
        h('div', { class: 'sub num', text: `${m.date} · ${T.moveTypes[m.type]}${m.expiry ? ` · انقضا ${m.expiry}` : ''}` })),
        h('span', { class: 'num', text: `${m.type === 'sale' || m.type === 'waste' ? '−' : m.qty > 0 ? '+' : ''}${formatQty(m.qty)}` }),
        h('button', { class: 'small danger', 'aria-label': 'حذف رکورد', onclick: () => {
          if (!confirm('این رکورد حذف شود؟')) return;
          const r = deleteMovement(db, m.id);
          if (!r.ok) { toast(errorText(r.errors[0])); return; }
          persist(); render();
        }, text: '✕' }));
    }));
  return h('main', {}, form, history);
}

/* orders + suppliers */

function screenOrders() {
  const sub = h('div', { class: 'seg' },
    h('button', { 'aria-pressed': String(state.ordersSub === 'suggest'), onclick: () => { state.ordersSub = 'suggest'; render(); }, text: 'پیشنهاد سفارش' }),
    h('button', { 'aria-pressed': String(state.ordersSub === 'suppliers'), onclick: () => { state.ordersSub = 'suppliers'; render(); }, text: 'تأمین‌کنندگان' }));
  return h('main', {}, sub, state.ordersSub === 'suggest' ? suggestionsView() : suppliersView());
}

function suggestionsView() {
  const c = ctx();
  const groups = buildOrderSuggestions(c);
  const wrap = h('div', { class: 'form' }, h('p', { class: 'sugg-note',
    text: `فقط پیشنهاد است. برنامه هیچ سفارشی ارسال نمی‌کند؛ متن را کپی کنید و خودتان برای تأمین‌کننده بفرستید. محاسبه: میانگین فروش ${state.db.settings.salesWindowDays} روز اخیر × (زمان تحویل + ${state.db.settings.coverDays} روز پوشش) + حداقل موجودی − موجودی فعلی.` }));
  if (groups.length === 0) wrap.append(h('div', { class: 'card' }, h('p', { text: state.db.products.length ? 'فعلاً هیچ کالایی نیاز به سفارش ندارد.' : T.noData })));
  for (const g of groups) {
    const text = formatOrderText(g, { shopName: state.db.settings.shopName, date: todayStr() });
    wrap.append(h('div', { class: 'card' },
      h('h2', { text: g.supplier ? `${g.supplier.name} — تحویل ${g.supplier.leadTimeDays} روزه` : 'بدون تأمین‌کننده' }),
      g.lines.map((l) => h('div', { class: 'row' }, nameBlock(l.product),
        h('div', {}, h('div', { class: 'num', text: `${formatQty(l.suggestedQty)} ${l.product.unit}` }),
          h('div', { class: 'sub num', text: `موجودی ${formatQty(l.stock)} · میانگین ${formatQty(l.avgDaily)}/روز` })))),
      h('p', { class: 'muted num', text: `هزینهٔ تخمینی: ${formatEuro(g.estimatedCostCents)}${g.unknownCostLines ? ` (+ ${g.unknownCostLines} کالا بدون قیمت خرید)` : ''}` }),
      h('pre', { class: 'order', text }),
      h('div', { class: 'btns' },
        h('button', { class: 'primary', onclick: async () => toast((await copyText(text)) ? 'متن کپی شد' : 'کپی ناموفق بود'), text: 'کپی متن سفارش' }),
        navigator.share ? h('button', { onclick: () => navigator.share({ text }).catch(() => {}), text: 'اشتراک‌گذاری' }) : null,
        g.supplier?.phone ? h('a', { href: `tel:${g.supplier.phone.replace(/[^+\d]/g, '')}`, class: 'ltr' }, h('button', { text: 'تماس' })) : null)));
  }
  return wrap;
}

function suppliersView() {
  const db = state.db;
  return h('div', { class: 'card' }, h('h2', { text: 'تأمین‌کنندگان' }),
    db.suppliers.length === 0 ? h('p', { class: 'muted', text: T.noData }) : db.suppliers.map((s) => h('button', { class: 'row', onclick: () => openSupplierSheet(s) },
      h('div', { class: 'grow' }, h('div', { class: 'name ltr', text: s.name }), h('div', { class: 'sub ltr', text: s.phone })),
      h('span', { class: 'num', text: `${s.leadTimeDays} روز` }))),
    h('button', { class: 'primary', onclick: () => openSupplierSheet(null), text: 'تأمین‌کنندهٔ جدید' }));
}

function openSupplierSheet(s) {
  const db = state.db;
  const f = {
    name: h('input', { value: s?.name ?? '', dir: 'auto' }),
    phone: h('input', { value: s?.phone ?? '', inputMode: 'tel', dir: 'ltr' }),
    lead: h('input', { value: String(s?.leadTimeDays ?? db.settings.defaultLeadTimeDays), inputMode: 'numeric', dir: 'ltr' }),
    note: h('input', { value: s?.note ?? '' }),
  };
  const errBox = h('div');
  const sheet = openSheet(s ? 'ویرایش تأمین‌کننده' : 'تأمین‌کنندهٔ جدید', h('div', { class: 'form' },
    field('نام', f.name), field('تلفن', f.phone), field('زمان تحویل (روز)', f.lead, 'از سفارش تا رسیدن کالا'), field('یادداشت', f.note), errBox,
    h('div', { class: 'btns' }, h('button', { class: 'primary', text: T.save, onclick: () => {
      const lead = parseNumber(f.lead.value);
      const res = upsertSupplier(db, { name: f.name.value, phone: f.phone.value, leadTimeDays: Number.isNaN(lead) ? NaN : lead ?? undefined, note: f.note.value }, s?.id ?? null);
      if (!res.ok) { errBox.replaceChildren(errList(res.errors)); return; }
      persist(); sheet.close(); render();
    } }), s && !db.products.some((p) => p.supplierId === s.id) ? h('button', { class: 'danger', text: 'حذف', onclick: () => {
      if (!confirm('حذف شود؟')) return;
      db.suppliers.splice(db.suppliers.indexOf(s), 1); persist(); sheet.close(); render();
    } }) : null)));
}

/* reports */

function screenReports() {
  const db = state.db;
  const kind = state.reportKind;
  const date = state.reportDate;
  const opts = { branchId: state.branchId, today: todayStr() };
  const r = kind === 'daily' ? dailyReport(db, date, opts) : weeklyReport(db, date, opts);

  const toggle = h('div', { class: 'seg' },
    h('button', { 'aria-pressed': String(kind === 'daily'), onclick: () => { state.reportKind = 'daily'; render(); }, text: 'روزانه' }),
    h('button', { 'aria-pressed': String(kind === 'weekly'), onclick: () => { state.reportKind = 'weekly'; render(); }, text: 'هفتگی (۷ روز تا تاریخ)' }));
  const dateIn = h('input', { type: 'date', value: date, dir: 'ltr', 'aria-label': 'تاریخ گزارش', onchange: (e) => { state.reportDate = parseDateInput(e.target.value) ?? todayStr(); render(); } });

  const out = h('main', {}, toggle, dateIn);
  out.append(h('div', { class: 'grid2' },
    h('div', { class: 'stat' }, h('b', { class: 'num', text: formatEuro(r.revenueCents) }), h('span', { text: 'فروش' })),
    h('div', { class: 'stat' }, h('b', { class: 'num', text: formatEuro(r.grossProfitCents) }), h('span', { text: 'سود خام (فروش − بهای خرید)' })),
    h('div', { class: 'stat' }, h('b', { class: 'num', text: formatQty(r.units) }), h('span', { text: 'تعداد فروش' })),
    h('div', { class: 'stat' }, h('b', { class: 'num', text: `${formatQty(r.wasteUnits)} (${formatEuro(r.wasteCostCents)})` }), h('span', { text: 'ضایعات' }))));
  if (r.unpricedLines) out.append(h('p', { class: 'banner warn', text: `${r.unpricedLines} رکورد فروش بدون قیمت است و در مجموع فروش حساب نشده.` }));

  if (kind === 'weekly') {
    const max = Math.max(1, ...r.days.map((x) => x.revenueCents));
    out.append(h('div', { class: 'card' }, h('h2', { text: 'فروش روزانه' }),
      h('div', { class: 'bars' }, r.days.map((x) => h('div', { class: 'bar' }, h('span', { class: 'num', text: x.date.slice(5) }),
        h('i', { style: `width:${Math.round((x.revenueCents / max) * 100)}%` }), h('span', { class: 'num', text: formatEuro(x.revenueCents) })))),
      h('p', { class: 'muted', text: r.revenueChangePct === null ? 'هفتهٔ قبل فروشی ثبت نشده.'
        : `نسبت به ۷ روز قبل: ${r.revenueChangePct > 0 ? '+' : ''}${r.revenueChangePct}٪ (${formatEuro(r.previousRevenueCents)})` })));
  }

  out.append(
    h('div', { class: 'card' }, h('h2', { text: 'پرفروش‌ها' }),
      r.top.length === 0 ? h('p', { class: 'muted', text: 'فروشی در این بازه نیست.' }) : r.top.map((t) => h('div', { class: 'row' }, nameBlock(t.product),
        h('span', { class: 'num', text: formatQty(t.qty) }), h('span', { class: 'num', text: formatEuro(t.revenueCents) })))),
    h('div', { class: 'card' }, h('h2', { text: 'وضعیت فعلی موجودی' }),
      h('p', { class: 'num', text: `ارزش موجودی (به قیمت خرید): ${formatEuro(r.stockValueCents)}${r.stockValueUnknown ? ` — ${r.stockValueUnknown} کالا بدون قیمت خرید` : ''}` }),
      h('p', { class: 'muted', text: 'این بخش و بخش‌های زیر همیشه وضعیت امروز را نشان می‌دهند، نه وضعیت تاریخ انتخابی.' })),
    h('div', { class: 'card' }, h('h2', { text: `کمبود موجودی (${r.lowStock.length})` }),
      r.lowStock.length === 0 ? h('p', { class: 'muted', text: 'مورد خاصی نیست.' }) : r.lowStock.map((a) => h('div', { class: 'row' }, nameBlock(a.product),
        h('span', { class: 'num', text: `${formatQty(a.stock)}/${formatQty(a.product.minStock)}` }), h('span', { class: `chip ${a.level}`, text: T.level[a.level] })))),
    h('div', { class: 'card' }, h('h2', { text: `نزدیک انقضا (${r.expiring.length})` }),
      r.expiring.length === 0 ? h('p', { class: 'muted', text: 'مورد خاصی نیست.' }) : r.expiring.map((a) => h('div', { class: 'row' }, nameBlock(a.product),
        h('span', { class: 'num', text: `${formatQty(a.qty)} · ${a.expiry}` }), h('span', { class: `chip ${a.level}`, text: a.daysLeft < 0 ? T.level.expired : `${a.daysLeft} روز` })))),
    h('div', { class: 'card' }, h('h2', { text: `نیازمند سفارش (${r.orders.reduce((n, g) => n + g.lines.length, 0)})` }),
      r.orders.length === 0 ? h('p', { class: 'muted', text: 'مورد خاصی نیست.' }) : r.orders.map((g) => h('div', {}, h('b', { text: g.supplier?.name ?? 'بدون تأمین‌کننده' }),
        g.lines.map((l) => h('div', { class: 'row' }, nameBlock(l.product), h('span', { class: 'num', text: `${formatQty(l.suggestedQty)} ${l.product.unit}` })))))),
    h('button', { onclick: () => download(`report-${state.ws === 'demo' ? 'DEMO-' : ''}${kind}-${date}.csv`, exportReportCsv(r)), text: 'دریافت گزارش (CSV)' }));
  return out;
}

/* settings */

function doBackup() {
  download(`backup-${state.ws === 'demo' ? 'DEMO-' : ''}${todayStr()}.json`, exportBackup(state.db), 'application/json');
  state.db.meta.lastBackupAt = todayStr();
  persist();
  toast('فایل پشتیبان دریافت شد');
}

function screenSettings() {
  const db = state.db;
  const c = ctx();
  const result = h('div');
  const run = async (fn, text, name) => {
    const res = fn(text, name);
    importReport(res, result);
    if (res.ok) { await persist(); toast('انجام شد'); }
  };

  const numSetting = (label, key, min, max, hint) => {
    const input = h('input', { value: String(db.settings[key]), inputMode: 'numeric', dir: 'ltr' });
    input.addEventListener('change', () => {
      const v = parseNumber(input.value);
      if (!Number.isInteger(v) || v < min || v > max) { input.value = String(db.settings[key]); toast(`عدد صحیح بین ${min} و ${max}`); return; }
      db.settings[key] = v; persist(); toast('ذخیره شد');
    });
    return field(label, input, hint);
  };
  const shop = h('input', { value: db.settings.shopName, dir: 'auto', onchange: (e) => { db.settings.shopName = e.target.value.trim(); persist(); } });
  const branchName = h('input', { placeholder: 'نام شعبهٔ جدید', dir: 'auto' });

  return h('main', {},
    h('div', { class: 'card form' }, h('h2', { text: 'فضای کار' }),
      h('p', { class: 'muted', text: 'داده‌های «واقعی» و «نمونه» کاملاً جدا نگه داشته می‌شوند و هرگز قاطی نمی‌شوند.' }),
      h('div', { class: 'seg' },
        h('button', { 'aria-pressed': String(state.ws === 'real'), onclick: async () => { await loadWorkspace('real'); state.tab = 'home'; render(); }, text: 'واقعی' }),
        h('button', { 'aria-pressed': String(state.ws === 'demo'), onclick: async () => { await loadWorkspace('demo'); state.tab = 'home'; render(); }, text: 'نمونه (ساختگی)' })),
      state.ws === 'demo' ? h('button', { onclick: async () => {
        if (!confirm('داده‌های نمونه دوباره ساخته شوند؟ (فقط نمونه تغییر می‌کند)')) return;
        state.db = generateDemoDb(todayStr()); state.branchId = state.db.branches[0].id; await persist(); toast('نمونهٔ تازه ساخته شد'); render();
      }, text: 'ساخت دوبارهٔ داده نمونه' }) : null),

    h('div', { class: 'card form' }, h('h2', { text: 'ورود از فایل CSV' }),
      h('p', { class: 'muted', text: 'فایل Excel را قبل از ورود با «Save as → CSV (UTF-8)» ذخیره کنید. جداکننده , یا ; هر دو پذیرفته می‌شود. اگر فایل حتی یک ردیف خطا داشته باشد، هیچ چیز وارد نمی‌شود.' }),
      h('div', { class: 'btns' },
        filePicker('کالاها', (t) => run((x) => importProductsCsv(db, x), t)),
        filePicker('فروش', (t) => run((x) => importMovementsCsv(db, x, { defaultType: 'sale', branchId: state.branchId }), t)),
        filePicker('ورود کالا', (t) => run((x) => importMovementsCsv(db, x, { defaultType: 'receive', branchId: state.branchId }), t))),
      h('details', {}, h('summary', { text: 'ستون‌های لازم' }),
        h('p', { class: 'ltr muted', text: 'Kalem: barcode; name_de; name_tr; category; supplier; buy_price; sell_price; unit; min_stock; pack_size; active' }),
        h('p', { class: 'ltr muted', text: 'Verkauf/Eingang: date; barcode; qty; (unit_price; unit_cost; expiry; type; branch; note)' }),
        h('p', { class: 'muted', text: 'نام ستون‌ها به آلمانی و ترکی هم پذیرفته می‌شود (مثل Artikel، EK، VK، Menge، Datum، Barkod).' })),
      result),

    h('div', { class: 'card form' }, h('h2', { text: 'خروج اطلاعات' }),
      h('div', { class: 'btns' },
        h('button', { onclick: () => download(`products-${state.ws === 'demo' ? 'DEMO-' : ''}${todayStr()}.csv`, exportProductsCsv(db, c.stock)), text: 'کالاها (CSV)' }),
        h('button', { onclick: () => download(`movements-${state.ws === 'demo' ? 'DEMO-' : ''}${todayStr()}.csv`, exportMovementsCsv(db)), text: 'حرکات موجودی (CSV)' }))),

    h('div', { class: 'card form' }, h('h2', { text: 'پشتیبان‌گیری' }),
      h('p', { class: 'muted', text: db.meta.lastBackupAt ? `آخرین پشتیبان: ${db.meta.lastBackupAt}` : 'هنوز پشتیبان نگرفته‌اید.' }),
      h('div', { class: 'btns' }, h('button', { class: 'primary', onclick: doBackup, text: 'دریافت فایل پشتیبان' }),
        filePicker('بازگردانی از پشتیبان', async (text) => {
          const res = parseBackup(text, { expectDemo: state.ws === 'demo' });
          if (!res.ok) { importReport({ ok: false, errors: res.errors.map((code) => ({ line: '-', code })) }, result); return; }
          if (!confirm('همهٔ داده‌های فعلی این فضا با پشتیبان جایگزین می‌شود. ادامه؟')) return;
          state.db = res.db; state.branchId = res.db.branches[0].id; await persist(); toast('بازگردانی شد'); render();
        }))),

    h('div', { class: 'card form' }, h('h2', { text: 'تنظیمات محاسبه' }),
      field('نام فروشگاه (در متن سفارش)', shop),
      numSetting('پنجرهٔ میانگین فروش (روز)', 'salesWindowDays', 7, 180),
      numSetting('پوشش سفارش (روز)', 'coverDays', 1, 60, 'سفارش چند روز فروش پس از رسیدن کالا را پوشش دهد'),
      numSetting('هشدار انقضا (روز مانده)', 'expiryWarnDays', 1, 60),
      numSetting('زمان تحویل پیش‌فرض (روز)', 'defaultLeadTimeDays', 0, 60, 'برای کالاهای بدون تأمین‌کننده')),

    h('div', { class: 'card form' }, h('h2', { text: 'شعبه‌ها' }),
      db.branches.map((b) => h('div', { class: 'row' }, h('span', { class: 'grow', text: b.name }), b.id === state.branchId ? h('span', { class: 'chip ok', text: 'فعال' }) : null)),
      h('div', { class: 'btns' }, branchName, h('button', { onclick: () => {
        const r = addBranch(db, branchName.value);
        if (!r.ok) { toast(errorText(r.errors[0])); return; }
        persist(); render();
      }, text: 'افزودن شعبه' })),
      h('p', { class: 'muted', text: 'کالاها بین شعبه‌ها مشترک‌اند، موجودی و فروش جداست. انتقال کالا بین شعبه‌ها هنوز پیاده‌سازی نشده.' })),

    state.ws === 'real' ? h('div', { class: 'card form' }, h('h2', { text: 'منطقهٔ خطر' }),
      h('button', { class: 'danger', onclick: async () => {
        if (!confirm('همهٔ داده‌های واقعی برای همیشه پاک شود؟')) return;
        if (prompt('برای تأیید بنویسید: DELETE') !== 'DELETE') return;
        await state.store.clear('real'); await loadWorkspace('real'); toast('پاک شد'); render();
      }, text: 'پاک کردن همهٔ داده‌های واقعی' })) : null,

    h('p', { class: 'muted', text: `ذخیره‌سازی: ${state.storageKind === 'indexeddb' ? 'IndexedDB مرورگر' : 'موقت (حافظه) — با بستن صفحه از بین می‌رود!'}. اتصال به صندوق فروشگاهی (POS) پیاده‌سازی نشده است.` }));
}

/* ---------- shell ---------- */

function renderBanners() {
  document.querySelectorAll('.banner.persist').forEach((n) => n.remove());
  const host = root.querySelector('header.top');
  if (!host) return;
  const add = (cls, text) => host.after(h('div', { class: `banner persist ${cls}`, role: 'alert', text }));
  if (state.saveError) add('bad', `ذخیره‌سازی ناموفق بود: ${state.saveError}. هم‌اکنون یک پشتیبان بگیرید.`);
  if (state.ws === 'demo') add('demo', T.demoBanner);
  if (state.storageKind !== 'indexeddb') add('warn', 'ذخیره‌سازی دائمی در این مرورگر در دسترس نیست؛ داده‌ها با بستن صفحه پاک می‌شوند.');
}

const SCREENS = { home: screenHome, products: screenProducts, stock: screenStock, orders: screenOrders, reports: screenReports, settings: screenSettings };
const TAB_ICONS = { home: '⌂', products: '▦', stock: '⇅', orders: '✎', reports: '▤' };

function render() {
  const header = h('header', { class: 'top' },
    h('h1', { text: state.tab === 'settings' ? T.settings : T.appName }),
    state.ws === 'demo' ? h('span', { class: 'badge', text: 'نمونه' }) : null,
    state.db.branches.length > 1 ? h('select', { 'aria-label': 'شعبه', onchange: (e) => { state.branchId = e.target.value; render(); } },
      state.db.branches.map((b) => h('option', { value: b.id, text: b.name, selected: b.id === state.branchId }))) : null,
    h('button', { class: 'small', 'aria-label': T.settings, onclick: () => { state.tab = state.tab === 'settings' ? 'home' : 'settings'; render(); }, text: state.tab === 'settings' ? '✕' : '⚙' }));
  const nav = h('nav', { class: 'tabs', 'aria-label': 'بخش‌ها' }, Object.entries(T.tabs).map(([k, label]) =>
    h('button', { 'aria-current': state.tab === k ? 'page' : false, onclick: () => { state.tab = k; render(); window.scrollTo(0, 0); } },
      h('b', { text: TAB_ICONS[k] }), label)));
  root.replaceChildren(header, SCREENS[state.tab](), nav);
  renderBanners();
}

async function boot() {
  let backend;
  try {
    if (!('indexedDB' in window)) throw new Error('no idb');
    backend = indexedDbBackend();
    await backend.get('probe');
  } catch {
    backend = memoryBackend();
  }
  state.storageKind = backend.kind;
  state.store = createStore(backend);
  if (backend.kind === 'indexeddb') navigator.storage?.persist?.().catch(() => {});
  const ws = lsGet('smm:ws') === 'demo' ? 'demo' : 'real';
  try {
    await loadWorkspace(ws);
  } catch (e) {
    state.store = createStore(memoryBackend());
    state.db = createEmptyDb();
    state.branchId = state.db.branches[0].id;
    state.saveError = `خواندن داده‌ها ناموفق بود (${e.message}). داده‌های ذخیره‌شده دست‌نخورده‌اند؛ تغییرات جدید ذخیره نمی‌شوند.`;
  }
  render();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') persist(); });
}

boot();
