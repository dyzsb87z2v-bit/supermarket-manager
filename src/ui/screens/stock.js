import { h } from '../dom.js';
import { t, tn } from '../i18n/index.js';
import { state, ctx, render, persist, toast } from '../runtime.js';
import { field, errList, errorText, nameBlock, pname, eurIn, unitLabel, moveLabel, formatDate } from '../components.js';
import { icon } from '../icons.js';
import { todayStr, parseDateInput } from '../../core/dates.js';
import { MOVEMENT_TYPES } from '../../core/model.js';
import { addMovement, deleteMovement, recordDailySales } from '../../core/inventory.js';
import { formatEuro, formatQty } from '../../core/format.js';
import { parseMoneyToCents, parseNumber } from '../../core/numbers.js';

function subSwitch() {
  const btn = (key, label, id) => h('button', { 'data-testid': id, 'aria-pressed': String(state.stockSub === key), onclick: () => { state.stockSub = key; render(); }, text: label });
  return h('div', { class: 'seg', role: 'group' }, btn('move', t('stock.modeSingle'), 'sub-move'), btn('daily', t('stock.modeDaily'), 'sub-daily'));
}

export function screenStock() {
  return h('main', {}, subSwitch(), ...(state.stockSub === 'daily' ? dailyView() : singleView()));
}

/* ---- single movement ---- */

