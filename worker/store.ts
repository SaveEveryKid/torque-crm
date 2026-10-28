/**
 * YOUR DATA in D1: one row per item (each customer is its own row, so saving
 * one customer never re-sends the rest). A deleted item keeps an empty row
 * for a while, so your other devices learn it was deleted.
 */
export interface Row {
  k: string;
  /** JSON text; null = deleted. */
  v: string | null;
  /** When it was saved (ms). */
  t: number;
}

const SCHEMA = 'CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT, t INTEGER NOT NULL)';
const INDEX = 'CREATE INDEX IF NOT EXISTS kv_t ON kv (t)';
let ready = false;

async function init(db: D1Database) {
  if (ready) return;
  await db.batch([db.prepare(SCHEMA), db.prepare(INDEX)]);
  ready = true;
}

/**
 * One page of rows, in key order after `after`: everything (since = 0,
 * deleted rows left out) or what changed after `since`. Pages keep each
 * request small (Cloudflare's free plan allows little work per request).
 */
export const PAGE = 100;
export async function readRows(db: D1Database, since: number, after = ''): Promise<Row[]> {
  await init(db);
  const q =
    since > 0
      ? db.prepare('SELECT k, v, t FROM kv WHERE t > ?1 AND k > ?2 ORDER BY k LIMIT ?3').bind(since, after, PAGE)
      : db.prepare('SELECT k, v, t FROM kv WHERE v IS NOT NULL AND k > ?1 ORDER BY k LIMIT ?2').bind(after, PAGE);
  return (await q.all<Row>()).results;
}

export const MAX_VALUE = 1_000_000;

export async function writeRows(db: D1Database, rows: Record<string, string | null>, now: number): Promise<void> {
  await init(db);
  const stmts = Object.entries(rows).map(([k, v]) =>
    db.prepare('INSERT INTO kv (k, v, t) VALUES (?1, ?2, ?3) ON CONFLICT(k) DO UPDATE SET v = excluded.v, t = excluded.t').bind(k, v, now),
  );
  for (let i = 0; i < stmts.length; i += 50) await db.batch(stmts.slice(i, i + 50));
  // Forget deletions older than 90 days (every device has synced by then).
  await db.prepare('DELETE FROM kv WHERE v IS NULL AND t < ?1').bind(now - 90 * 86_400_000).run();
}

/** Every saved row whose key starts with `prefix` (e.g. "customers/"), deleted ones left out. */
export async function rowsWithPrefix(db: D1Database, prefix: string): Promise<Row[]> {
  await init(db);
  return (await db.prepare('SELECT k, v, t FROM kv WHERE k >= ?1 AND k < ?2 AND v IS NOT NULL').bind(prefix, `${prefix}￿`).all<Row>()).results;
}

export async function readRow(db: D1Database, k: string): Promise<string | null> {
  await init(db);
  return (await db.prepare('SELECT v FROM kv WHERE k = ?1').bind(k).first<{ v: string | null }>())?.v ?? null;
}
