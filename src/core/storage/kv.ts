/**
 * Storage for Torque CRM: your Cloudflare database (D1, through /api/data).
 * Everything is loaded into memory when the app opens (kv.ready()), so reads
 * are instant; each change is saved to Cloudflare right away (only what
 * changed: one row per customer). Changes made on your other devices are
 * picked up when you come back to this window and every minute.
 *
 * Same shape as the extension's chrome.storage.local, so the Torque modules
 * work unchanged. In tests (no server) it's memory only.
 */
type Listener = (changed: string[]) => void;

/** Saved one row per entry, so one customer's change doesn't re-send everyone. */
const SPLIT = new Set(['customers', 'sentMessages', 'sms', 'trainingCards']);
/** Bigger values are saved in parts. */
const CHUNK = 400_000;
/** How often to check for changes (and new texts) while the window is open. */
const POLL_MS = 15_000;
const MAX_REQUEST = 200_000;

const cache = new Map<string, unknown>();
const listeners = new Set<Listener>();
/** What the server has for each row (to send only changes). */
const synced = new Map<string, string>();
/** Rows waiting to be saved: row key → JSON (null = delete). */
const pending = new Map<string, string | null>();
let remote = false;
let lastSync = 0;
let loading: Promise<void> | null = null;
let flushing: Promise<void> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

export type SyncState = { status: 'saved' | 'saving' | 'error' | 'local'; error?: string };
let syncState: SyncState = { status: 'local' };
const syncListeners = new Set<(s: SyncState) => void>();
function setSync(s: SyncState) {
  syncState = s;
  syncListeners.forEach((l) => l(s));
}

/** Not logged in, or Cloudflare isn't set up yet (setup = true). */
export class AuthError extends Error {
  constructor(
    message: string,
    readonly setup = false,
  ) {
    super(message);
  }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: 'same-origin', ...init });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string; setup?: boolean };
  if (res.status === 401 || (res.status === 503 && body.setup)) throw new AuthError(body.error ?? 'Please log in.', !!body.setup);
  if (!res.ok) throw new Error(body.error ?? `Server error ${res.status}`);
  return body;
}

const clone = <T>(v: T): T => (v === undefined ? v : structuredClone(v));
const current = (k: string) => (pending.has(k) ? pending.get(k) : synced.get(k));

/** The rows that change when `key` is set to `value` (undefined = removed). */
function rowsFor(key: string, value: unknown): Map<string, string | null> {
  const out = new Map<string, string | null>();
  const next = new Map<string, string>();
  if (value !== undefined) {
    if (SPLIT.has(key) && value && typeof value === 'object') {
      for (const [id, v] of Object.entries(value as Record<string, unknown>)) next.set(`${key}/${id}`, JSON.stringify(v));
      next.set(key, '{"$split":true}');
    } else {
      const s = JSON.stringify(value);
      if (s.length <= CHUNK) next.set(key, s);
      else {
        const n = Math.ceil(s.length / CHUNK);
        for (let i = 0; i < n; i++) next.set(`${key}#${i}`, s.slice(i * CHUNK, (i + 1) * CHUNK));
        next.set(key, JSON.stringify({ $chunks: n }));
      }
    }
  }
  for (const [k, v] of next) if (current(k) !== v) out.set(k, v);
  const mine = new Set([...synced.keys(), ...pending.keys()].filter((k) => k === key || k.startsWith(`${key}/`) || k.startsWith(`${key}#`)));
  for (const k of mine) if (!next.has(k) && current(k) != null) out.set(k, null);
  return out;
}

/** Rebuild stored values from rows. */
function decode(rows: Map<string, string>): Map<string, unknown> {
  const out = new Map<string, unknown>();
  // "customers/<id>" rows make the customers map (the server writes "sms/<id>" rows with no head row).
  for (const [k, v] of rows) {
    const slash = k.indexOf('/');
    if (slash < 0 || k.includes('#')) continue;
    const key = k.slice(0, slash);
    const m = (out.get(key) as Record<string, unknown> | undefined) ?? {};
    m[k.slice(slash + 1)] = JSON.parse(v);
    out.set(key, m);
  }
  for (const [k, v] of rows) {
    if (k.includes('/') || k.includes('#')) continue;
    const head = JSON.parse(v) as unknown;
    const meta = (head && typeof head === 'object' ? head : {}) as { $split?: boolean; $chunks?: number };
    if (meta.$split) {
      if (!out.has(k)) out.set(k, {});
    } else if (meta.$chunks) {
      const parts = Array.from({ length: meta.$chunks }, (_, i) => rows.get(`${k}#${i}`) ?? '');
      try {
        out.set(k, JSON.parse(parts.join('')));
      } catch {
        /* a part is still on its way from another device: next sync */
      }
    } else out.set(k, head);
  }
  return out;
}

