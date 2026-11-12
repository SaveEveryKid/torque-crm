import { json, type Env } from './env';
import { digits, matchCustomer, sendViaDialer, viaDialer, webhookKey } from './sms';
import { readRow, rowsWithPrefix, writeRows } from './store';

/**
 * WEBSITE LEADS from RideWithByron.com. The site posts each lead here, signed
 * with a secret both Workers share (LEADS_SECRET here = TORQUE_SIGNING_SECRET
 * there). The lead is saved as its own row ("webLeads/<id>"), the same way
 * texts are; the app then puts it on the right customer (or makes one).
 *
 *   POST /leads/intake
 *   X-RWB-Timestamp: <seconds>     X-RWB-Signature: sha256=<hex HMAC of "timestamp.body">
 */
export interface WebLead {
  id: string;
  at: string;
  name: string;
  /** +1XXXXXXXXXX */
  phone: string;
  email: string;
  /** quote | availability | visit | financing | question | text */
  type: string;
  /** "Get My Best Quote" */
  label: string;
  message: string;
  preferredTime: string;
  vehicle: { id: string; title: string; stock: string | null; url: string | null } | null;
  /** "Google Ads", "Facebook Marketplace", "Direct"… */
  source: string;
  campaign: string;
  /** The customer with this phone, if Torque already has them. */
  customerId: string | null;
}

const MAX_BODY = 20_000;
/** A signed request is good for 5 minutes (stops a captured one being replayed later). */
const MAX_AGE_S = 300;

async function hmacHex(secret: string, data: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** Is this request really from the site? (null = yes; otherwise why not.) */
export async function checkSignature(secret: string, timestamp: string, signature: string, body: string, nowMs = Date.now()): Promise<string | null> {
  if (!/^\d{9,11}$/.test(timestamp)) return 'Missing timestamp.';
  if (Math.abs(nowMs / 1000 - Number(timestamp)) > MAX_AGE_S) return 'Request is too old.';
  const want = `sha256=${await hmacHex(secret, `${timestamp}.${body}`)}`;
  return same(signature, want) ? null : 'Bad signature.';
}

const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max) : '');
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** The site's payload → what Torque keeps (null if it isn't a usable lead). */
export function readLead(payload: unknown, nowIso = new Date().toISOString()): Omit<WebLead, 'customerId'> | null {
  const p = obj(payload);
  const contact = obj(p.contact);
  const inquiry = obj(p.inquiry);
  const attribution = obj(p.attribution);
  const id = text(p.idempotency_key, 80).replace(/[^\w-]/g, '');
  const name = text(contact.name, 80);
  const d = digits(text(contact.phone, 30));
  if (!id || !name || !d) return null;
  const v = p.vehicle ? obj(p.vehicle) : null;
  const url = v ? text(v.url, 300) : '';
  const at = text(p.occurred_at, 40);
  return {
    id,
    at: at && !Number.isNaN(Date.parse(at)) ? new Date(at).toISOString() : nowIso,
    name,
    phone: `+1${d}`,
    email: text(contact.email, 120).toLowerCase(),
    type: text(inquiry.type, 20) || 'question',
    label: text(inquiry.label, 60) || 'Website inquiry',
    message: text(inquiry.message, 1500),
    preferredTime: text(inquiry.preferred_time, 80),
    vehicle: v && text(v.description, 160) ? { id: text(v.source_guid, 60) || text(v.stock_number, 40) || id, title: text(v.description, 160), stock: text(v.stock_number, 40) || null, url: /^https:\/\//.test(url) ? url : null } : null,
    source: text(attribution.source, 60) || 'Direct',
    campaign: text(attribution.utm_campaign, 120),
  };
}

/** The text you get on your own phone for a new lead (short enough to read on the lock screen). */
export function alertText(l: Omit<WebLead, 'customerId'>): string {
  const d = digits(l.phone);
  const phone = d ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : l.phone;
  const unit = l.vehicle ? `: ${l.vehicle.title}${l.vehicle.stock ? ` (#${l.vehicle.stock})` : ''}` : '';
  const said = l.message ? ` "${l.message.length > 120 ? `${l.message.slice(0, 117)}...` : l.message}"` : '';
  return `New website lead: ${l.name} ${phone}. ${l.label}${unit}.${said}${l.preferredTime ? ` Wants to come in: ${l.preferredTime}.` : ''}`.slice(0, 480);
}

/** Text the lead to your cell (LEAD_ALERT_TO) through your dialer. Never stops the lead being saved. */
async function alertByText(env: Env, origin: string, lead: Omit<WebLead, 'customerId'>): Promise<string> {
  const to = digits(env.LEAD_ALERT_TO ?? '');
  if (!to) return 'off';
  if (!viaDialer(env)) return 'no dialer';
  try {
    const sent = await sendViaDialer(env, `+1${to}`, alertText(lead), `${origin}/sms/status?k=${await webhookKey(env)}`);
    return 'error' in sent ? `failed: ${sent.error}` : 'sent';
  } catch (e) {
    return `failed: ${(e as Error).message}`;
  }
}

export async function leadIntake(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return json(405, { error: 'POST only.' });
  if (!env.LEADS_SECRET?.trim()) return json(503, { error: 'Website leads aren’t set up yet. Add LEADS_SECRET in Cloudflare (see the README).', setup: true });
  if (!env.DB) return json(503, { error: 'No database yet.', setup: true });
  const body = await request.text();
  if (body.length > MAX_BODY) return json(413, { error: 'Too big.' });
  const bad = await checkSignature(env.LEADS_SECRET.trim(), request.headers.get('X-RWB-Timestamp') ?? '', request.headers.get('X-RWB-Signature') ?? '', body);
  if (bad) return json(401, { error: bad });
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return json(400, { error: 'Not JSON.' });
  }
  const lead = readLead(payload);
  if (!lead) return json(422, { error: 'A lead needs a name and a 10-digit phone number.' });
  const key = `webLeads/${lead.id}`;
  // The site retries until it hears back: the same lead twice is saved once.
  if (await readRow(env.DB, key)) return json(200, { ok: true, id: lead.id, duplicate: true });
  const row: WebLead = { ...lead, customerId: matchCustomer(await rowsWithPrefix(env.DB, 'customers/'), lead.phone) };
  await writeRows(env.DB, { [key]: JSON.stringify(row) }, Date.now());
  // Saved first; the text to your phone comes after and can't undo that.
  const alert = await alertByText(env, new URL(request.url).origin, lead);
  return json(200, { ok: true, id: lead.id, alert });
}
