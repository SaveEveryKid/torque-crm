import { json, type Env } from './env';
import { readRow, rowsWithPrefix, writeRows } from './store';
import { digits, isOptIn, isOptOut, matchCustomer, type SmsRow } from './sms';

/**
 * TEXTING THROUGH KENECT (the store's texting inbox). When the Kenect API
 * keys are set, texts you send from Torque go out through Kenect from the
 * store's number, and Kenect conversations with your Torque customers come
 * back into Torque (checked every few minutes, and when you press Sync).
 *
 * Keys: Kenect → Settings → Integrations → Zapier → Api Credentials →
 * Generate Key. Put them on the torque-crm Worker as secrets:
 *   KENECT_API_KEY, KENECT_API_SECRET, KENECT_LOCATION_ID,
 *   KENECT_PARTNER_LOCATION_ID, KENECT_PARTNER_LOCATION_ZIP
 *   KENECT_USER_EMAIL (optional: your Kenect login email, so texts show as sent by you)
 *
 * Only conversations with people already in Torque are brought in, so the
 * rest of the store's texting stays in Kenect.
 */
const BASE = 'https://integrations-api.kenect.com';
const SYNC_ROW = 'kenectSync';

export const kenectReady = (env: Env) =>
  Boolean(env.KENECT_API_KEY?.trim() && env.KENECT_API_SECRET?.trim() && env.KENECT_LOCATION_ID?.trim() && env.KENECT_PARTNER_LOCATION_ID?.trim() && env.KENECT_PARTNER_LOCATION_ZIP?.trim());

export const kenectMissing = (env: Env) =>
  (['KENECT_API_KEY', 'KENECT_API_SECRET', 'KENECT_LOCATION_ID', 'KENECT_PARTNER_LOCATION_ID', 'KENECT_PARTNER_LOCATION_ZIP'] as const).filter((k) => !env[k]?.trim());

function headers(env: Env): Record<string, string> {
  return {
    'X-Api-Key': env.KENECT_API_KEY!.trim(),
    'X-Api-Secret': env.KENECT_API_SECRET!.trim(),
    'X-Location-Id': env.KENECT_LOCATION_ID!.trim(),
    'X-Partner-Location-Id': env.KENECT_PARTNER_LOCATION_ID!.trim(),
    'X-Partner-Location-Zip': env.KENECT_PARTNER_LOCATION_ZIP!.trim(),
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

async function call<T>(env: Env, method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { method, headers: headers(env), ...(body ? { body: JSON.stringify(body) } : {}) });
  } catch (e) {
    return { ok: false, error: `Couldn't reach Kenect: ${(e as Error).message}` };
  }
  const raw = await res.text();
  let data: unknown = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    /* not JSON: reported below */
  }
  if (res.status === 401 || res.status === 403) return { ok: false, error: `Kenect didn't accept the API keys (${res.status}). Generate them again in Kenect → Settings → Integrations → Zapier → Api Credentials.` };
  if (!res.ok) {
    const msg = (data as { message?: string; error?: string } | null)?.message ?? (data as { error?: string } | null)?.error ?? raw.replace(/\s+/g, ' ').slice(0, 160);
    return { ok: false, error: `Kenect answered ${res.status}: ${msg || 'no details'}` };
  }
  return { ok: true, data: data as T };
}

interface KenectMessage {
  id?: string | number;
  conversationId?: string | number;
  messageBody?: string;
  outgoing?: boolean;
  sentAt?: string;
  createdAt?: string;
  externalStatus?: string;
  status?: string;
  attachments?: { name?: string; url?: string }[];
}
interface KenectConversation {
  id?: string | number;
  contact?: { firstName?: string; lastName?: string; mobilePhone?: string };
  messages?: KenectMessage[];
}

/** Kenect's message → a Torque text row (same row id every time, so syncing twice changes nothing). */
export function rowFromKenect(m: KenectMessage, phone: string, customerId: string | null): SmsRow | null {
  if (m.id === undefined || m.id === null) return null;
  const body = m.messageBody ?? '';
  const inbound = !m.outgoing;
  const media = (m.attachments ?? []).map((a) => a.url ?? a.name ?? '').filter(Boolean);
  return {
    id: `kenect-${m.id}`,
    at: m.sentAt ?? m.createdAt ?? new Date().toISOString(),
    direction: inbound ? 'INBOUND' : 'OUTBOUND',
    phone: digits(phone) ? `+1${digits(phone)}` : phone,
    body,
    ...(media.length ? { media } : {}),
    customerId,
    status: inbound ? 'received' : (m.externalStatus ?? m.status ?? 'sent').toLowerCase(),
    ...(inbound && isOptOut(body) ? { optOut: true } : inbound && isOptIn(body) ? { optIn: true } : {}),
  };
}

