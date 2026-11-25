import { useEffect } from 'react';
import { kv } from '../core/storage/kv';
import { normalizeUsPhone } from '../core/analysis/phone';
import { aiReady, replyFor } from './ai';
import { allUnits, money, toVehicleRef, type Unit } from './inventory';
import type { Payments } from './lister';
import { afterActivity } from './sequence';
import { activity, blankCustomer, getCustomers, getSettings, serial, stagePatch } from './store';
import type { Activity, Customer, Task } from './types';

/**
 * FACEBOOK MARKETPLACE CHATS → TORQUE. On a Messenger chat, the extension's
 * "Save to Torque" button reads the buyer's name, the unit and the chat (you
 * can fix any of it), and hands it to this page:
 *  - the buyer becomes a customer (or the one you already have: same chat,
 *    or same phone number if they gave one), source Facebook Marketplace;
 *  - the chat goes on their timeline, with a task to answer them;
 *  - Claude drafts your next reply, which the extension can put in the
 *    message box. Nothing is ever sent for you.
 * Saving the same chat again only adds what's new.
 */
export interface ChatLead {
  /** Facebook's id for the conversation (from the page address), or "" when it isn't known. */
  thread: string;
  name: string;
  phone: string;
  /** The unit they're asking about, as Facebook shows it (e.g. "2024 Polaris Ranger 1000"). */
  unit: string;
  /** "Them: …" / "Me: …" lines, oldest first. */
  chat: string;
  /** The conversation's address on Facebook. */
  url: string;
}

export interface ChatSaveResult {
  customerId: string;
  name: string;
  isNew: boolean;
  /** Something new went on the timeline (false when the chat was already saved as-is). */
  added: boolean;
  /** The inventory unit it matched, if any. */
  unit: string | null;
  reply: string | null;
  /** Claude's read on where they are (e.g. "Price question: …"). */
  gate: string | null;
  /** "Hold off" reasons or a heads-up. */
  note: string | null;
  /** Why there's no reply (e.g. Claude isn't set up). */
  replyError: string | null;
}

/** A short stable hash (for timeline ids). */
export function hashOf(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** Tidy "Them:" / "Me:" lines (blank and duplicate-in-a-row lines dropped). */
export function cleanChat(chat: string): string {
  const out: string[] = [];
  for (const raw of chat.split('\n')) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (!line || line === out[out.length - 1]) continue;
    out.push(line);
  }
  return out.join('\n').slice(-6000);
}

/** The last thing in the chat came from them (so a reply is owed). */
export const theyWroteLast = (chat: string) => {
  const lines = cleanChat(chat).split('\n');
  return !/^me:/i.test(lines[lines.length - 1] ?? '');
};

/** A phone number the buyer typed in the chat (their lines only). */
export function phoneInChat(chat: string): string {
  for (const line of chat.split('\n')) {
    if (/^me:/i.test(line.trim())) continue;
    const m = line.match(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/);
    if (m && normalizeUsPhone(m[0]).ok) return m[0];
  }
  return '';
}

const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 || /\d/.test(w));

/**
 * The inventory unit a Marketplace title is about: same year (when the title
 * has one), and most of the unit's own words in the title (or the other way round).
 */
export function matchUnit(title: string, units: Unit[]): Unit | null {
  const t = new Set(words(title));
  if (!t.size) return null;
  const year = title.match(/\b(19|20)\d{2}\b/)?.[0];
  let best: Unit | null = null;
  let top = 0;
  for (const u of units) {
    if (year && u.year && u.year !== year) continue;
    const w = words(u.title).filter((x) => x !== year);
    if (!w.length) continue;
    const hit = w.filter((x) => t.has(x)).length;
    const score = Math.max(hit / w.length, hit / Math.max(1, t.size - (year ? 1 : 0)));
    if (hit >= 2 && score > top) [best, top] = [u, score];
  }
  return top >= 0.6 ? best : null;
}

function splitName(name: string): { firstName: string; lastName: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] ?? '', lastName: parts.slice(1).join(' ') };
}