function singleView() {
  const db = state.db;
  const c = ctx();
  const d = state.draft;
  const selected = () => db.products.find((p) => p.id === d.productId) ?? null;

  const search = h('input', { type: 'search', placeholder: t('common.searchPlaceholder'), 'aria-label': t('common.searchPlaceholder'), autocomplete: 'off', 'data-testid': 'move-search' });
  const results = h('div');
  const chosen = h('div');
  const qty = h('input', { inputMode: 'decimal', dir: 'ltr', placeholder: '0', 'aria-label': t('stock.qty'), 'data-testid': 'move-qty' });
  const date = h('input', { type: 'date', value: d.date, dir: 'ltr', onchange: (e) => { d.date = e.target.value; } });
  const expiry = h('input', { type: 'date', dir: 'ltr', 'data-testid': 'move-expiry' });
  const cost = h('input', { inputMode: 'decimal', dir: 'ltr', placeholder: t('common.optional') });
  const note = h('input', { placeholder: t('common.optional') });
  const extraReceive = h('div', { class: 'grid2' }, field(t('stock.expiry'), expiry), field(t('stock.unitCost'), cost));
  const errBox = h('div');
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': t('stock.type') });
  const qtyLabel = h('span', { class: 'f-label' });

  const drawSeg = () => {
    seg.replaceChildren(...MOVEMENT_TYPES.map((type) => h('button', { 'data-testid': `type-${type}`, 'aria-pressed': d.type === type ? 'true' : 'false',
      onclick: () => { d.type = type; drawSeg(); }, text: moveLabel(type) })));
    extraReceive.hidden = d.type !== 'receive';
    qtyLabel.textContent = d.type === 'adjust' ? t('stock.qtyAdjust') : t('stock.qty');
  };
  const drawChosen = () => {
    const p = selected();
    chosen.replaceChildren(p ? h('div', { class: 'card flat' }, h('div', { class: 'row' }, nameBlock(p),
      h('span', { class: 'num', text: `${formatQty(c.stockOf(p.id))} ${unitLabel(p.unit)}` }),
      h('button', { class: 'small', onclick: () => { d.productId = null; drawChosen(); search.focus(); }, text: t('common.change') }))) : '');
    search.hidden = Boolean(p);
    if (p) cost.placeholder = eurIn(p.buyPriceCents) || t('common.optional');
  };
  const drawResults = () => {
    const q = search.value.trim().toLowerCase();
    results.replaceChildren();
    if (!q || selected()) return;
    const exact = db.products.find((p) => p.barcode && p.barcode === q);
    const hits = exact ? [exact] : db.products.filter((p) => p.active && [p.nameDe, p.nameTr, p.barcode].join(' ').toLowerCase().includes(q)).slice(0, 6);
    results.append(...hits.map((p) => h('button', { class: 'row', 'data-testid': 'move-hit', onclick: () => { d.productId = p.id; search.value = ''; drawResults(); drawChosen(); qty.focus(); } },
      nameBlock(p), h('span', { class: 'num sub', text: `${formatQty(c.stockOf(p.id))} ${unitLabel(p.unit)}` }))));
    if (!hits.length) results.append(h('p', { class: 'muted', text: t('common.noResults') }));
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
      errBox.replaceChildren(errList(res.errors),
        res.available !== undefined ? h('p', { class: 'muted', text: t('stock.available', { qty: `${formatQty(res.available)} ${unitLabel(p.unit)}` }) }) : '');
      return;
    }
    persist();
    d.productId = null;
    toast(t('stock.booked', { type: moveLabel(d.type), name: pname(p) }));
    render();
  };

  drawSeg(); drawChosen();
  const form = h('section', { class: 'card form' }, h('h2', { text: t('stock.formTitle') }), search, results, chosen, seg,
    h('div', { class: 'grid2' }, h('label', { class: 'f' }, qtyLabel, qty), field(t('stock.date'), date)),
    extraReceive, field(t('stock.note'), note), errBox, h('button', { class: 'primary', 'data-testid': 'move-submit', onclick: submit, text: t('stock.book') }));

  const byId = new Map(db.products.map((p) => [p.id, p]));
  const recent = db.movements.filter((m) => m.branchId === state.branchId).slice(-20).reverse();
  const history = h('section', { class: 'card' }, h('h2', { text: t('stock.recent') }),
    recent.length === 0 ? h('p', { class: 'muted', text: t('common.noData') }) : recent.map((m) => {
      const p = byId.get(m.productId);
      return h('div', { class: 'row' }, h('div', { class: 'grow' }, h('div', { class: 'name ltr', 'data-user': '', text: p ? pname(p) : '?' }),
        h('div', { class: 'sub num', text: `${formatDate(m.date)} · ${moveLabel(m.type)}${m.expiry ? ` · ${t('stock.expiryShort')} ${formatDate(m.expiry)}` : ''}` })),
        h('span', { class: 'num', dir: 'ltr', text: `${m.type === 'sale' || m.type === 'waste' ? '−' : m.qty > 0 ? '+' : ''}${formatQty(m.qty)}` }),
        h('button', { class: 'icon-btn danger', 'aria-label': t('stock.deleteMovement'), onclick: () => {
          if (!confirm(t('stock.deleteConfirm'))) return;
          const r = deleteMovement(db, m.id);
          if (!r.ok) { toast(errorText(r.errors[0])); return; }
          persist(); render();
        } }, icon('trash', 18)));
    }));
  return [form, history];
}

/* ---- quick daily sales ---- */

