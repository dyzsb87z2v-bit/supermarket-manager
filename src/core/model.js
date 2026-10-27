import { isValidDateStr, todayStr } from './dates.js';

export const DB_VERSION = 1;
export const MOVEMENT_TYPES = ['receive', 'sale', 'waste', 'adjust'];
export const UNITS = ['Stk', 'kg', 'l', 'Pkg'];

export const DEFAULT_SETTINGS = Object.freeze({
  shopName: '',
  orderLang: 'de', // language of the order text drafted for suppliers: 'de' | 'tr'
  salesWindowDays: 28, // how many days of sales history the average uses
  coverDays: 7, // how many days of sales an order should cover beyond the lead time
  expiryWarnDays: 7,
  defaultLeadTimeDays: 2,
});

let counter = 0;
export function newId(prefix) {
  counter += 1;
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${rand}`;
}

export function createEmptyDb({ isDemo = false } = {}) {
  return {
    version: DB_VERSION,
    meta: { createdAt: todayStr(), lastBackupAt: null, isDemo, importedClosings: [] },
    settings: { ...DEFAULT_SETTINGS },
    branches: [{ id: 'main', name: 'Hauptfiliale' }],
    suppliers: [],
    products: [],
    movements: [],
  };
}

/** Validates the shape of loaded/imported data and fills in missing defaults. Throws Error('invalid_data'). */
export function normalizeDb(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('invalid_data');
  for (const k of ['suppliers', 'products', 'movements', 'branches']) {
    if (!Array.isArray(raw[k])) throw new Error('invalid_data');
  }
  if (raw.version !== DB_VERSION) throw new Error('invalid_data');
  const isObj = (x) => x && typeof x === 'object' && typeof x.id === 'string';
  if (![...raw.suppliers, ...raw.products, ...raw.branches].every(isObj)) throw new Error('invalid_data');
  const validMovement = (m) => isObj(m) && isValidDateStr(m.date) && MOVEMENT_TYPES.includes(m.type) && Number.isFinite(m.qty)
    && typeof m.productId === 'string' && typeof m.branchId === 'string' && (m.expiry === null || m.expiry === undefined || isValidDateStr(m.expiry));
  if (!raw.movements.every(validMovement)) throw new Error('invalid_data');
  const db = {
    version: DB_VERSION,
    meta: { createdAt: todayStr(), lastBackupAt: null, isDemo: false, importedClosings: [], ...(raw.meta || {}) },
    settings: { ...DEFAULT_SETTINGS, ...(raw.settings || {}) },
    branches: raw.branches,
    suppliers: raw.suppliers,
    products: raw.products,
    movements: raw.movements,
  };
  if (!Array.isArray(db.meta.importedClosings) || !db.meta.importedClosings.every((k) => typeof k === 'string')) throw new Error('invalid_data');
  if (db.branches.length === 0) db.branches.push({ id: 'main', name: 'Hauptfiliale' });
  return db;
}

export function replaceDbContents(target, source) {
  for (const k of Object.keys(target)) delete target[k];
  Object.assign(target, source);
}

export function categoriesOf(db) {
  return [...new Set(db.products.map((p) => p.category).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}
