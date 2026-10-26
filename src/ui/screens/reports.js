import { h, download } from '../dom.js';
import { t } from '../i18n/index.js';
import { state } from '../runtime.js';
import { render } from '../runtime.js';
import { nameBlock, unitLabel, levelChip, daysLabel, statTag, formatDate } from '../components.js';
import { todayStr, parseDateInput } from '../../core/dates.js';
import { dailyReport, weeklyReport } from '../../core/reports.js';
import { exportReportCsv } from '../../core/io.js';
import { formatEuro, formatPct, formatQty, formatDayShort } from '../../core/format.js';

export function screenReports() {
  const db = state.db;
  const kind = state.reportKind;
  const date = state.reportDate;
  const opts = { branchId: state.branchId, today: todayStr() };
  const r = kind === 'daily' ? dailyReport(db, date, opts) : weeklyReport(db, date, opts);
  const btn = (key, label, id) => h('button', { 'data-testid': id, 'aria-pressed': String(kind === key), onclick: () => { state.reportKind = key; render(); }, text: label });
  const dateIn = h('input', { type: 'date', value: date, dir: 'ltr', 'aria-label': t('reports.date'), onchange: (e) => { state.reportDate = parseDateInput(e.target.value) ?? todayStr(); render(); } });
  const section = (title, items, row) => h('section', { class: 'card' }, h('h2', { text: title }),
    items.length === 0 ? h('p', { class: 'muted', text: t('common.nothingToShow') }) : items.map(row));

  const out = h('main', {}, h('div', { class: 'seg', role: 'group' }, btn('daily', t('reports.daily'), 'rep-daily'), btn('weekly', t('reports.weekly'), 'rep-weekly')), dateIn);
  out.append(h('div', { class: 'tags', 'data-testid': 'report-tags' },
    statTag(formatEuro(r.revenueCents), t('reports.revenue')),
    statTag(formatEuro(r.grossProfitCents), t('reports.grossProfit')),
    statTag(formatQty(r.units), t('reports.units')),
    statTag(`${formatQty(r.wasteUnits)} · ${formatEuro(r.wasteCostCents)}`, t('reports.waste'))));
  if (r.unpricedLines) out.append(h('p', { class: 'banner warn', text: t('reports.unpriced', { n: r.unpricedLines }) }));

  if (kind === 'weekly') {
    const max = Math.max(1, ...r.days.map((x) => x.revenueCents));
    out.append(h('section', { class: 'card' }, h('h2', { text: t('reports.dailySales') }),
      h('div', { class: 'bars' }, r.days.map((x) => h('div', { class: 'bar' }, h('span', { class: 'num', 'data-fmt': '', text: formatDayShort(x.date) }),
        h('i', { style: `width:${Math.round((x.revenueCents / max) * 100)}%` }), h('span', { class: 'num', text: formatEuro(x.revenueCents) })))),
      h('p', { class: 'muted', text: r.revenueChangePct === null ? t('reports.noPrevWeek')
        : t('reports.vsPrev', { pct: formatPct(r.revenueChangePct, { sign: true }), prev: formatEuro(r.previousRevenueCents) }) })));
  }

  out.append(
    section(t('reports.top'), r.top, (x) => h('div', { class: 'row' }, nameBlock(x.product),
      h('span', { class: 'num', text: formatQty(x.qty) }), h('span', { class: 'num strong', text: formatEuro(x.revenueCents) }))),
    h('section', { class: 'card' }, h('h2', { text: t('reports.stockNow') }),
      h('p', { class: 'num', text: t('reports.stockValue', { amount: formatEuro(r.stockValueCents) }) + (r.stockValueUnknown ? ` ${t('reports.stockValueUnknown', { n: r.stockValueUnknown })}` : '') }),
      h('p', { class: 'muted', text: t('reports.snapshotNote') })),
    section(t('reports.lowTitle', { n: r.lowStock.length }), r.lowStock, (a) => h('div', { class: 'row' }, nameBlock(a.product),
      h('span', { class: 'num', text: `${formatQty(a.stock)}/${formatQty(a.product.minStock)}` }), levelChip(a.level))),
    section(t('reports.expiryTitle', { n: r.expiring.length }), r.expiring, (a) => h('div', { class: 'row' }, nameBlock(a.product),
      h('span', { class: 'num', text: `${formatQty(a.qty)} · ${formatDate(a.expiry)}` }), a.daysLeft < 0 ? levelChip('expired') : h('span', { class: 'chip soon', text: daysLabel(a.daysLeft) }))),
    h('section', { class: 'card' }, h('h2', { text: t('reports.ordersTitle', { n: r.orders.reduce((n, g) => n + g.lines.length, 0) }) }),
      r.orders.length === 0 ? h('p', { class: 'muted', text: t('common.nothingToShow') }) : r.orders.map((g) => h('div', {},
        h('b', { 'data-user': '', text: g.supplier?.name ?? t('orders.noSupplier') }),
        g.lines.map((l) => h('div', { class: 'row' }, nameBlock(l.product), h('span', { class: 'num', text: `${formatQty(l.suggestedQty)} ${unitLabel(l.product.unit)}` })))))),
    h('button', { 'data-testid': 'report-csv', onclick: () => download(`report-${state.ws === 'demo' ? 'DEMO-' : ''}${kind}-${date}.csv`, exportReportCsv(r)), text: t('reports.exportCsv') }));
  return out;
}
