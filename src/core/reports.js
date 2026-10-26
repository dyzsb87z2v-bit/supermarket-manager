import { addDays } from './dates.js';
import { buildContext } from './context.js';
import { expiryAlerts, lowStockAlerts } from './alerts.js';
import { buildOrderSuggestions } from './forecast.js';

const lineRevenue = (m) => (m.unitPriceCents === null ? 0 : Math.round(m.unitPriceCents * m.qty));
const lineCost = (m) => (m.unitCostCents === null ? 0 : Math.round(m.unitCostCents * m.qty));

function summarize(db, ctx, from, to) {
  const rev = { units: 0, revenueCents: 0, costCents: 0, unpricedLines: 0, wasteUnits: 0, wasteCostCents: 0, receivedCostCents: 0 };
  const perProduct = new Map();
  const perDay = new Map();
  for (const m of db.movements) {
    if (m.branchId !== ctx.branchId || m.date < from || m.date > to) continue;
    if (m.type === 'sale') {
      rev.units += m.qty;
      rev.revenueCents += lineRevenue(m);
      rev.costCents += lineCost(m);
      if (m.unitPriceCents === null) rev.unpricedLines += 1;
      const e = perProduct.get(m.productId) ?? { productId: m.productId, qty: 0, revenueCents: 0 };
      e.qty += m.qty; e.revenueCents += lineRevenue(m);
      perProduct.set(m.productId, e);
      const d = perDay.get(m.date) ?? { date: m.date, units: 0, revenueCents: 0 };
      d.units += m.qty; d.revenueCents += lineRevenue(m);
      perDay.set(m.date, d);
    } else if (m.type === 'waste') {
      rev.wasteUnits += m.qty;
      rev.wasteCostCents += lineCost(m);
    } else if (m.type === 'receive') {
      rev.receivedCostCents += lineCost(m);
    }
  }
  const byId = new Map(db.products.map((p) => [p.id, p]));
  const top = [...perProduct.values()]
    .sort((a, b) => b.revenueCents - a.revenueCents)
    .slice(0, 10)
    .map((e) => ({ ...e, product: byId.get(e.productId) }));
  return { ...rev, grossProfitCents: rev.revenueCents - rev.costCents, top, perDay };
}

/** Current state (alerts, orders, stock value) shared by daily and weekly reports. */
function snapshot(db, ctx) {
  let stockValueCents = 0;
  let stockValueUnknown = 0;
  for (const p of db.products) {
    const s = ctx.stockOf(p.id);
    if (s <= 0) continue;
    if (p.buyPriceCents === null) stockValueUnknown += 1;
    else stockValueCents += Math.round(p.buyPriceCents * s);
  }
  return {
    stockValueCents,
    stockValueUnknown,
    lowStock: lowStockAlerts(ctx),
    expiring: expiryAlerts(ctx),
    orders: buildOrderSuggestions(ctx),
  };
}

/** Sales of one day; the snapshot part (stock, alerts) always describes the current state. */
export function dailyReport(db, date, { branchId, today = date } = {}) {
  const ctx = buildContext(db, { today, branchId });
  return { kind: 'daily', date, branchId: ctx.branchId, ...summarize(db, ctx, date, date), ...snapshot(db, ctx) };
}

/** The 7 days ending at `endDate` plus the 7 days before that for comparison. */
export function weeklyReport(db, endDate, { branchId, today = endDate } = {}) {
  const ctx = buildContext(db, { today, branchId });
  const from = addDays(endDate, -6);
  const cur = summarize(db, ctx, from, endDate);
  const prev = summarize(db, ctx, addDays(from, -7), addDays(from, -1));
  const days = [];
  for (let i = 0; i < 7; i += 1) {
    const date = addDays(from, i);
    days.push(cur.perDay.get(date) ?? { date, units: 0, revenueCents: 0 });
  }
  const changePct = prev.revenueCents > 0 ? Math.round(((cur.revenueCents - prev.revenueCents) / prev.revenueCents) * 1000) / 10 : null;
  return {
    kind: 'weekly', from, to: endDate, branchId: ctx.branchId, ...cur, days,
    previousRevenueCents: prev.revenueCents, revenueChangePct: changePct, ...snapshot(db, ctx),
  };
}
