import { h } from '../dom.js';
import { t } from '../i18n/index.js';
import { state, ctx, render, persist, toast } from '../runtime.js';
import { field, errList, nameBlock, openSheet, eurIn, qtyIn, unitLabel, unitOption, levelChip, formatDate } from '../components.js';
import { icon } from '../icons.js';
import { UNITS, categoriesOf } from '../../core/model.js';
import { batchesOf, upsertProduct } from '../../core/inventory.js';
import { formatEuro, formatPct, formatQty } from '../../core/format.js';
import { parseMoneyToCents, parseNumber } from '../../core/numbers.js';

function stockChip(p, c) {
  const s = c.stockOf(p.id);
  if (c.movementsOf(p.id).length && s <= 0) return levelChip('out');
  if (p.minStock > 0 && s <= p.minStock) return levelChip('low');
  return null;
}

export function screenProducts() {
  const c = ctx();
  const list = h('section', { class: 'card' });
  const draw = () => {
    const needle = state.productQuery.trim().toLowerCase();
    const items = state.db.products.filter((p) => !needle || [p.nameDe, p.nameTr, p.barcode, p.category].join(' ').toLowerCase().includes(needle));
    const nodes = items.length === 0
      ? [h('p', { class: 'muted', text: state.db.products.length ? t('common.noResults') : t('common.noData') })]
      : items.slice(0, 200).map((p) => h('button', { class: 'row', onclick: () => openProductSheet(p) },
        nameBlock(p),
        h('div', { class: 'end' },
          h('div', { class: 'num', text: `${formatQty(c.stockOf(p.id))} ${unitLabel(p.unit)}` }),
          h('div', { class: 'sub num', text: formatEuro(p.sellPriceCents) })),
        stockChip(p, c), p.active ? null : h('span', { class: 'chip', text: t('products.inactive') })));
    list.replaceChildren(...nodes);
    if (items.length > 200) list.append(h('p', { class: 'muted', text: t('products.limit200') }));
  };
  const search = h('input', { type: 'search', placeholder: t('common.searchPlaceholder'), value: state.productQuery, 'aria-label': t('common.searchPlaceholder'),
    oninput: (e) => { state.productQuery = e.target.value; draw(); } });
  draw();
  return h('main', {}, search, list,
    h('button', { class: 'primary fab', 'data-testid': 'add-product', 'aria-label': t('products.new'), onclick: () => openProductSheet(null) }, icon('plus', 26)));
}

export function openProductSheet(product) {
  const db = state.db;
  const isNew = !product;
  const p = product ?? { nameDe: '', nameTr: '', barcode: '', category: '', supplierId: null, unit: 'Stk', buyPriceCents: null, sellPriceCents: null, minStock: 0, packSize: 1, active: true };
  const f = {
    nameDe: h('input', { value: p.nameDe, dir: 'auto', autocomplete: 'off', 'data-testid': 'f-nameDe' }),
    nameTr: h('input', { value: p.nameTr, dir: 'auto', autocomplete: 'off', 'data-testid': 'f-nameTr' }),
    barcode: h('input', { value: p.barcode, inputMode: 'numeric', dir: 'ltr', autocomplete: 'off', 'data-testid': 'f-barcode' }),
    category: h('input', { value: p.category, list: 'cats', dir: 'auto' }),
    supplier: h('select', {}, h('option', { value: '', text: t('product.noSupplier') }),
      db.suppliers.map((s) => h('option', { value: s.id, 'data-user': '', text: s.name, selected: s.id === p.supplierId }))),
    unit: h('select', {}, UNITS.map((u) => h('option', { value: u, text: unitOption(u), selected: u === p.unit }))),
    buy: h('input', { value: eurIn(p.buyPriceCents), inputMode: 'decimal', dir: 'ltr', placeholder: '0,00', 'data-testid': 'f-buy' }),
    sell: h('input', { value: eurIn(p.sellPriceCents), inputMode: 'decimal', dir: 'ltr', placeholder: '0,00', 'data-testid': 'f-sell' }),
    min: h('input', { value: qtyIn(p.minStock), inputMode: 'decimal', dir: 'ltr', 'data-testid': 'f-min' }),
    pack: h('input', { value: qtyIn(p.packSize), inputMode: 'decimal', dir: 'ltr' }),
    active: h('input', { type: 'checkbox', checked: p.active }),
  };
  const errBox = h('div');
  const margin = h('p', { class: 'muted' });
  const updMargin = () => {
    const b = parseMoneyToCents(f.buy.value);
    const s = parseMoneyToCents(f.sell.value);
    margin.textContent = Number.isFinite(b) && Number.isFinite(s) && b !== null && s > 0
      ? t('product.margin', { pct: formatPct(((s - b) / s) * 100) }) : '';
  };
  f.buy.addEventListener('input', updMargin); f.sell.addEventListener('input', updMargin); updMargin();

  let sheet;
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
    persist(); sheet.close(); toast(t('common.saved')); render();
  };

  const c = ctx();
  const extra = [];
  if (!isNew) {
    const batches = batchesOf(c, product.id);
    extra.push(h('div', { class: 'card flat' },
      h('p', {}, `${t('product.currentStock')} `, h('b', { class: 'num', text: `${formatQty(c.stockOf(product.id))} ${unitLabel(product.unit)}` })),
      batches.some((b) => b.expiry) ? h('div', {}, batches.map((b) => h('div', { class: 'sub num',
        text: `${formatQty(b.qty)} ${unitLabel(product.unit)} — ${b.expiry ? formatDate(b.expiry) : t('product.noExpiry')}` }))) : null,
      h('div', { class: 'btns' },
        h('button', { class: 'small', onclick: () => { state.draft.productId = product.id; state.tab = 'stock'; state.stockSub = 'move'; sheet.close(); render(); }, text: t('product.bookStock') }))));
  }
  const body = h('div', { class: 'form' }, ...extra,
    field(t('product.nameDe'), f.nameDe), field(t('product.nameTr'), f.nameTr),
    field(t('product.barcode'), f.barcode, t('product.barcodeHint')),
    field(t('product.category'), f.category), h('datalist', { id: 'cats' }, categoriesOf(db).map((x) => h('option', { value: x }))),
    field(t('product.supplier'), f.supplier), field(t('product.unit'), f.unit),
    h('div', { class: 'grid2' }, field(t('product.buyPrice'), f.buy), field(t('product.sellPrice'), f.sell)), margin,
    h('div', { class: 'grid2' }, field(t('product.minStock'), f.min, t('product.minStockHint')), field(t('product.packSize'), f.pack, t('product.packSizeHint'))),
    h('label', { class: 'check' }, f.active, h('span', { text: t('product.active') })),
    errBox,
    h('div', { class: 'btns' },
      h('button', { class: 'primary', 'data-testid': 'product-save', onclick: save, text: t('common.save') }),
      !isNew && !db.movements.some((m) => m.productId === product.id)
        ? h('button', { class: 'danger', onclick: () => {
          if (!confirm(t('product.deleteConfirm'))) return;
          db.products.splice(db.products.indexOf(product), 1); persist(); sheet.close(); render();
        }, text: t('product.delete') }) : null));
  sheet = openSheet(isNew ? t('product.newTitle') : t('product.editTitle'), body);
}
