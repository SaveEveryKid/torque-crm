import { json, type Env } from './env';
import { readRow, rowsWithPrefix, writeRows } from './store';

/**
 * TEXTING through your SignalWire number. One text at a time, sent only when
 * you press Send. Every text (in and out) is saved as an "sms/<id>" row; the
 * app puts it on the customer's timeline.
 *
 *   POST /api/sms/send        send one text (logged in)
 *   POST /sms/incoming?k=…    SignalWire: a customer texted you
 *   POST /sms/status?k=…      SignalWire: delivered / failed
 *
 * The k=… key in SignalWire's addresses is made from your APP_PASSWORD, so
 * nobody else can post fake texts in. (Changing APP_PASSWORD changes it.)
 */
export interface SmsRow {
  id: string;
  at: string;
  direction: 'INBOUND' | 'OUTBOUND';
  /** The customer's number (+1…). */
  phone: string;
  body: string;
  media?: string[];
  /** The customer it belongs to (null: nobody with that number yet). */
  customerId: string | null;
  status: string;
  error?: string | null;
  /** They texted STOP (or START again). */
  optOut?: boolean;
  optIn?: boolean;
}

const OPT_OUT = /^\s*(stop|stopall|unsubscribe|cancel|end|quit|optout|opt out|revoke)\s*[.!]*\s*$/i;
const OPT_IN = /^\s*(start|unstop|subscribe|yes)\s*[.!]*\s*$/i;

export const isOptOut = (body: string) => OPT_OUT.test(body);
export const isOptIn = (body: string) => OPT_IN.test(body);

