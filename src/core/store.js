import { createEmptyDb, normalizeDb } from './model.js';

export const WORKSPACES = ['real', 'demo'];

/** In-memory backend: used by tests and as a fallback when IndexedDB is unavailable. */
export function memoryBackend() {
  const data = new Map();
  return {
    kind: 'memory',
    async get(key) { return data.has(key) ? structuredClone(data.get(key)) : null; },
    async set(key, value) { data.set(key, structuredClone(value)); },
    async remove(key) { data.delete(key); },
  };
}

/** IndexedDB backend (browser). One record per workspace. */
export function indexedDbBackend(dbName = 'supermarket-manager') {
  const open = () => new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const run = async (mode, fn) => {
    const db = await open();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction('kv', mode);
        const req = fn(tx.objectStore('kv'));
        tx.oncomplete = () => resolve(req?.result ?? null);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally { db.close(); }
  };
  return {
    kind: 'indexeddb',
    get: (key) => run('readonly', (s) => s.get(key)),
    set: (key, value) => run('readwrite', (s) => s.put(value, key)),
    remove: (key) => run('readwrite', (s) => s.delete(key)),
  };
}

/**
 * Workspaces keep real and demo data physically separate (different keys). Demo data can
 * only ever be written to the "demo" workspace.
 */
export function createStore(backend) {
  const keyOf = (ws) => {
    if (!WORKSPACES.includes(ws)) throw new Error('unknown_workspace');
    return `db:${ws}`;
  };
  return {
    backend,
    async load(ws) {
      const raw = await backend.get(keyOf(ws));
      if (!raw) return createEmptyDb({ isDemo: ws === 'demo' });
      const db = normalizeDb(raw);
      if (Boolean(db.meta.isDemo) !== (ws === 'demo')) throw new Error('workspace_mismatch');
      return db;
    },
    async save(ws, db) {
      if (Boolean(db.meta.isDemo) !== (ws === 'demo')) throw new Error('workspace_mismatch');
      await backend.set(keyOf(ws), db);
    },
    async clear(ws) { await backend.remove(keyOf(ws)); },
  };
}
