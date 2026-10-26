import { h } from '../dom.js';
import { copyText } from '../dom.js';
import { t } from '../i18n/index.js';
import { state, ctx, render, persist, toast } from '../runtime.js';
import { field, errList, nameBlock, openSheet, unitLabel, daysLabel } from '../components.js';
import { icon } from '../icons.js';
import { todayStr } from '../../core/dates.js';
import { buildOrderSuggestions, formatOrderText } from '../../core/forecast.js';
import { upsertSupplier } from '../../core/inventory.js';
import { formatEuro, formatQty } from '../../core/format.js';
import { parseNumber } from '../../core/numbers.js';

export function screenOrders() {
  const btn = (key, label, id) => h('button', { 'data-testid': id, 'aria-pressed': String(state.ordersSub === key), onclick: () => { state.ordersSub = key; render(); }, text: label });
  return h('main', {}, h('div', { class: 'seg', role: 'group' }, btn('suggest', t('orders.suggestions'), 'sub-suggest'), btn('suppliers', t('orders.suppliers'), 'sub-suppliers')),
    state.ordersSub === 'suggest' ? suggestionsView() : suppliersView());
}

function suggestionsView() {
  const c = ctx();
  const { settings } = state.db;
  const groups = buildOrderSuggestions(c);
  const wrap = h('div', { class: 'form' }, h('p', { class: 'note', 'data-testid': 'orders-note',
    text: t('orders.note', { days: settings.salesWindowDays, cover: settings.coverDays }) }));
  if (groups.length === 0) wrap.append(h('section', { class: 'card' }, h('p', { text: state.db.products.length ? t('orders.none') : t('common.noData') })));
  for (const g of groups) {
    const text = formatOrderText(g, { shopName: settings.shopName, date: todayStr(), lang: settings.orderLang });
    wrap.append(h('section', { class: 'card' },
      h('h2', {}, g.supplier ? h('span', { 'data-user': '', text: g.supplier.name }) : h('span', { text: t('orders.noSupplier') }),
        g.supplier ? h('span', { class: 'sub', text: ` · ${t('orders.lead', { days: daysLabel(g.supplier.leadTimeDays) })}` }) : null),
      g.lines.map((l) => h('div', { class: 'row' }, nameBlock(l.product),
        h('div', { class: 'end' }, h('div', { class: 'num strong', text: `${formatQty(l.suggestedQty)} ${unitLabel(l.product.unit)}` }),
          h('div', { class: 'sub num', text: t('orders.lineInfo', { stock: formatQty(l.stock), avg: formatQty(l.avgDaily) }) })))),
      h('p', { class: 'muted num', text: t('orders.estimated', { amount: formatEuro(g.estimatedCostCents) }) + (g.unknownCostLines ? ` ${t('orders.unknownCost', { n: g.unknownCostLines })}` : '') }),
      h('pre', { class: 'order', 'data-user': '', text }),
      h('div', { class: 'btns' },
        h('button', { class: 'primary', 'data-testid': 'copy-order', onclick: async () => toast((await copyText(text)) ? t('orders.copied') : t('orders.copyFailed')) }, icon('copy', 18), t('orders.copy')),
        navigator.share ? h('button', { onclick: () => navigator.share({ text }).catch(() => {}) }, icon('share', 18), t('orders.share')) : null,
        g.supplier?.phone ? h('a', { href: `tel:${g.supplier.phone.replace(/[^+\d]/g, '')}`, class: 'btnlink' }, icon('phone', 18), t('orders.call')) : null)));
  }
  return wrap;
}

function suppliersView() {
  const db = state.db;
  return h('section', { class: 'card' }, h('h2', { text: t('orders.suppliers') }),
    db.suppliers.length === 0 ? h('p', { class: 'muted', text: t('common.noData') }) : db.suppliers.map((s) => h('button', { class: 'row', onclick: () => openSupplierSheet(s) },
      h('div', { class: 'grow' }, h('div', { class: 'name ltr', 'data-user': '', text: s.name }), h('div', { class: 'sub ltr', 'data-user': '', text: s.phone })),
      h('span', { class: 'num', text: daysLabel(s.leadTimeDays) }))),
    h('button', { class: 'primary', 'data-testid': 'new-supplier', onclick: () => openSupplierSheet(null), text: t('orders.newSupplier') }));
}

function openSupplierSheet(s) {
  const db = state.db;
  const f = {
    name: h('input', { value: s?.name ?? '', dir: 'auto', 'data-testid': 'sup-name' }),
    phone: h('input', { value: s?.phone ?? '', inputMode: 'tel', dir: 'ltr' }),
    lead: h('input', { value: String(s?.leadTimeDays ?? db.settings.defaultLeadTimeDays), inputMode: 'numeric', dir: 'ltr', 'data-testid': 'sup-lead' }),
    note: h('input', { value: s?.note ?? '' }),
  };
  const errBox = h('div');
  const sheet = openSheet(s ? t('supplier.editTitle') : t('orders.newSupplier'), h('div', { class: 'form' },
    field(t('supplier.name'), f.name), field(t('supplier.phone'), f.phone), field(t('supplier.lead'), f.lead, t('supplier.leadHint')), field(t('supplier.note'), f.note), errBox,
    h('div', { class: 'btns' }, h('button', { class: 'primary', 'data-testid': 'sup-save', text: t('common.save'), onclick: () => {
      const lead = parseNumber(f.lead.value);
      const res = upsertSupplier(db, { name: f.name.value, phone: f.phone.value, leadTimeDays: Number.isNaN(lead) ? NaN : lead ?? undefined, note: f.note.value }, s?.id ?? null);
      if (!res.ok) { errBox.replaceChildren(errList(res.errors)); return; }
      persist(); sheet.close(); render();
    } }), s && !db.products.some((p) => p.supplierId === s.id) ? h('button', { class: 'danger', text: t('common.delete'), onclick: () => {
      if (!confirm(t('supplier.deleteConfirm'))) return;
      db.suppliers.splice(db.suppliers.indexOf(s), 1); persist(); sheet.close(); render();
    } }) : null)));
}
