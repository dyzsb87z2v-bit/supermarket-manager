import { todayStr } from './dates.js';
import { round3 } from './numbers.js';

export function movementDelta(m) {
  switch (m.type) {
    case 'receive': return m.qty;
    case 'adjust': return m.qty; // signed
    case 'sale':
    case 'waste': return -m.qty;
    default: return 0;
  }
}

/**
 * Pre-indexes movements of one branch so alerts / forecasts / reports stay O(movements).
 * `today` is injected so everything is deterministic in tests.
 */
export function buildContext(db, { today = todayStr(), branchId } = {}) {
  const branch = branchId ?? db.branches[0].id;
  const byProduct = new Map();
  const rawStock = new Map();
  for (const m of db.movements) {
    if (m.branchId !== branch) continue;
    let list = byProduct.get(m.productId);
    if (!list) { list = []; byProduct.set(m.productId, list); }
    list.push(m);
    rawStock.set(m.productId, (rawStock.get(m.productId) ?? 0) + movementDelta(m));
  }
  const stock = new Map([...rawStock].map(([k, v]) => [k, round3(v)]));
  return {
    db,
    today,
    branchId: branch,
    settings: db.settings,
    byProduct,
    stock,
    stockOf: (productId) => stock.get(productId) ?? 0,
    movementsOf: (productId) => byProduct.get(productId) ?? [],
    supplierOf: (p) => db.suppliers.find((s) => s.id === p.supplierId) ?? null,
  };
}
