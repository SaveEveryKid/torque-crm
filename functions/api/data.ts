import { json, type Env } from '../_lib/env';
import { MAX_VALUE, PAGE, readRows, writeRows } from '../_lib/store';

/** GET ?since=ms&after=key → a page of rows saved after that (since 0 = everything); `more` = ask again with after=more. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.DB) return json(503, { error: 'No database yet. Add the D1 binding named DB in Cloudflare (see the README).', setup: true });
  const q = new URL(request.url).searchParams;
  const since = Number(q.get('since') ?? 0) || 0;
  const now = Date.now();
  const rows = await readRows(env.DB, since, q.get('after') ?? '');
  return json(200, { rows, now, more: rows.length === PAGE ? rows[rows.length - 1].k : null });
};

/** POST {rows: {key: json | null}} → saved (null deletes). */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.DB) return json(503, { error: 'No database yet. Add the D1 binding named DB in Cloudflare (see the README).', setup: true });
  if (!(request.headers.get('Content-Type') ?? '').startsWith('application/json')) return json(415, { error: 'JSON only.' });
  const body = (await request.json().catch(() => null)) as { rows?: Record<string, unknown> } | null;
  const rows: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(body?.rows ?? {})) {
    if (k.length > 300 || (v !== null && typeof v !== 'string')) return json(400, { error: `Bad row ${k.slice(0, 40)}` });
    if (typeof v === 'string' && v.length > MAX_VALUE) return json(413, { error: `Row ${k.slice(0, 40)} is too big.` });
    rows[k] = v;
  }
  const now = Date.now();
  await writeRows(env.DB, rows, now);
  return json(200, { now });
};
