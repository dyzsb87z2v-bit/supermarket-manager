// Shared UI runtime: the one mutable state object, persistence, and hooks that app.js fills in.
import { todayStr } from '../core/dates.js';
import { buildContext } from '../core/context.js';
import { generateDemoDb } from '../core/demo.js';

export const state = {
  store: null,
  ws: 'real',
  db: null,
  branchId: null,
  tab: 'home',
  ordersSub: 'suggest',
  stockSub: 'move',
  reportKind: 'daily',
  reportDate: todayStr(),
  productQuery: '',
  draft: { productId: null, type: 'sale', date: todayStr() },
  daily: { date: todayStr(), qtys: new Map(), query: '', onlyInStock: true },
  saveError: null,
  storageKind: 'memory',
};

export const bus = { render() {}, banners() {} };
export const render = () => bus.render();

export const ctx = () => buildContext(state.db, { today: todayStr(), branchId: state.branchId });

let saveChain = Promise.resolve();
export function persist() {
  const { ws, db } = state;
  saveChain = saveChain
    .then(() => state.store.save(ws, db))
    .then(() => { state.saveError = null; })
    .catch((e) => { state.saveError = e.message || String(e); bus.banners(); });
  return saveChain;
}

export const lsGet = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
export const lsSet = (key, v) => { try { localStorage.setItem(key, v); } catch { /* storage may be blocked */ } };

export function resetDrafts() {
  state.draft = { productId: null, type: 'sale', date: todayStr() };
  state.daily = { date: todayStr(), qtys: new Map(), query: '', onlyInStock: true };
  state.stockSub = 'move';
}

export async function loadWorkspace(ws) {
  let db = await state.store.load(ws);
  if (ws === 'demo' && db.products.length === 0) {
    db = generateDemoDb(todayStr());
    await state.store.save('demo', db);
  }
  state.ws = ws;
  state.db = db;
  state.branchId = db.branches[0].id;
  resetDrafts();
  lsSet('smm:ws', ws);
}

let toastTimer;
export function toast(msg) {
  document.querySelector('.toast')?.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.textContent = msg;
  document.body.append(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 2600);
}
