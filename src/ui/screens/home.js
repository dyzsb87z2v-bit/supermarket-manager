import { h } from '../dom.js';
import { t, tn } from '../i18n/index.js';
import { state, ctx, render, loadWorkspace } from '../runtime.js';
import { nameBlock, statTag, levelChip, unitLabel, daysLabel } from '../components.js';
import { todayStr, addDays } from '../../core/dates.js';
import { dailyReport } from '../../core/reports.js';
import { lowStockAlerts, expiryAlerts } from '../../core/alerts.js';
import { buildOrderSuggestions } from '../../core/forecast.js';
import { formatEuro, formatQty, formatDate } from '../../core/format.js';
import { openProductSheet } from './products.js';
import { doBackup } from './settings.js';

const goto = (tab) => { state.tab = tab; render(); };

function listCard(title, items, renderRow, footer) {
  return h('section', { class: 'card' }, h('h2', { text: title }),
    items.length === 0 ? h('p', { class: 'muted', text: t('common.nothingToShow') }) : items.slice(0, 5).map(renderRow),
    items.length > 5 ? h('p', { class: 'muted', text: t('common.moreItems', { n: items.length - 5 }) }) : null, footer);
}

export function screenHome() {
  const db = state.db;
  const c = ctx();
  const today = todayStr();
  const rep = dailyReport(db, today, { branchId: state.branchId, today });
  const low = lowStockAlerts(c);
  const exp = expiryAlerts(c);
  const orderLines = buildOrderSuggestions(c).reduce((n, g) => n + g.lines.length, 0);
  const out = h('main');

  if (db.products.length === 0) {
    out.append(h('section', { class: 'card' },
      h('h2', { text: t('home.startTitle') }),
      h('p', { text: t('home.startBody') }),
      h('div', { class: 'btns' },
        h('button', { class: 'primary', 'data-testid': 'start-add-product', onclick: () => openProductSheet(null), text: t('home.addFirstProduct') }),
        h('button', { onclick: () => goto('settings'), text: t('home.importCsv') }),
        state.ws === 'real' ? h('button', { onclick: async () => { await loadWorkspace('demo'); render(); }, text: t('home.tryDemo') }) : null)));
  }

  out.append(h('div', { class: 'tags' },
    statTag(formatEuro(rep.revenueCents), t('home.salesToday')),
    statTag(formatQty(rep.units), t('home.unitsToday')),
    statTag(String(low.length), t('home.lowCount'), low.length ? 'warn' : ''),
    statTag(String(exp.length), t('home.expiryCount'), exp.length ? 'warn' : '')));

  const lastBackup = db.meta.lastBackupAt;
  if (state.ws === 'real' && db.movements.length > 0 && (!lastBackup || addDays(today, -7) > lastBackup)) {
    out.append(h('div', { class: 'banner warn' },
      h('p', { text: t('home.backupReminder') }),
      h('button', { class: 'small', onclick: () => doBackup(), text: t('settings.backupDownload') })));
  }

  out.append(
    listCard(t('home.lowTitle'), low, (a) => h('div', { class: 'row' }, nameBlock(a.product),
      h('span', { class: 'num', text: `${formatQty(a.stock)} ${unitLabel(a.product.unit)}` }), levelChip(a.level))),
    listCard(t('home.expiryTitle'), exp, (a) => h('div', { class: 'row' }, nameBlock(a.product),
      h('span', { class: 'num', text: `${formatQty(a.qty)} ${unitLabel(a.product.unit)}` }),
      a.daysLeft < 0 ? levelChip('expired') : h('span', { class: 'chip soon', text: daysLabel(a.daysLeft) }),
      h('span', { class: 'sub num', text: formatDate(a.expiry) }))),
    h('section', { class: 'card' }, h('h2', { text: t('home.ordersTitle') }),
      h('p', { text: orderLines ? tn('home.ordersNeeded', orderLines) : t('home.ordersNone') }),
      orderLines ? h('button', { onclick: () => goto('orders'), text: t('home.ordersOpen') }) : null));
  return out;
}
