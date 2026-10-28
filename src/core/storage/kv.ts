/**
 * Local storage for Torque CRM: one IndexedDB database on this computer.
 * Everything is read into memory once at startup (kv.ready()), so reads are
 * instant; every write is saved to disk right away. Same shape as the
 * extension's chrome.storage.local, so the Torque modules work unchanged.
 */
type Listener = (changed: string[]) => void;

const DB = 'torque-crm';
const STORE = 'kv';
const cache = new Map<string, unknown>();
const listeners = new Set<Listener>();
let db: IDBDatabase | null = null;
let loading: Promise<void> | null = null;

const req = <T>(r: IDBRequest<T>) =>
  new Promise<T>((ok, fail) => {
    r.onsuccess = () => ok(r.result);
    r.onerror = () => fail(r.error);
  });

function open(): Promise<IDBDatabase> {
  return new Promise((ok, fail) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => ok(r.result);
    r.onerror = () => fail(r.error);
  });
}

async function load(): Promise<void> {
  if (typeof indexedDB === 'undefined') return; // tests: memory only
  db = await open();
  const tx = db.transaction(STORE, 'readonly').objectStore(STORE);
  const [keys, values] = await Promise.all([req(tx.getAllKeys()), req(tx.getAll())]);
  keys.forEach((k, i) => cache.set(String(k), values[i]));
}

function persist(put: Record<string, unknown>, del: string[]) {
  if (!db) return;
  const store = db.transaction(STORE, 'readwrite').objectStore(STORE);
  for (const [k, v] of Object.entries(put)) store.put(v, k);
  for (const k of del) store.delete(k);
}

function notify(keys: string[]) {
  if (keys.length) listeners.forEach((l) => l(keys));
}

const clone = <T>(v: T): T => (v === undefined ? v : structuredClone(v));

export const kv = {
  ready(): Promise<void> {
    return (loading ??= load());
  },
  async get(keys: string | string[]): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {};
    for (const k of Array.isArray(keys) ? keys : [keys]) if (cache.has(k)) out[k] = clone(cache.get(k));
    return out;
  },
  async set(items: Record<string, unknown>): Promise<void> {
    for (const [k, v] of Object.entries(items)) cache.set(k, clone(v));
    persist(items, []);
    notify(Object.keys(items));
  },
  async remove(keys: string | string[]): Promise<void> {
    const list = Array.isArray(keys) ? keys : [keys];
    list.forEach((k) => cache.delete(k));
    persist({}, list);
    notify(list);
  },
  /** Everything stored (for backups). */
  all(): Record<string, unknown> {
    return Object.fromEntries([...cache].map(([k, v]) => [k, clone(v)]));
  },
  onChange(l: Listener): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};