const topKey = (rowKey: string) => rowKey.split(/[/#]/)[0];

/** Apply rows from the server (skipping ones you changed and haven't saved yet). */
function applyRows(rows: { k: string; v: string | null }[]): string[] {
  const touched = new Set<string>();
  for (const r of rows) {
    if (pending.has(r.k)) continue;
    if (r.v === null) synced.delete(r.k);
    else synced.set(r.k, r.v);
    touched.add(topKey(r.k));
  }
  if (!touched.size) return [];
  const live = new Map(synced);
  for (const [k, v] of pending) if (v === null) live.delete(k);
  else live.set(k, v);
  const values = decode(live);
  for (const k of touched) {
    if (values.has(k)) cache.set(k, values.get(k));
    else cache.delete(k);
  }
  return [...touched];
}

async function pull(since: number): Promise<void> {
  const all: { k: string; v: string | null }[] = [];
  let after = '';
  let first = 0;
  for (;;) {
    const page = await api<{ rows: { k: string; v: string | null }[]; now: number; more: string | null }>(`/api/data?since=${since}&after=${encodeURIComponent(after)}`);
    first ||= page.now;
    all.push(...page.rows);
    if (!page.more) break;
    after = page.more;
  }
  lastSync = Math.max(lastSync, first - 5000);
  notify(applyRows(all));
}

async function load(): Promise<void> {
  if (typeof window === 'undefined') return; // tests: memory only
  await pull(0);
  remote = true;
  setSync({ status: 'saved' });
  const refresh = () => {
    if (document.visibilityState === 'visible' && !pending.size) void pull(lastSync).catch(() => undefined);
  };
  document.addEventListener('visibilitychange', refresh);
  setInterval(refresh, POLL_MS);
  addEventListener('beforeunload', (e) => {
    if (pending.size) e.preventDefault();
  });
}

function schedule(rows: Map<string, string | null>) {
  if (!remote || !rows.size) return;
  for (const [k, v] of rows) pending.set(k, v);
  void flush();
}

async function flush(): Promise<void> {
  if (flushing) return flushing;
  flushing = (async () => {
    while (pending.size) {
      // Small requests (Cloudflare's free plan allows little work per request).
      const batch = new Map<string, string | null>();
      let size = 0;
      for (const [k, v] of pending) {
        if (batch.size && size + (v?.length ?? 0) > MAX_REQUEST) break;
        batch.set(k, v);
        size += (v?.length ?? 0) + k.length;
      }
      setSync({ status: 'saving' });
      try {
        await api('/api/data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rows: Object.fromEntries(batch) }) });
      } catch (e) {
        setSync({ status: 'error', error: (e as Error).message });
        if (retryTimer) clearTimeout(retryTimer);
        retryTimer = setTimeout(() => void flush(), 5000);
        return;
      }
      for (const [k, v] of batch) {
        if (v === null) synced.delete(k);
        else synced.set(k, v);
        if (pending.get(k) === v) pending.delete(k);
      }
    }
    setSync({ status: 'saved' });
  })().finally(() => (flushing = null));
  return flushing;
}

function notify(keys: string[]) {
  if (keys.length) listeners.forEach((l) => l(keys));
}

export const kv = {
  ready(): Promise<void> {
    return (loading ??= load().catch((e) => {
      loading = null;
      throw e;
    }));
  },
  async get(keys: string | string[]): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {};
    for (const k of Array.isArray(keys) ? keys : [keys]) if (cache.has(k)) out[k] = clone(cache.get(k));
    return out;
  },
  async set(items: Record<string, unknown>): Promise<void> {
    const rows = new Map<string, string | null>();
    for (const [k, v] of Object.entries(items)) {
      cache.set(k, clone(v));
      if (remote) for (const [rk, rv] of rowsFor(k, v)) rows.set(rk, rv);
    }
    notify(Object.keys(items));
    schedule(rows);
  },
  async remove(keys: string | string[]): Promise<void> {
    const list = Array.isArray(keys) ? keys : [keys];
    const rows = new Map<string, string | null>();
    for (const k of list) {
      cache.delete(k);
      if (remote) for (const [rk, rv] of rowsFor(k, undefined)) rows.set(rk, rv);
    }
    notify(list);
    schedule(rows);
  },
  /** Everything stored (for backups). */
  all(): Record<string, unknown> {
    return Object.fromEntries([...cache].map(([k, v]) => [k, clone(v)]));
  },
  onChange(l: Listener): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  sync: () => syncState,
  onSync(l: (s: SyncState) => void): () => void {
    syncListeners.add(l);
    return () => syncListeners.delete(l);
  },
  /** Save anything still waiting (e.g. before logging out). */
  flush,
  /** Check for changes now (e.g. right after sending a text). */
  refresh: () => pull(lastSync),
};

export async function login(password: string): Promise<void> {
  await api('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
}

export async function logout(): Promise<void> {
  await flush();
  await fetch('/api/login', { method: 'DELETE', credentials: 'same-origin' });
  location.reload();
}

/** For tests: the row logic without a server. */
export const _rows = { rowsFor, decode, applyRows, synced, pending };
