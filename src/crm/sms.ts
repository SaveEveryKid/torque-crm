import { useEffect } from 'react';
import { kv } from '../core/storage/kv';
import { normalizeUsPhone } from '../core/analysis/phone';
import { activity, blankCustomer, getCustomers, useStoredKey } from './store';
import type { Activity, Customer } from './types';

/**
 * TEXTING: send through your SignalWire number (Torque CRM's server sends
 * it), and texts from customers land on their timeline. Every text is an
 * "sms" row the server writes; the timeline entry has the same id, so its
 * delivery status shows next to it.
 */
export interface SmsRow {
  id: string;
  at: string;
  direction: 'INBOUND' | 'OUTBOUND';
  phone: string;
  body: string;
  media?: string[];
  customerId: string | null;
  status: string;
  error?: string | null;
  optOut?: boolean;
  optIn?: boolean;
}

export type SmsMap = Record<string, SmsRow>;
export const useSms = () => useStoredKey<SmsMap>('sms', {});

/** "Delivered", "Failed: 30007 …" etc. */
export function statusLabel(s: SmsRow): { text: string; bad: boolean } {
  if (s.direction === 'INBOUND') return { text: '', bad: false };
  if (s.status === 'delivered') return { text: 'Delivered', bad: false };
  if (s.status === 'failed' || s.status === 'undelivered') return { text: `Not delivered${s.error ? ` (${s.error})` : ''}`, bad: true };
  if (s.status === 'sent') return { text: 'Sent', bad: false };
  return { text: 'Sending…', bad: false };
}

/** Before 8 AM or after 9 PM here: texting customers then is a bad idea (and restricted in some states). */
export function quietHours(now = new Date()) {
  const h = now.getHours();
  return h < 8 || h >= 21;
}

/** Send one text now. Returns the text as saved. */
export async function sendText(c: Customer, body: string): Promise<SmsRow> {
  if (c.doNotText || c.doNotContact) throw new Error(`${c.firstName || 'This customer'} is marked do not text.`);
  const to = [c.phone, c.altPhone].map((p) => normalizeUsPhone(p)).find((n) => n.ok);
  if (!to || !to.ok) throw new Error('No textable phone number for this customer.');
  const res = await fetch('/api/sms/send', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ customerId: c.id, to: to.e164, body }),
  });
  const out = (await res.json().catch(() => ({}))) as SmsRow & { error?: string };
  if (!res.ok) throw new Error(out.error ?? `Couldn't send (${res.status}).`);
  await addToTimeline([out]);
  void kv.refresh().catch(() => undefined);
  return out;
}

const textOf = (s: SmsRow) => [s.body, ...(s.media ?? []).map((m) => `[picture] ${m}`)].filter(Boolean).join('\n');

/**
 * Put texts on their customers' timelines (once each). A text from a number
 * nobody has gets a new customer. STOP marks them do-not-text; START clears it.
 * Returns the new incoming texts.
 */
export async function addToTimeline(rows: SmsRow[]): Promise<SmsRow[]> {
  const customers = await getCustomers();
  const byDigits = new Map<string, string>();
  for (const c of Object.values(customers))
    for (const p of [c.phone, c.altPhone]) {
      const n = normalizeUsPhone(p);
      if (n.ok && !byDigits.has(n.digits)) byDigits.set(n.digits, c.id);
    }
  const smsFix: SmsMap = {};
  const fresh: SmsRow[] = [];
  let changed = false;
  for (const s of rows) {
    const n = normalizeUsPhone(s.phone);
    let id = s.customerId && customers[s.customerId] ? s.customerId : n.ok ? byDigits.get(n.digits) ?? null : null;
    if (!id) {
      if (s.direction !== 'INBOUND' || !n.ok) continue;
      // Same id on every device, so two devices don't make two customers.
      id = `sms-${n.digits}`;
      customers[id] ??= blankCustomer({ id, firstName: 'New texter', phone: n.display, source: 'Texted in' });
      byDigits.set(n.digits, id);
    }
    if (id !== s.customerId) smsFix[s.id] = { ...s, customerId: id };
    const c = customers[id];
    if (c.activities.some((a) => a.id === s.id)) continue;
    const entry: Activity = activity({ id: s.id, at: s.at, channel: 'TEXT', direction: s.direction, outcome: null, text: textOf(s) });
    const notes: Activity[] = [];
    let patch: Partial<Customer> = {};
    if (s.optOut && !c.doNotText) {
      patch = { doNotText: true };
      notes.push(activity({ at: s.at, channel: 'NOTE', direction: 'INTERNAL', outcome: 'Stage', text: 'Texted STOP: marked do not text' }));
    } else if (s.optIn && c.doNotText) {
      patch = { doNotText: false };
      notes.push(activity({ at: s.at, channel: 'NOTE', direction: 'INTERNAL', outcome: 'Stage', text: 'Texted START: texting allowed again' }));
    }
    customers[id] = {
      ...c,
      ...patch,
      activities: [entry, ...notes, ...c.activities].sort((a, b) => b.at.localeCompare(a.at)),
      ...(c.stage === 'new' && s.direction === 'OUTBOUND' ? { stage: 'contacted' as const } : {}),
      updatedAt: new Date().toISOString(),
    };
    if (s.direction === 'INBOUND') fresh.push(s);
    changed = true;
  }
  if (changed) await kv.set({ customers });
  if (Object.keys(smsFix).length) {
    const all = ((await kv.get('sms')).sms as SmsMap | undefined) ?? {};
    await kv.set({ sms: { ...all, ...smsFix } });
  }
  return fresh;
}

/** Texts you haven't looked at, per customer. */
export function unreadCount(c: Customer, sms: SmsMap): number {
  const seen = c.textsReadAt ?? '';
  return Object.values(sms).filter((s) => s.direction === 'INBOUND' && (s.customerId === c.id) && s.at > seen).length;
}

/**
 * Runs once in the app: whenever texts come in (from any device's sync),
 * put them on timelines and pop a notification for new ones.
 */
export function useTextInbox(onNew: (texts: SmsRow[]) => void) {
  const sms = useSms();
  useEffect(() => {
    const rows = Object.values(sms);
    if (!rows.length) return;
    void addToTimeline(rows).then((fresh) => {
      const recent = fresh.filter((s) => Date.now() - new Date(s.at).getTime() < 10 * 60_000);
      if (recent.length) onNew(recent);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sms]);
}
