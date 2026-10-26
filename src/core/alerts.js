import { addDays, diffDays } from './dates.js';
import { batchesOf } from './inventory.js';

/** Active products at or below their minimum stock (minStock > 0), or sold out. */
export function lowStockAlerts(ctx) {
  const out = [];
  for (const product of ctx.db.products) {
    if (!product.active) continue;
    const stock = ctx.stockOf(product.id);
    if (stock <= 0 && ctx.movementsOf(product.id).length > 0) out.push({ product, stock, level: 'out' });
    else if (product.minStock > 0 && stock <= product.minStock) out.push({ product, stock, level: 'low' });
  }
  return out.sort((a, b) => (a.level === 'out' ? 0 : 1) - (b.level === 'out' ? 0 : 1) || a.stock - b.stock);
}

/** Batches that are expired or expire within `expiryWarnDays`. */
export function expiryAlerts(ctx) {
  const limit = addDays(ctx.today, ctx.settings.expiryWarnDays);
  const out = [];
  for (const product of ctx.db.products) {
    if (!product.active) continue;
    for (const b of batchesOf(ctx, product.id)) {
      if (!b.expiry || b.expiry > limit) continue;
      const daysLeft = diffDays(b.expiry, ctx.today);
      out.push({ product, qty: b.qty, expiry: b.expiry, daysLeft, level: daysLeft < 0 ? 'expired' : 'soon' });
    }
  }
  return out.sort((a, b) => a.daysLeft - b.daysLeft);
}