/** Send one text through Kenect, from the store's Kenect number. */
export async function sendViaKenect(env: Env, to10: string, body: string, contactName: string): Promise<{ row: Omit<SmsRow, 'customerId'> } | { error: string }> {
  const sent = await call<KenectMessage>(env, 'POST', '/api/v1/messages', {
    contactPhone: to10,
    contactName: contactName || undefined,
    messageBody: body,
    ...(env.KENECT_USER_EMAIL?.trim() ? { sentByUserEmail: env.KENECT_USER_EMAIL.trim() } : {}),
  });
  if (!sent.ok) return { error: sent.error };
  const m = sent.data ?? {};
  const row = rowFromKenect({ ...m, id: m.id ?? crypto.randomUUID(), outgoing: true, messageBody: m.messageBody ?? body, sentAt: m.sentAt ?? new Date().toISOString() }, to10, null)!;
  return { row };
}

/**
 * Bring Kenect conversations with your Torque customers into Torque.
 * `days`: how far back to look (default: since the last sync, at least 1 hour).
 */
export async function syncKenect(env: Env, days?: number): Promise<{ checked: number; added: number; error?: string }> {
  if (!kenectReady(env)) return { checked: 0, added: 0, error: 'Kenect isn’t connected (add the KENECT_ keys in Cloudflare).' };
  const now = new Date();
  const last = await readRow(env.DB, SYNC_ROW);
  const lastAt = last ? (JSON.parse(last) as { at?: string }).at : null;
  const from = days ? new Date(now.getTime() - days * 86_400_000) : new Date(Math.min(now.getTime() - 3_600_000, lastAt ? new Date(lastAt).getTime() - 10 * 60_000 : now.getTime() - 86_400_000));
  const customers = await rowsWithPrefix(env.DB, 'customers/');
  const existing = new Set((await rowsWithPrefix(env.DB, 'sms/kenect-')).map((r) => r.k));
  const out: Record<string, string> = {};
  let checked = 0;
  for (let offset = 0; offset < 2000; offset += 100) {
    const q = new URLSearchParams({ beginAt: from.toISOString(), endAt: now.toISOString(), limit: '100', offset: String(offset) });
    const page = await call<KenectConversation[]>(env, 'GET', `/api/v1/messages?${q}`);
    if (!page.ok) return { checked, added: Object.keys(out).length, error: page.error };
    const convs = Array.isArray(page.data) ? page.data : [];
    for (const conv of convs) {
      checked++;
      const phone = conv.contact?.mobilePhone ?? '';
      const customerId = matchCustomer(customers, phone);
      if (!customerId) continue; // not one of yours: stays in Kenect only
      for (const m of conv.messages ?? []) {
        const when = m.sentAt ?? m.createdAt;
        if (when && new Date(when) < from) continue;
        const row = rowFromKenect(m, phone, customerId);
        if (!row || existing.has(`sms/${row.id}`)) continue;
        out[`sms/${row.id}`] = JSON.stringify(row);
      }
    }
    if (convs.length < 100) break;
  }
  out[SYNC_ROW] = JSON.stringify({ at: now.toISOString(), checked });
  await writeRows(env.DB, out, Date.now());
  return { checked, added: Object.keys(out).length - 1 };
}

/** POST /api/kenect/sync?days=N (logged in): sync now. */
export async function kenectSyncRoute(request: Request, env: Env): Promise<Response> {
  const days = Number(new URL(request.url).searchParams.get('days') ?? 0) || undefined;
  const r = await syncKenect(env, days ? Math.min(days, 90) : undefined);
  return json(r.error ? 502 : 200, r);
}

/** Settings → Check: tries one small read (sends nothing). */
export async function checkKenect(env: Env): Promise<{ ok: boolean; message: string }> {
  if (!kenectReady(env)) return { ok: false, message: `Missing on the torque-crm Worker: ${kenectMissing(env).join(', ')}` };
  const now = new Date();
  const q = new URLSearchParams({ beginAt: new Date(now.getTime() - 86_400_000).toISOString(), endAt: now.toISOString(), limit: '1', offset: '0' });
  const r = await call<unknown[]>(env, 'GET', `/api/v1/messages?${q}`);
  return r.ok ? { ok: true, message: 'OK: Kenect accepted the keys. Texts go out through Kenect, and replies come back into Torque.' } : { ok: false, message: r.error };
}
