import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContext } from '../src/core/context.js';
import { avgDailySales, buildOrderSuggestions, formatOrderText, suggestReorder } from '../src/core/forecast.js';
import { expiryAlerts, lowStockAlerts } from '../src/core/alerts.js';
import { dailyReport, weeklyReport } from '../src/core/reports.js';
import { upsertProduct } from '../src/core/inventory.js';
import { addDays } from '../src/core/dates.js';
import { mkDb, move, TODAY } from './helpers.js';

/** 28 days of history with `perDay` sold each day, starting stock large enough. */
function seedSales(db, p, perDay, days = 28, receive = 1000) {
  move(db, p, 'receive', receive, addDays(TODAY, -days));
  for (let i = days - 1; i >= 0; i -= 1) move(db, p, 'sale', perDay, addDays(TODAY, -i));
}

test('average daily sales over the window', () => {
  const { db, p } = mkDb();
  seedSales(db, p, 10);
  const ctx = buildContext(db, { today: TODAY });
  assert.equal(avgDailySales(ctx, p.id), 10);
});

test('short history uses its own length but never fewer than 7 days', () => {
  const { db, p } = mkDb();
  move(db, p, 'receive', 100, addDays(TODAY, -1));
  move(db, p, 'sale', 14, TODAY);
  const ctx = buildContext(db, { today: TODAY });
  assert.equal(avgDailySales(ctx, p.id), 2); // 14 units / 7 days, not 14 / 2
});

test('old sales outside the window are ignored; no history gives 0', () => {
  const { db, p } = mkDb();
  assert.equal(avgDailySales(buildContext(db, { today: TODAY }), p.id), 0);
  move(db, p, 'receive', 500, addDays(TODAY, -100));
  move(db, p, 'sale', 400, addDays(TODAY, -90));
  assert.equal(avgDailySales(buildContext(db, { today: TODAY }), p.id), 0);
});

test('reorder suggestion: formula, pack rounding, lead time from supplier', () => {
  const { db, p } = mkDb();
  seedSales(db, p, 10, 28, 300); // stock after = 300 - 280 = 20
  const ctx = buildContext(db, { today: TODAY });
  const s = suggestReorder(ctx, p);
  assert.equal(s.stock, 20);
  assert.equal(s.leadTimeDays, 2);
  assert.equal(s.reorderPoint, 25); // 10*2 + minStock 5
  assert.equal(s.target, 95); // 10*(2+7) + 5
  assert.equal(s.suggestedQty, 78); // 95-20=75 -> rounded up to multiple of 6
  assert.equal(s.daysOfStockLeft, 2);
});

test('no suggestion when stock is above the reorder point or product is dead', () => {
  const { db, p } = mkDb();
  seedSales(db, p, 10, 28, 400); // stock 120
  assert.equal(suggestReorder(buildContext(db, { today: TODAY }), p).suggestedQty, 0);
  const dead = upsertProduct(db, { nameDe: 'Ladenhüter', unit: 'Stk', minStock: 0 }).product;
  assert.equal(suggestReorder(buildContext(db, { today: TODAY }), dead).suggestedQty, 0);
});

test('order suggestions are grouped per supplier, skip inactive, and are text drafts only', () => {
  const { db, p, s } = mkDb();
  seedSales(db, p, 10, 28, 300);
  const loose = upsertProduct(db, { nameDe: 'Ohne Lieferant', unit: 'kg', minStock: 3, packSize: 0.5 }).product;
  move(db, loose, 'receive', 4, addDays(TODAY, -3));
  const inactive = upsertProduct(db, { nameDe: 'Inaktiv', unit: 'Stk', minStock: 9, active: false }).product;
  move(db, inactive, 'receive', 1, addDays(TODAY, -3));
  const groups = buildOrderSuggestions(buildContext(db, { today: TODAY }));
  assert.equal(groups.length, 1, 'only the Joghurt group needs ordering');
  const withSupplier = groups.find((g) => g.supplier?.id === s.id);
  assert.equal(withSupplier.lines.length, 1);
  assert.equal(withSupplier.estimatedCostCents, 7800); // 78 * 100 cents
  assert.ok(!groups.some((g) => g.lines.some((l) => l.product.id === inactive.id)));
  const text = formatOrderText(withSupplier, { shopName: 'Test Markt', date: TODAY });
  assert.match(text, /Bestellung \(Entwurf\)/);
  assert.match(text, /78 Stk Joghurt \(EAN 4001234567890\)/);
});