/** 10 digits, no country code ("" if not a US number). */
export function digits(phone: string): string {
  let d = (phone || '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  return d.length === 10 ? d : '';
}

export const smsReady = (env: Env) => Boolean(env.SW_SPACE && env.SW_PROJECT_ID && env.SW_API_TOKEN && digits(env.SMS_FROM ?? ''));

async function hmac(secret: string, data: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(`torque-crm-sms:${secret}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
  return [...mac.slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The key in SignalWire's addresses. */
export const webhookKey = (env: Env) => hmac(env.APP_PASSWORD ?? '', 'webhook');

function swBase(env: Env): string {
  const space = (env.SW_SPACE ?? '').trim().replace(/\/+$/, '');
  return /^https?:\/\//.test(space) ? space : `https://${space}`;
}

/** Find the customer with this number (main or other phone). */
export function matchCustomer(rows: { k: string; v: string | null }[], phone: string): string | null {
  const want = digits(phone);
  if (!want) return null;
  for (const r of rows) {
    if (!r.v) continue;
    try {
      const c = JSON.parse(r.v) as { phone?: string; altPhone?: string };
      if (digits(c.phone ?? '') === want || digits(c.altPhone ?? '') === want) return r.k.slice('customers/'.length);
    } catch {
      /* skip a damaged row */
    }
  }
  return null;
}

async function save(env: Env, row: SmsRow) {
  await writeRows(env.DB, { [`sms/${row.id}`]: JSON.stringify(row) }, Date.now());
}

const laml = () => new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', { headers: { 'Content-Type': 'text/xml' } });

/** POST {customerId, to, body} → sends it and returns the saved text. */
export async function sendSms(request: Request, env: Env, origin: string): Promise<Response> {
  if (!smsReady(env)) return json(503, { error: 'Texting isn’t set up yet. Add SW_SPACE, SW_PROJECT_ID, SW_API_TOKEN and SMS_FROM in Cloudflare (see Settings).' });
  const b = (await request.json().catch(() => ({}))) as { customerId?: string; to?: string; body?: string };
  const to = digits(b.to ?? '');
  const body = (b.body ?? '').trim();
  if (!to) return json(400, { error: 'That phone number isn’t a 10-digit US number.' });
  if (!body) return json(400, { error: 'The text is empty.' });
  if (body.length > 1600) return json(400, { error: 'That text is too long (1,600 characters at most).' });
  if (b.customerId) {
    const raw = await readRow(env.DB, `customers/${b.customerId}`);
    const c = raw ? (JSON.parse(raw) as { doNotText?: boolean; doNotContact?: boolean }) : null;
    if (c?.doNotText || c?.doNotContact) return json(403, { error: 'This customer is marked do not text.' });
  }
  const key = await webhookKey(env);
  const form = new URLSearchParams({ From: `+1${digits(env.SMS_FROM!)}`, To: `+1${to}`, Body: body, StatusCallback: `${origin}/sms/status?k=${key}` });
  let res: Response;
  try {
    res = await fetch(`${swBase(env)}/api/laml/2010-04-01/Accounts/${env.SW_PROJECT_ID}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: `Basic ${btoa(`${env.SW_PROJECT_ID}:${env.SW_API_TOKEN}`)}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form,
    });
  } catch (e) {
    return json(502, { error: `Couldn't reach SignalWire: ${(e as Error).message}` });
  }
  const out = (await res.json().catch(() => ({}))) as { sid?: string; status?: string; message?: string; code?: number; error_message?: string };
  if (!res.ok || !out.sid) return json(502, { error: `SignalWire didn't send it: ${out.message ?? out.error_message ?? `error ${res.status}`}${out.code ? ` (code ${out.code})` : ''}` });
  const row: SmsRow = { id: out.sid, at: new Date().toISOString(), direction: 'OUTBOUND', phone: `+1${to}`, body, customerId: b.customerId ?? null, status: out.status ?? 'queued' };
  await save(env, row);
  return json(200, row);
}

async function keyOk(request: Request, env: Env) {
  const k = new URL(request.url).searchParams.get('k') ?? '';
  return Boolean(env.APP_PASSWORD) && k === (await webhookKey(env));
}

/** SignalWire posts each text you receive here. */
export async function incomingSms(request: Request, env: Env): Promise<Response> {
  if (!(await keyOk(request, env))) return new Response('Forbidden', { status: 403 });
  const f = new URLSearchParams(await request.text());
  const id = f.get('MessageSid') ?? f.get('SmsSid') ?? crypto.randomUUID();
  const from = f.get('From') ?? '';
  const body = f.get('Body') ?? '';
  const media = Array.from({ length: Number(f.get('NumMedia') ?? 0) || 0 }, (_, i) => f.get(`MediaUrl${i}`) ?? '').filter(Boolean);
  const customers = await rowsWithPrefix(env.DB, 'customers/');
  await save(env, {
    id,
    at: new Date().toISOString(),
    direction: 'INBOUND',
    phone: digits(from) ? `+1${digits(from)}` : from,
    body,
    ...(media.length ? { media } : {}),
    customerId: matchCustomer(customers, from),
    status: 'received',
    ...(isOptOut(body) ? { optOut: true } : isOptIn(body) ? { optIn: true } : {}),
  });
  return laml(); // no auto-reply
}

/** SignalWire posts delivery updates here (sent, delivered, failed…). */
export async function smsStatus(request: Request, env: Env): Promise<Response> {
  if (!(await keyOk(request, env))) return new Response('Forbidden', { status: 403 });
  const f = new URLSearchParams(await request.text());
  const id = f.get('MessageSid') ?? '';
  const raw = id ? await readRow(env.DB, `sms/${id}`) : null;
  if (raw) {
    const row = JSON.parse(raw) as SmsRow;
    const code = f.get('ErrorCode');
    await save(env, { ...row, status: f.get('MessageStatus') ?? row.status, error: code && code !== '0' ? `${code}${f.get('ErrorMessage') ? `: ${f.get('ErrorMessage')}` : ''}` : (row.error ?? null) });
  }
  return new Response(null, { status: 204 });
}

/** For Settings: the address to paste into SignalWire (only when logged in). */
export async function smsSetup(env: Env, origin: string) {
  return { ready: smsReady(env), from: env.SMS_FROM ?? null, incomingUrl: env.APP_PASSWORD ? `${origin}/sms/incoming?k=${await webhookKey(env)}` : null };
}
