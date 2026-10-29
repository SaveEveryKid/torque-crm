import { clearCookie, loggedIn, passwordOk, sessionCookie } from './auth';
import { dialerBase, json, type Env } from './env';
import { MAX_VALUE, PAGE, readRows, writeRows } from './store';
import { checkSms, incomingSms, sendSms, smsSetup, smsStatus } from './sms';

/**
 * TORQUE CRM's server (a Cloudflare Worker). /api/* and /dealer/* come here;
 * everything else is the app itself (dist/, served by Cloudflare).
 *
 *   POST   /api/login           log in (sets a 30-day cookie)
 *   DELETE /api/login           log out
 *   GET    /api/data            your data, a page at a time
 *   POST   /api/data            save changed rows
 *   GET    /api/status          what's set up (never the secrets)
 *   POST   /api/dialer/api      → your dialer's /api   (password added here)
 *   POST   /api/dialer/draft    → your dialer's /draft (password added here)
 *   GET    /dealer/Inventory/…  the dealer's inventory page
 *   POST   /api/sms/send        send a text (see sms.ts)
 *   POST   /sms/incoming|status SignalWire's texts in and delivery updates (key in the address)
 */
const SETUP_PASSWORD = 'Torque CRM has no password yet. Add APP_PASSWORD in Cloudflare (see the README).';
const SETUP_DB = 'No database yet. Add the D1 database to wrangler.jsonc (see the README).';
const DEALER = 'https://www.shoalsoutdoorsports.com';

async function login(request: Request, env: Env): Promise<Response> {
  if (!env.APP_PASSWORD) return json(503, { error: SETUP_PASSWORD, setup: true });
  if (request.method === 'DELETE') return json(200, { ok: true }, { 'Set-Cookie': clearCookie });
  if (request.method !== 'POST') return json(405, { error: 'POST only.' });
  const body = (await request.json().catch(() => ({}))) as { password?: string };
  if (!(await passwordOk(env, String(body.password ?? '')))) {
    await new Promise((r) => setTimeout(r, 1200)); // slows down guessing
    return json(401, { error: 'Wrong password.' });
  }
  return json(200, { ok: true }, { 'Set-Cookie': await sessionCookie(env) });
}

async function data(request: Request, env: Env): Promise<Response> {
  if (!env.DB) return json(503, { error: SETUP_DB, setup: true });
  if (request.method === 'GET') {
    const q = new URL(request.url).searchParams;
    const since = Number(q.get('since') ?? 0) || 0;
    const now = Date.now();
    const rows = await readRows(env.DB, since, q.get('after') ?? '');
    return json(200, { rows, now, more: rows.length === PAGE ? rows[rows.length - 1].k : null });
  }
  if (request.method !== 'POST') return json(405, { error: 'GET or POST.' });
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
}

/** Passes a request to your dialer, adding the dialer password (a Cloudflare secret the browser never sees). */
async function dialer(request: Request, env: Env, path: string): Promise<Response> {
  if (request.method !== 'POST' || (path !== '/api' && path !== '/draft')) return json(404, { error: 'Not found.' });
  const base = dialerBase(env.DIALER_URL);
  if (!env.DIALER_URL || !env.DIALER_PASSWORD) return json(503, { error: 'The dialer isn’t set up yet. Add DIALER_URL and DIALER_PASSWORD in Cloudflare (see the README).' });
  if (!base) return json(503, { error: `DIALER_URL doesn't look like an address: "${env.DIALER_URL.slice(0, 80)}". It should look like https://torque-dialer.yourname.workers.dev` });
  const form = new URLSearchParams(await request.text());
  form.set('token', env.DIALER_PASSWORD.trim());
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, { method: 'POST', body: form });
  } catch (e) {
    return json(502, { error: `Couldn't reach your dialer at ${base}: ${(e as Error).message}` });
  }
  const type = res.headers.get('Content-Type') ?? '';
  if (!type.includes('json')) {
    // Not the dialer answering (e.g. a Cloudflare error page): say what came back.
    const text = (await res.text()).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return json(502, { error: `Your dialer at ${base} didn't answer properly (${res.status}): ${text.slice(0, 160) || 'empty reply'}` });
  }
  return new Response(res.body, { status: res.status, headers: { 'Content-Type': type, 'Cache-Control': 'no-store' } });
}

/** The dealer's inventory page (GET only, inventory pages only), cached for 15 minutes. */
async function dealer(request: Request, path: string): Promise<Response> {
  if (request.method !== 'GET' || !/^\/Inventory\/[\w-]+$/.test(path)) return json(404, { error: 'Only inventory pages.' });
  const res = await fetch(`${DEALER}${path}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    cf: { cacheTtl: 900, cacheEverything: true },
  });
  return new Response(res.body, { status: res.status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, max-age=300' } });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const isApi = path.startsWith('/api/');
    if (path === '/sms/incoming' && request.method === 'POST') return incomingSms(request, env);
    if (path === '/sms/status' && request.method === 'POST') return smsStatus(request, env);
    if (!isApi && !path.startsWith('/dealer/')) return env.ASSETS.fetch(request);
    if (path === '/api/login') return login(request, env);
    if (!env.APP_PASSWORD) return json(503, { error: SETUP_PASSWORD, setup: true });
    if (!(await loggedIn(request, env))) return json(401, { error: 'Please log in.' });
    if (path === '/api/data') return data(request, env);
    if (path === '/api/status')
      return json(200, {
        dialer: Boolean(dialerBase(env.DIALER_URL) && env.DIALER_PASSWORD),
        dialerUrl: dialerBase(env.DIALER_URL) ?? env.DIALER_URL ?? null,
        database: Boolean(env.DB),
        sms: await smsSetup(env, url.origin),
      });
    if (path === '/api/sms/send' && request.method === 'POST') return sendSms(request, env, url.origin);
    if (path === '/api/sms/check') return checkSms(env);
    if (path.startsWith('/api/dialer/')) return dialer(request, env, path.slice('/api/dialer'.length));
    if (path.startsWith('/dealer/')) return dealer(request, path.slice('/dealer'.length));
    return json(404, { error: 'Not found.' });
  },
} satisfies ExportedHandler<Env>;