function dailyView() {
  const db = state.db;
  const c = ctx();
  const d = state.daily;
  const errBox = h('div');
  const list = h('section', { class: 'card' });
  const summary = h('p', { class: 'num', role: 'status' });
  const submitBtn = h('button', { class: 'primary', 'data-testid': 'daily-submit', text: t('daily.submit') });

  const soldOn = (productId) => {
    let n = 0;
    for (const m of c.movementsOf(productId)) if (m.type === 'sale' && m.date === d.date) n += m.qty;
    return n;
  };
  const qtyOf = (id) => parseNumber(d.qtys.get(id) ?? '');
  const drawSummary = () => {
    let lines = 0; let units = 0; let revenue = 0;
    for (const p of db.products) {
      const q = qtyOf(p.id);
      if (q && q > 0) { lines += 1; units += q; revenue += Math.round((p.sellPriceCents ?? 0) * q); }
    }
    summary.textContent = lines ? t('daily.summary', { lines, units: formatQty(units), revenue: formatEuro(revenue) }) : t('daily.summaryEmpty');
    submitBtn.disabled = lines === 0;
  };
  const draw = () => {
    const needle = d.query.trim().toLowerCase();
    const items = db.products.filter((p) => p.active
      && (!d.onlyInStock || c.stockOf(p.id) > 0 || d.qtys.get(p.id))
      && (!needle || [p.nameDe, p.nameTr, p.barcode].join(' ').toLowerCase().includes(needle))).slice(0, 300);
    const nodes = items.length === 0
      ? [h('p', { class: 'muted', text: db.products.length ? t('daily.noItems') : t('common.noData') })]
      : items.map((p) => {
        const already = soldOn(p.id);
        const input = h('input', { class: 'qty', inputMode: p.unit === 'kg' || p.unit === 'l' ? 'decimal' : 'numeric', dir: 'ltr', placeholder: '0',
          value: d.qtys.get(p.id) ?? '', 'aria-label': t('daily.qtyFor', { name: pname(p) }), 'data-pid': p.id,
          oninput: (e) => { d.qtys.set(p.id, e.target.value); errBox.replaceChildren(); drawSummary(); },
          onkeydown: (e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            const all = [...list.querySelectorAll('input.qty')];
            all[all.indexOf(e.target) + 1]?.focus();
          } });
        return h('div', { class: 'drow', 'data-row': p.id }, nameBlock(p),
          h('div', { class: 'sub num' }, t('daily.stock', { qty: `${formatQty(c.stockOf(p.id))} ${unitLabel(p.unit)}` }),
            already ? h('div', { class: 'chip soon', text: t('daily.alreadyBooked', { qty: formatQty(already) }) }) : null),
          input);
      });
    list.replaceChildren(...nodes);
  };

  submitBtn.addEventListener('click', () => {
    const entries = [];
    const pre = [];
    for (const p of db.products) {
      const raw = d.qtys.get(p.id);
      if (raw === undefined || String(raw).trim() === '') continue;
      const q = parseNumber(raw);
      if (q === null || Number.isNaN(q) || q < 0) { pre.push(`${pname(p)}: ${errorText('qty_invalid')}`); continue; }
      entries.push({ productId: p.id, qty: q });
    }
    if (pre.length) { errBox.replaceChildren(h('ul', { class: 'errors', role: 'alert' }, pre.map((x) => h('li', { text: x })))); return; }
    const byId = new Map(db.products.map((x) => [x.id, x]));
    const res = recordDailySales(db, { date: d.date, branchId: state.branchId, entries });
    if (!res.ok) {
      errBox.replaceChildren(h('p', { class: 'banner bad', role: 'alert', text: t('daily.failed') }),
        h('ul', { class: 'errors' }, res.errors.map((e) => h('li', {
          text: `${e.productId ? pname(byId.get(e.productId)) + ': ' : ''}${errorText(e.code)}${e.available !== undefined ? ` (${t('daily.availableShort', { qty: formatQty(e.available) })})` : ''}` }))));
      return;
    }
    persist();
    d.qtys = new Map();
    toast(tn('daily.saved', res.count, { date: formatDate(d.date) }));
    render();
  });

  const dateIn = h('input', { type: 'date', value: d.date, dir: 'ltr', 'aria-label': t('daily.date'),
    onchange: (e) => { d.date = parseDateInput(e.target.value) ?? todayStr(); render(); } });
  const search = h('input', { type: 'search', placeholder: t('common.searchPlaceholder'), value: d.query, 'aria-label': t('common.searchPlaceholder'), oninput: (e) => { d.query = e.target.value; draw(); } });
  const only = h('input', { type: 'checkbox', checked: d.onlyInStock, onchange: (e) => { d.onlyInStock = e.target.checked; draw(); } });
  draw(); drawSummary();
  return [
    h('section', { class: 'card form' }, h('h2', { text: t('daily.title') }), h('p', { class: 'muted', text: t('daily.help') }),
      field(t('daily.date'), dateIn), search, h('label', { class: 'check' }, only, h('span', { text: t('daily.onlyInStock') }))),
    list,
    h('div', { class: 'actionbar' }, summary, errBox, submitBtn),
  ];
}
