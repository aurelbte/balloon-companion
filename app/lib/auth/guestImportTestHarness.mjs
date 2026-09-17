// In-memory IndexedDB model: serialized transactions, rollback and unique add.
export function memoryStorage(entries = {}) {
  const values = new Map(Object.entries(entries));
  return { get length() { return values.size; }, key: i => [...values.keys()][i] ?? null,
    getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k), snapshot: () => Object.fromEntries(values) };
}
export function memoryFactory() {
  const databases = new Map();
  function database(name) {
    let stores = new Map(), paths = new Map(), busy = false; const queue = [];
    const db = { name, close() {}, objectStoreNames: { contains: key => stores.has(key) },
      createObjectStore(key, options) { stores.set(key, new Map()); paths.set(key, options.keyPath); return { createIndex() {} }; },
      seed(store, row, keyPath = 'id') { if (!stores.has(store)) { stores.set(store, new Map()); paths.set(store, keyPath); } stores.get(store).set(row[keyPath], structuredClone(row)); },
      rows(store) { return [...(stores.get(store)?.values() ?? [])].map(v => structuredClone(v)); },
      transaction(names, mode = 'readonly') {
        for (const name of typeof names === 'string' ? [names] : names) if (!stores.has(name)) throw Error('Missing store');
        let working, aborted = false; const operations = [];
        const tx = { error: null, abort() { aborted = true; tx.error ??= Error('aborted'); }, objectStore(name) {
          const request = operation => { const r = {}; operations.push(() => { try { r.result = operation(working.get(name)); r.onsuccess?.(); } catch (e) { r.error = tx.error = e; r.onerror?.(); tx.abort(); } }); return r; };
          return { get: key => request(s => structuredClone(s.get(key))), getAll: () => request(s => [...s.values()].map(v => structuredClone(v))),
            add: row => request(s => { const key = row[paths.get(name)]; if (s.has(key)) throw Error('ConstraintError'); s.set(key, structuredClone(row)); return key; }),
            put: row => request(s => { const key = row[paths.get(name)]; s.set(key, structuredClone(row)); return key; }) };
        } };
        queue.push(() => { working = structuredClone(stores); const step = () => {
          if (!aborted && operations.length) { operations.shift()(); queueMicrotask(step); return; }
          if (aborted) tx.onabort?.(); else { if (mode === 'readwrite') stores = working; tx.oncomplete?.(); }
          busy = false; start();
        }; queueMicrotask(step); }); queueMicrotask(start); return tx;
      } };
    function start() { if (!busy && queue.length) { busy = true; queue.shift()(); } }
    return db;
  }
  return { peek: name => databases.get(name), databases: async () => [...databases.keys()].map(name => ({ name, version: 1 })), db(name) { if (!databases.has(name)) databases.set(name, database(name)); return databases.get(name); },
    open(name) { const r = {}; queueMicrotask(() => { const fresh = !databases.has(name); r.result = this.db(name); if (fresh) { let abort = false; r.transaction = { abort() { abort = true; } }; r.onupgradeneeded?.(); if (abort) { databases.delete(name); r.error = Error('aborted upgrade'); r.onerror?.(); return; } } r.onsuccess?.(); }); return r; } };
}