test('low stock and expiry alerts', () => {
  const { db, p } = mkDb();
  move(db, p, 'receive', 20, addDays(TODAY, -10), { expiry: addDays(TODAY, 3) });
  move(db, p, 'receive', 4, addDays(TODAY, -9), { expiry: addDays(TODAY, -2) });
  move(db, p, 'receive', 5, addDays(TODAY, -8), { expiry: addDays(TODAY, 40) });
  move(db, p, 'sale', 22, addDays(TODAY, -5)); // consumes the expired (4) first, then 18 of the 3-days batch
  const ctx = buildContext(db, { today: TODAY });
  const exp = expiryAlerts(ctx);
  assert.deepEqual(exp.map((e) => [e.level, e.qty, e.daysLeft]), [['soon', 2, 3]]);
  // stock = 20+4+5-22 = 7 -> above min 5, no low alert
  assert.equal(lowStockAlerts(ctx).length, 0);
  move(db, p, 'sale', 3, TODAY);
  const low = lowStockAlerts(buildContext(db, { today: TODAY }));
  assert.equal(low[0].level, 'low');
  move(db, p, 'sale', 4, TODAY);
  assert.equal(lowStockAlerts(buildContext(db, { today: TODAY }))[0].level, 'out');
});

test('expired stock is flagged expired', () => {
  const { db, p } = mkDb();
  move(db, p, 'receive', 6, addDays(TODAY, -10), { expiry: addDays(TODAY, -1) });
  const [e] = expiryAlerts(buildContext(db, { today: TODAY }));
  assert.equal(e.level, 'expired');
  assert.equal(e.daysLeft, -1);
});

test('daily report totals revenue, profit, waste, top products', () => {
  const { db, p } = mkDb();
  move(db, p, 'receive', 50, addDays(TODAY, -2));
  move(db, p, 'sale', 10, TODAY);
  move(db, p, 'waste', 2, TODAY);
  move(db, p, 'sale', 5, addDays(TODAY, -1)); // other day, not counted
  const r = dailyReport(db, TODAY, { today: TODAY });
  assert.equal(r.units, 10);
  assert.equal(r.revenueCents, 1990);
  assert.equal(r.costCents, 1000);
  assert.equal(r.grossProfitCents, 990);
  assert.equal(r.wasteUnits, 2);
  assert.equal(r.wasteCostCents, 200);
  assert.equal(r.top[0].product.id, p.id);
  assert.equal(r.stockValueCents, 33 * 100);
});

test('weekly report: 7 day series, previous-week comparison', () => {
  const { db, p } = mkDb();
  move(db, p, 'receive', 500, addDays(TODAY, -20));
  for (let i = 0; i < 7; i += 1) move(db, p, 'sale', 10, addDays(TODAY, -i)); // this week 70 units
  for (let i = 7; i < 14; i += 1) move(db, p, 'sale', 5, addDays(TODAY, -i)); // last week 35 units
  const w = weeklyReport(db, TODAY, { today: TODAY });
  assert.equal(w.days.length, 7);
  assert.equal(w.days[6].date, TODAY);
  assert.equal(w.units, 70);
  assert.equal(w.previousRevenueCents, 35 * 199);
  assert.equal(w.revenueChangePct, 100);
});

test('reports only include the selected branch', () => {
  const { db, p } = mkDb();
  move(db, p, 'receive', 50, addDays(TODAY, -2));
  move(db, p, 'sale', 3, TODAY);
  assert.equal(dailyReport(db, TODAY, { today: TODAY, branchId: 'other' }).units, 0);
});
