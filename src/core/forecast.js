import { addDays, diffDays } from './dates.js';
import { round3 } from './numbers.js';

const MIN_HISTORY_DAYS = 7; // avoids wild extrapolation for products with only 1-2 days of data

/**
 * Average units sold per day over the last `windowDays`. Products with a shorter history use
 * their own history (but never fewer than 7 days). Days with no stock are NOT corrected for,
 * so demand of often-sold-out products is under-estimated.
 */
export function avgDailySales(ctx, productId, windowDays = ctx.settings.salesWindowDays) {
  const movs = ctx.movementsOf(productId);
  if (movs.length === 0) return 0;
  let first = movs[0].date;
  for (const m of movs) if (m.date < first) first = m.date;
  const windowStart = addDays(ctx.today, -(windowDays - 1));
  const start = first > windowStart ? first : windowStart;
  const days = Math.max(diffDays(ctx.today, start) + 1, Math.min(MIN_HISTORY_DAYS, windowDays));
  let sold = 0;
  for (const m of movs) if (m.type === 'sale' && m.date >= start && m.date <= ctx.today) sold += m.qty;
  return sold / days;
}

const ceilTo = (x, step) => Math.ceil(round3(x / step)) * step;

/**
 * Reorder suggestion for one product (a SUGGESTION only; nothing is ever sent or ordered).
 *   reorderPoint = avgDaily * leadTime + minStock
 *   target       = avgDaily * (leadTime + coverDays) + minStock
 *   if stock <= reorderPoint: qty = target - stock, rounded up to a multiple of packSize
 */
export function suggestReorder(ctx, product) {
  const supplier = ctx.supplierOf(product);
  const leadTimeDays = supplier?.leadTimeDays ?? ctx.settings.defaultLeadTimeDays;
  const avg = avgDailySales(ctx, product.id);
  const stock = ctx.stockOf(product.id);
  const reorderPoint = avg * leadTimeDays + product.minStock;
  const target = avg * (leadTimeDays + ctx.settings.coverDays) + product.minStock;
  let suggestedQty = 0;
  if (stock <= reorderPoint) {
    const raw = target - stock;
    if (raw > 0) suggestedQty = round3(ceilTo(raw, product.packSize || 1));
  }
  return {
    productId: product.id,
    stock,
    avgDaily: round3(avg),
    leadTimeDays,
    reorderPoint: round3(reorderPoint),
    target: round3(target),
    daysOfStockLeft: avg > 0 ? round3(stock / avg) : null,
    suggestedQty,
  };
}

/** Suggestions for all active products, grouped by supplier. Only products that need ordering. */
export function buildOrderSuggestions(ctx) {
  const groups = new Map();
  for (const product of ctx.db.products) {
    if (!product.active) continue;
    const s = suggestReorder(ctx, product);
    if (s.suggestedQty <= 0) continue;
    const key = product.supplierId ?? '';
    if (!groups.has(key)) groups.set(key, { supplier: ctx.supplierOf(product), lines: [], estimatedCostCents: 0, unknownCostLines: 0 });
    const g = groups.get(key);
    g.lines.push({ product, ...s });
    if (product.buyPriceCents === null) g.unknownCostLines += 1;
    else g.estimatedCostCents += Math.round(product.buyPriceCents * s.suggestedQty);
  }
  const list = [...groups.values()];
  for (const g of list) g.lines.sort((a, b) => (a.daysOfStockLeft ?? 1e9) - (b.daysOfStockLeft ?? 1e9));
  return list.sort((a, b) => (a.supplier ? 0 : 1) - (b.supplier ? 0 : 1) || (a.supplier?.name ?? '').localeCompare(b.supplier?.name ?? ''));
}

/** Plain-text German draft the owner can copy/paste. This app never sends it anywhere. */
export function formatOrderText(group, { shopName = '', date }) {
  const lines = [
    `Bestellung (Entwurf)${shopName ? ' – ' + shopName : ''} – ${date}`,
    group.supplier ? `An: ${group.supplier.name}` : 'An: (Lieferant auswählen)',
    '',
    'Bitte liefern:',
  ];
  for (const l of group.lines) {
    const name = l.product.nameDe || l.product.nameTr;
    lines.push(`- ${l.suggestedQty} ${l.product.unit} ${name}${l.product.barcode ? ` (EAN ${l.product.barcode})` : ''}`);
  }
  lines.push('', 'Vielen Dank!');
  return lines.join('\n');
}
