import { useEffect } from 'react';
import { kv } from '../core/storage/kv';
import { normalizeUsPhone } from '../core/analysis/phone';
import { afterActivity } from './sequence';
import { activity, blankCustomer, getCustomers, serial, useStoredKey } from './store';
import type { Activity, Task } from './types';

/**
 * LEADS FROM YOUR WEBSITE (RideWithByron.com). The server saves each one as
 * its own row (worker/leads.ts); here they go onto customers: someone you
 * already have (matched by phone, then email) gets the inquiry on their
 * timeline, anyone else becomes a new customer. Either way you get a
 * "call them" task. Each lead is applied once, on whichever device sees it first.
 */
export interface WebLead {
  id: string;
  at: string;
  name: string;
  phone: string;
  email: string;
  type: string;
  label: string;
  message: string;
  preferredTime: string;
  vehicle: { id: string; title: string; stock: string | null; url: string | null } | null;
  source: string;
  campaign: string;
  customerId: string | null;
}

export type WebLeadMap = Record<string, WebLead>;
export const useWebLeads = () => useStoredKey<WebLeadMap>('webLeads', {});

/** The timeline entry and task for a lead have these ids, so no device adds them twice. */
const entryId = (l: WebLead) => `weblead-${l.id}`;

/** What goes on the timeline, in the customer's own words where there are any. */
export function leadText(l: WebLead): string {
  const lines = [`${l.label}${l.vehicle ? `: ${l.vehicle.title}${l.vehicle.stock ? ` (Stock #${l.vehicle.stock})` : ''}` : ''}`];
  if (l.preferredTime) lines.push(`Wants to come in: ${l.preferredTime}`);
  if (l.message) lines.push(`“${l.message}”`);
  lines.push(`Found you through: ${l.source}${l.campaign ? ` (${l.campaign})` : ''}`);
  return lines.join('\n');
}

function splitName(name: string): { firstName: string; lastName: string } {
  const parts = name.trim().split(/\s+/);
  return { firstName: parts[0] ?? '', lastName: parts.slice(1).join(' ') };
}

/** Put website leads on customers (once each). Returns the ones that were new. */
export function addLeadsToCustomers(rows: WebLead[]): Promise<WebLead[]> {
  return serial(() => mergeLeads(rows));
}

async function mergeLeads(rows: WebLead[]): Promise<WebLead[]> {
  const customers = await getCustomers();
  const byDigits = new Map<string, string>();
  const byEmail = new Map<string, string>();
  for (const c of Object.values(customers)) {
    for (const p of [c.phone, c.altPhone]) {
      const n = normalizeUsPhone(p);
      if (n.ok && !byDigits.has(n.digits)) byDigits.set(n.digits, c.id);
    }
    const e = c.email.trim().toLowerCase();
    if (e && !byEmail.has(e)) byEmail.set(e, c.id);
  }
  const fresh: WebLead[] = [];
  for (const l of [...rows].sort((a, b) => a.at.localeCompare(b.at))) {
    const n = normalizeUsPhone(l.phone);
    let id = (l.customerId && customers[l.customerId] ? l.customerId : null) ?? (n.ok ? byDigits.get(n.digits) : undefined) ?? (l.email ? byEmail.get(l.email) : undefined) ?? null;
    const isNew = !id;
    if (!id) {
      // Same id on every device, so two devices don't make two customers. A number Torque can't
      // read still becomes a customer (as typed): a lead is never dropped.
      id = n.ok ? `web-${n.digits}` : `web-${l.id}`;
      customers[id] ??= blankCustomer({ id, ...splitName(l.name), phone: n.ok ? n.display : l.phone, email: l.email, source: `RideWithByron.com: ${l.source}`, createdAt: l.at });
      if (n.ok) byDigits.set(n.digits, id);
      if (l.email) byEmail.set(l.email, id);
    }
    const c = customers[id];
    if (c.activities.some((a) => a.id === entryId(l))) continue;
    const entry: Activity = activity({ id: entryId(l), at: l.at, channel: 'OTHER', direction: 'INBOUND', outcome: 'Website lead', text: leadText(l) });
    const visit = l.type === 'visit';
    const task: Task = {
      id: entryId(l),
      kind: 'call',
      // Call them back within 15 minutes of the inquiry (shows as overdue if you see it later).
      dueAt: new Date(new Date(l.at).getTime() + 15 * 60_000).toISOString(),
      title: visit ? `Website lead: confirm their visit${l.preferredTime ? ` (${l.preferredTime})` : ''}` : `Website lead: ${l.label}${l.vehicle ? `, ${l.vehicle.title}` : ''}`,
      done: false,
    };
    // They reached out: that stops any automatic follow-up emails, like a reply does.
    const after = afterActivity(c, entry);
    const tasks = after.tasks ?? c.tasks;
    customers[id] = {
      ...c,
      ...after,
      // Fill in what's missing; never overwrite what you've already entered.
      email: c.email || l.email,
      source: c.source || `RideWithByron.com: ${l.source}`,
      interest: c.interest || (l.vehicle ? l.vehicle.title : ''),
      vehicle: c.vehicle ?? (l.vehicle ? { id: l.vehicle.id, title: l.vehicle.title, stock: l.vehicle.stock, vin: null, price: null, image: null, url: l.vehicle.url } : null),
      // A sold or lost customer asking again is a live deal again.
      ...(isNew || !['sold', 'lost'].includes(c.stage) ? {} : { stage: 'new' as const }),
      activities: [entry, ...c.activities].sort((a, b) => b.at.localeCompare(a.at)),
      tasks: tasks.some((t) => t.id === task.id) ? tasks : [...tasks, task],
      updatedAt: new Date().toISOString(),
    };
    fresh.push(l);
  }
  if (fresh.length) await kv.set({ customers });
  return fresh;
}

/** The customer a lead ended up on (for the "New lead" pop-up). */
export async function customerForLead(l: WebLead): Promise<string | null> {
  const c = Object.values(await getCustomers()).find((x) => x.activities.some((a) => a.id === entryId(l)));
  return c?.id ?? null;
}

/**
 * Runs once in the app: whenever website leads arrive (from any device's
 * sync), put them on customers and tell you about the recent ones.
 */
export function useWebLeadInbox(onNew: (leads: WebLead[]) => void) {
  const leads = useWebLeads();
  useEffect(() => {
    const rows = Object.values(leads);
    if (!rows.length) return;
    void addLeadsToCustomers(rows).then((fresh) => {
      const recent = fresh.filter((l) => Date.now() - new Date(l.at).getTime() < 60 * 60_000);
      if (recent.length) onNew(recent);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leads]);
}