/** Which customer a chat belongs to: the one saved from this chat before, else the same phone number. */
export function customerFor(lead: ChatLead, customers: Record<string, Customer>): Customer | null {
  if (lead.thread && customers[`fb-${lead.thread}`]) return customers[`fb-${lead.thread}`];
  const marker = lead.thread ? `fbchat-${lead.thread}-` : null;
  if (marker) {
    const c = Object.values(customers).find((x) => x.activities.some((a) => a.id.startsWith(marker)));
    if (c) return c;
  }
  const digits = (p: string) => {
    const n = normalizeUsPhone(p);
    return n.ok ? n.digits : null;
  };
  const want = digits(lead.phone || phoneInChat(lead.chat));
  if (want) return Object.values(customers).find((c) => [c.phone, c.altPhone].some((p) => digits(p) === want)) ?? null;
  return null;
}

/** The chat's lines that aren't on the customer's timeline yet (all of them the first time). */
export function newLines(chat: string, c: Customer | null, thread: string): string {
  const lines = cleanChat(chat).split('\n');
  if (!c || !thread) return lines.join('\n');
  const saved = c.activities.filter((a) => a.id.startsWith(`fbchat-${thread}-`)).map((a) => a.text);
  if (!saved.length) return lines.join('\n');
  const before = new Set(saved.join('\n').split('\n'));
  // Keep everything after the last line we already have.
  let last = -1;
  lines.forEach((l, i) => before.has(l) && (last = i));
  return lines.slice(last + 1).join('\n');
}

/** Put a chat on a customer (new or existing). Pure: returns the updated customer. */
export function applyChat(lead: ChatLead, c: Customer | null, unit: Unit | null, now = new Date()): { customer: Customer; isNew: boolean; added: boolean } {
  const at = now.toISOString();
  const chat = cleanChat(lead.chat);
  const phone = lead.phone.trim() || phoneInChat(chat);
  const n = normalizeUsPhone(phone);
  const isNew = !c;
  const id = c?.id ?? (lead.thread ? `fb-${lead.thread}` : `fb-${hashOf(`${lead.name}|${lead.unit}|${at}`)}`);
  const base =
    c ??
    blankCustomer({ id, ...splitName(lead.name), phone: n.ok ? n.display : phone, source: 'Facebook Marketplace', interest: unit?.title ?? lead.unit.trim(), vehicle: unit ? toVehicleRef(unit) : null, createdAt: at });
  const fresh = newLines(chat, c, lead.thread);
  if (!fresh) return { customer: base, isNew, added: false };
  const about = unit?.title ?? lead.unit.trim();
  const entry: Activity = activity({
    id: `fbchat-${lead.thread || hashOf(lead.name)}-${hashOf(fresh)}`,
    at,
    channel: 'OTHER',
    direction: theyWroteLast(fresh) ? 'INBOUND' : 'OUTBOUND',
    outcome: 'Facebook Marketplace chat',
    text: `${about ? `About: ${about}\n` : ''}${fresh}${lead.url ? `\n${lead.url}` : ''}`,
  });
  if (base.activities.some((a) => a.id === entry.id)) return { customer: base, isNew, added: false };
  const after = afterActivity(base, entry);
  let tasks = after.tasks ?? base.tasks;
  if (theyWroteLast(fresh) && !tasks.some((t) => !t.done && t.id.startsWith('fbchat-'))) {
    const task: Task = { id: `fbchat-${hashOf(entry.id)}`, kind: 'todo', dueAt: at, title: `Answer their Marketplace message${about ? ` (${about})` : ''}`, done: false };
    tasks = [...tasks, task];
  }
  const customer: Customer = {
    ...base,
    ...after,
    phone: base.phone || (n.ok ? n.display : ''),
    source: base.source || 'Facebook Marketplace',
    interest: base.interest || about,
    vehicle: base.vehicle ?? (unit ? toVehicleRef(unit) : null),
    ...(isNew ? {} : ['sold', 'lost'].includes(base.stage) ? { stage: 'new' as const } : stagePatch(base, entry)),
    activities: [entry, ...base.activities].sort((a, b) => b.at.localeCompare(a.at)),
    tasks,
    updatedAt: at,
  };
  return { customer, isNew, added: true };
}

/** What Claude is told about the listing (so it never makes up a price). */
export function listingLine(lead: ChatLead, unit: Unit | null, payment: number | null): string {
  const title = unit?.title ?? lead.unit.trim();
  if (!title) return '';
  const bits = [title, unit?.price ? `listed at ${money(unit.price)}` : null, payment ? `payments as low as $${payment}/mo WAC` : null].filter(Boolean);
  return `(This is a Facebook Marketplace chat about my listing: ${bits.join(', ')}.)\n`;
}

async function findUnit(title: string): Promise<Unit | null> {
  if (!title.trim()) return null;
  try {
    const s = await getSettings();
    const units = await Promise.race([allUnits(s.inventoryPage), new Promise<Unit[]>((_, no) => setTimeout(() => no(new Error('slow')), 12000))]);
    return matchUnit(title, units);
  } catch {
    return null;
  }
}

/** Save a chat from Facebook, then draft the reply. */
export async function saveChat(lead: ChatLead): Promise<ChatSaveResult> {
  if (!lead.name.trim() && !lead.chat.trim()) throw new Error('Nothing to save: no name and no chat.');
  const unit = await findUnit(lead.unit);
  const { customer, isNew, added } = await serial(async () => {
    const customers = await getCustomers();
    const r = applyChat(lead, customerFor(lead, customers), unit);
    customers[r.customer.id] = r.customer;
    if (r.added || r.isNew) await kv.set({ customers });
    return r;
  });
  const result: ChatSaveResult = { customerId: customer.id, name: `${customer.firstName} ${customer.lastName}`.trim() || lead.name, isNew, added, unit: unit?.title ?? null, reply: null, gate: null, note: null, replyError: null };
  if (!theyWroteLast(lead.chat)) {
    result.replyError = 'Your message is the last one in this chat, so there’s nothing to answer yet.';
    return result;
  }
  if (!aiReady()) {
    result.replyError = 'Claude isn’t set up (Settings → dialer), so no reply was drafted. The chat is saved.';
    return result;
  }
  try {
    const payments = ((await kv.get('marketplacePayments')).marketplacePayments as Payments | undefined) ?? {};
    const thread = listingLine(lead, unit, unit ? (payments[unit.id] ?? null) : null) + cleanChat(lead.chat);
    const { suggestion } = await replyFor(customer, await getSettings(), thread);
    result.reply = suggestion.reply;
    result.gate = suggestion.gate || null;
    result.note = suggestion.note || null;
    if (suggestion.hold && !suggestion.reply) result.replyError = suggestion.note || 'Claude suggests holding off on a reply for now.';
  } catch (e) {
    result.replyError = `Saved, but the reply couldn’t be drafted: ${(e as Error).message}`;
  }
  return result;
}

/**
 * Runs once in the app: answers "save this chat" from the extension (it
 * comes in through content/crm-bridge.js), and tells the bridge it's ready.
 */
export function useChatBridge(onSaved?: (r: ChatSaveResult) => void) {
  useEffect(() => {
    const on = (e: MessageEvent) => {
      const m = e.data as { source?: string; type?: string; id?: string; lead?: ChatLead };
      if (e.source !== window || e.origin !== location.origin || m?.source !== 'torque-lister' || m.type !== 'SAVE_CHAT' || !m.id || !m.lead) return;
      const reply = (body: object) => window.postMessage({ source: 'torque-crm', type: 'SAVE_CHAT_RESULT', id: m.id, ...body }, location.origin);
      saveChat(m.lead)
        .then((r) => (reply({ ok: true, result: r }), onSaved?.(r)))
        .catch((err: Error) => reply({ ok: false, error: err.message }));
    };
    addEventListener('message', on);
    window.postMessage({ source: 'torque-crm', type: 'CHAT_READY' }, location.origin);
    return () => removeEventListener('message', on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
