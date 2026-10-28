import type { ActivityRow, CustomerRecord } from '../types/schema';
import { computeHistoryFacts } from '../analysis/historyFacts';
import type { ListType } from '../analysis/customList';
import type { SentMessage } from '../storage/sentLog';
import type { ContextSection } from './contextBudget';

/**
 * CUSTOMER CONTEXT for AI drafts: turns a customer's raw eLead history (which
 * can be hundreds of rows, mostly automated) into compact, prioritized sections:
 *
 *   CURRENT CUSTOMER STATE   facts Torque already parsed (only useful values)
 *   MESSAGE MODE             what kind of follow-up this is (deterministic)
 *   CONVERSATION             latest customer message + recent meaningful turns,
 *                            verbatim; older relevant facts compacted to one line each
 *   PREVIOUS OUTREACH        what kinds of asks we already made and got no answer to
 *   WHAT WE ALREADY SENT     your Torque sends, full wording
 *   OTHER HISTORY            lowest priority (counts of noise, a few low lines)
 *
 * Everything here is deterministic: no extra AI call. Nothing is invented: every
 * line is a quote or a count from the record.
 */

// ------------------------------------------------------------------ helpers

/** Carrier compliance footer our own texting platform appends; not the customer opting out. */
const COMPLIANCE_FOOTER = /\s*(Reply\s+)?STOP to (unsubscribe|opt[ -]?out|end)[^]*$/i;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const flat = (s: string) => s.replace(/\s+/g, ' ').trim();
const norm = (s: string) => flat(s).toLowerCase().replace(/[^a-z0-9 ]/g, '');
const day = (iso: string | null) => iso?.slice(0, 10) ?? '?';
const DAY = 86_400_000;
const daysBetween = (from: string | null | undefined, to: Date) => (from ? Math.max(0, Math.floor((to.getTime() - new Date(from).getTime()) / DAY)) : null);
const textOf = (r: ActivityRow) => flat((r.comment ?? '').replace(COMPLIANCE_FOOTER, ''));

// ------------------------------------------------------------------ classification

export type Importance = 'high' | 'medium' | 'low' | 'noise';
export type Who = 'CUSTOMER' | 'US' | 'NOTE';

export type FactTag =
  | 'bought'
  | 'not_interested'
  | 'contact_complaint'
  | 'timing'
  | 'schedule'
  | 'family'
  | 'price'
  | 'trade'
  | 'vehicle'
  | 'scheduling'
  | 'question'
  | 'promise';

const TAGS: Array<{ tag: FactTag; label: string; critical: boolean; re: RegExp; who?: Who[] }> = [
  { tag: 'bought', label: 'Said they bought / found one', critical: true, re: /\b(bought|purchased|went with|found (one|something|another)|already got (one|a)|picked up a)\b/i },
  { tag: 'not_interested', label: 'Not interested', critical: true, re: /\b(not interested|no longer interested|changed my mind|pass on|don'?t need (one|it|a)|remove me|take me off)\b/i },
  {
    tag: 'contact_complaint',
    label: 'Complained about contact',
    critical: true,
    re: /\b(bother(ing)?|stop (calling|texting)|quit (calling|texting)|leave me alone|annoy(ed|ing)?|harass|keep (calling|texting)|too many (calls|texts|messages))\b/i,
  },
  {
    tag: 'timing',
    label: 'Timing',
    critical: true,
    re: /\b(get paid|payday|pay ?check|tax (return|refund)|next (week|month)|in a (few|couple) (days|weeks|months)|after (the )?(holidays|first|1st|\d)|not ready|when i'?m ready|get back (to|with) you|let you know|think (about|it over)|end of (the )?(month|year)|lease (is )?(up|ends?))\b/i,
  },
  {
    tag: 'schedule',
    label: 'Schedule',
    critical: true,
    re: /\b(i work|working|shift|off (on|work)|nights|days off|weekends?|weekdays?|after work|lunch break|out of town|travel(ing)?)\b/i,
  },
  { tag: 'family', label: 'Family / decision', critical: true, re: /\b(wife|husband|spouse|fianc[eé]e?|girlfriend|boyfriend|my (mom|dad|mother|father|parents|son|daughter)|co-?sign(er)?)\b/i },
  {
    tag: 'price',
    label: 'Price / finance',
    critical: true,
    re: /\$\s?\d|\b(price|pricing|payments?|per month|\/mo|out the door|otd|down payment|apr|interest rate|financ\w*|afford|budget|credit|approved|numbers|quote)\b/i,
  },
  { tag: 'trade', label: 'Trade', critical: true, re: /\b(trade|trade-in|payoff|pay ?off|owe|upside down|apprais\w*|my (truck|car|suv|van)|miles on (it|mine|my))\b/i },
  {
    tag: 'vehicle',
    label: 'Vehicle preference',
    critical: false,
    re: /\b(color|white|black|silver|gr[ae]y|red|blue|trim|4x4|4wd|awd|2wd|hybrid|leather|sunroof|third row|3rd row|seats|towing|mileage|xle|xse|limited|sr5|trd|platinum|used|new one)\b/i,
  },
  {
    tag: 'scheduling',
    label: 'Scheduling',
    critical: false,
    re: /\b(appointment|come (in|by)|stop by|be there|see you|on my way|tomorrow|tonight|today|this weekend|saturday|sunday|monday|tuesday|wednesday|thursday|friday|\d{1,2}(:\d\d)? ?(am|pm))\b/i,
  },
  { tag: 'promise', label: 'We promised', critical: false, re: /\b(i'?ll (send|get|call|text|email|have|check|find|look)|i will (send|get|call|check)|let me (get|check|find|send)|sending you)\b/i, who: ['US', 'NOTE'] },
];
const CRITICAL = new Set(TAGS.filter((t) => t.critical).map((t) => t.tag));

export function factTags(text: string, who: Who): FactTag[] {
  const tags = TAGS.filter((t) => (!t.who || t.who.includes(who)) && t.re.test(text)).map((t) => t.tag);
  if (who === 'CUSTOMER' && text.includes('?')) tags.push('question');
  return tags;
}

export type OutreachAngle = 'appointment ask' | 'price / numbers' | 'video / photos' | 'trade question' | 'availability' | 'financing' | 'status question' | 'general check-in';

const ANGLES: Array<[OutreachAngle, RegExp]> = [
  [
    'appointment ask',
    /\b(come (in|by|see|out|drive|take a look)|stop by|swing by|appointment|what time|work(s)? better|test drive|drive it|this (afternoon|evening|weekend)|tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  ],
  ['price / numbers', /\$\s?\d|\b(price|pricing|payments?|numbers|quote|out the door|otd)\b/i],
  ['video / photos', /\b(video|walk-?around|pictures|photos|pics)\b/i],
  ['trade question', /\b(trade|apprais\w*|what (yours|it) is worth|what yours'?s worth)\b/i],
  ['availability', /\b(still (available|here|on the lot)|in stock|just came in|available)\b/i],
  ['financing', /\b(financ\w*|credit|pre-?approv\w*|approval|apr|rate)\b/i],
  ['status question', /\b(still (looking|shopping)|find (something|one)|already (bought|found)|where you landed|close the loop|still interested|all set)\b/i],
];

/** What kind of ask an outbound message makes (different words, same strategy = same angle). */
export function outreachAngles(text: string): OutreachAngle[] {
  const hits = ANGLES.filter(([, re]) => re.test(text)).map(([a]) => a);
  return hits.length ? hits : ['general check-in'];
}

const AUTOMATED_TYPE = /reminder|newsletter|brochure|campaign|marketing|blast|survey|birthday|anniversary|\bauto|mass|bulk|service (reminder|special)|drip|workflow|equity mining/i;
const CRM_EVENT = /\b(assign\w*|reassign\w*|status (changed?|update)|sales ?step|workflow|task (created|completed)|lead (created|received|assigned)|duplicate|merged?|routing|bad lead|round robin|up ?type|opportunity (created|updated|closed)|changed (to|from))\b/i;
const UNANSWERED_CALL = /^\(?(no answer|left (a )?(voice ?mail|message)|lvm|vm|busy|nam|no response|not available|disconnected)\)?\.?$/i;

export interface HistoryItem {
  row: ActivityRow;
  who: Who;
  text: string;
  importance: Importance;
  /** Why this row is noise (counted in the debug panel). */
  noise?: 'duplicate' | 'automated' | 'repeated template' | 'unanswered call' | 'CRM event' | 'empty';
  tags: FactTag[];
  angles: OutreachAngle[];
}

/** Same day + same person + same words = one event (eLead often logs things twice). Oldest first. */
export function dedupeHistory(rows: ActivityRow[]): { rows: ActivityRow[]; removed: number } {
  const seen = new Set<string>();
  // eLead lists newest first; reverse before the stable sort so same-minute rows keep their real order.
  const ordered = [...rows].reverse().sort((a, b) => (a.at ?? '').localeCompare(b.at ?? ''));
  const out = ordered.filter((r) => {
    const t = norm(textOf(r));
    const key = t ? [day(r.at), r.direction, r.channel, t].join('|') : [r.at, r.type, r.outcome, r.completedBy, r.direction].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { rows: out, removed: rows.length - out.length };
}

function whoOf(r: ActivityRow): Who {
  return r.direction === 'INBOUND' ? 'CUSTOMER' : r.direction === 'OUTBOUND' ? 'US' : 'NOTE';
}

/** Score every (deduped) row: customer words are high, our hand-written messages medium, automation and CRM events noise. */
export function extractMeaningfulHistory(rows: ActivityRow[]): HistoryItem[] {
  // The same outbound wording sent more than once is a template: keep only the newest copy.
  const outboundCount = new Map<string, number>();
  for (const r of rows) if (r.direction === 'OUTBOUND' && textOf(r)) outboundCount.set(norm(textOf(r)), (outboundCount.get(norm(textOf(r))) ?? 0) + 1);
  const seenTemplate = new Set<string>();
  const items: HistoryItem[] = [];

  for (const r of [...rows].reverse()) {
    // newest first, so the newest copy of a template is the one kept
    const who = whoOf(r);
    const text = textOf(r);
    const meta = `${r.type} ${r.outcome ?? ''}`;
    const base = { row: r, who, text, tags: text ? factTags(text, who) : [], angles: [] as OutreachAngle[] };
    let importance: Importance = 'noise';
    let noise: HistoryItem['noise'];

    if (r.direction === 'INBOUND') {
      importance = text ? 'high' : r.channel === 'PHONE' ? 'medium' : 'low';
    } else if (r.direction === 'OUTBOUND' && r.channel === 'PHONE') {
      if (!text || UNANSWERED_CALL.test(text)) noise = 'unanswered call';
      else importance = 'medium';
    } else if (r.direction === 'OUTBOUND' || (r.channel === 'TEXT' || r.channel === 'EMAIL')) {
      const key = norm(text);
      if (!text) noise = 'empty';
      else if (r.completedBy === 'System' || AUTOMATED_TYPE.test(meta)) noise = 'automated';
      else if ((outboundCount.get(key) ?? 0) > 1 && seenTemplate.has(key)) noise = 'repeated template';
      else {
        importance = (outboundCount.get(key) ?? 0) > 1 ? 'low' : 'medium';
        seenTemplate.add(key);
      }
    } else if (r.channel === 'APPOINTMENT') {
      importance = 'medium';
    } else if (CRM_EVENT.test(`${meta} ${text}`)) {
      noise = 'CRM event';
    } else if (r.channel === 'NOTE' && text.length >= 12) {
      importance = 'medium';
    } else if (text && base.tags.some((t) => CRITICAL.has(t))) {
      importance = 'low';
    } else {
      noise = text ? 'CRM event' : 'empty';
    }

    if (who === 'US' && importance !== 'noise' && text) base.angles = outreachAngles(text);
    items.push({ ...base, importance, ...(noise ? { noise } : {}) });
  }
  return items.reverse(); // oldest first again
}

// ------------------------------------------------------------------ message mode

export type MessageMode = 'CUSTOMER_REPLY' | 'ACTIVE_FOLLOWUP' | 'STALE_FOLLOWUP' | 'REACTIVATION' | 'FINAL_CHECKIN';

export const MODE_GUIDANCE: Record<MessageMode, string> = {
  CUSTOMER_REPLY: 'They wrote last. Answer what they actually said first, then make the next small move.',
  ACTIVE_FOLLOWUP: 'Recent activity, no new reply yet. Build on the latest conversation with one easy next step.',
  STALE_FOLLOWUP:
    'Several unanswered attempts or a long silence. Do not repeat an ignored ask in new words. Short, low-pressure and permission-based, with a fresh, genuinely useful reason to reply.',
  REACTIVATION: 'An older opportunity approached fresh. Say who you are, acknowledge the time that passed without guilt, and give one honest reason to talk now.',
  FINAL_CHECKIN: 'The last active follow-up. Close the loop gracefully and leave the door open.',
};

const REACTIVATION_LISTS: ListType[] = ['expired_lead', 'prior_sold', 'orphan', 'lease_end', 'equity', 'service', 'cold'];

export interface ModeInput {
  lastCustomerAt: string | null;
  /** Our last meaningful message (not automation). */
  lastUsAt: string | null;
  /** Attempts (meaningful messages + unanswered calls) since their last reply, or ever. */
  attemptsSinceReply: number;
  leadAgeDays: number | null;
  listType?: ListType | null;
  finalCheckin?: boolean;
}

export function classifyMessageMode(m: ModeInput, today = new Date()): MessageMode {
  if (m.finalCheckin) return 'FINAL_CHECKIN';
  const sinceReply = daysBetween(m.lastCustomerAt, today);
  const sinceAny = daysBetween([m.lastCustomerAt, m.lastUsAt].filter(Boolean).sort().pop() ?? null, today);
  const theyWroteLast = !!m.lastCustomerAt && (!m.lastUsAt || m.lastCustomerAt > m.lastUsAt);
  if (theyWroteLast && sinceReply !== null && sinceReply <= 30) return 'CUSTOMER_REPLY';
  const repliedRecently = sinceReply !== null && sinceReply <= 14;
  if (m.listType && REACTIVATION_LISTS.includes(m.listType) && !repliedRecently) return 'REACTIVATION';
  if ((sinceAny !== null && sinceAny >= 60) || (sinceAny === null && (m.leadAgeDays ?? 0) >= 60) || (theyWroteLast && sinceReply !== null && sinceReply > 30)) return 'REACTIVATION';
  if (m.attemptsSinceReply >= 3 || (m.lastCustomerAt ? (sinceReply ?? 0) >= 14 : (m.leadAgeDays ?? 0) >= 10)) return 'STALE_FOLLOWUP';
  return 'ACTIVE_FOLLOWUP';
}

// ------------------------------------------------------------------ sections

export interface Writerish {
  name: string;
  dealership: string;
}

function currentState(record: CustomerRecord, w: Writerish, today: Date, canText: boolean, items: HistoryItem[], attempts: number, unanswered: number): string {
  const f = computeHistoryFacts(record, today);
  const o = record.opportunity;
  const me = w.name.trim().split(/\s+/)[0] || 'the salesperson';
  const lastCustomer = [...items].reverse().find((i) => i.who === 'CUSTOMER' && i.importance !== 'noise');
  const lastUs = [...items].reverse().find((i) => i.who === 'US' && i.importance !== 'noise');
  const ago = (iso: string | null | undefined) => (iso ? `${day(iso)} (${daysBetween(iso, today)} days ago)` : null);
  const lines: Array<[string, string | null | undefined]> = [
    ['Customer first name', record.customer.firstName],
    ['Today', `${day(today.toISOString())} (${today.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })})`],
    ['Vehicle', o.vehicle],
    ['Trade', o.trade],
    ['Source', o.leadSource],
    ['Lead age', f.leadAgeDays !== null ? `${f.leadAgeDays} days${o.dateIn ? ` (in ${day(o.dateIn)})` : ''}` : null],
    ['CRM status', o.salesStatus],
    ['Salesperson', `${me} at ${w.dealership || 'the dealership'}`],
    ['Last customer reply', lastCustomer ? ago(lastCustomer.row.at) : 'never replied'],
    ['Last message from us', lastUs ? `${ago(lastUs.row.at)} (${lastUs.row.channel.toLowerCase()})` : null],
    ['Attempts since their last reply', attempts ? `${attempts}${unanswered ? ` (${unanswered} unanswered calls)` : ''}` : null],
    ['Visit', f.visitEvidence.length ? `yes (${clip(f.visitEvidence[0], 60)})` : 'no visit on record'],
    ['Appointment', f.appointments > 0 ? (f.appointmentMissed ? 'set, then missed' : 'set') : 'none'],
    ['Can text', canText ? 'yes' : 'no'],
    ['Can email', record.customer.emails.length > 0 ? 'yes' : 'no'],
  ];
  return ['CURRENT CUSTOMER STATE', ...lines.filter(([, v]) => v && String(v).trim()).map(([k, v]) => `${k}: ${v}`)].join('\n');
}

const LIMIT = { CUSTOMER: 500, US: 350, NOTE: 250 } as const;
const kindOf = (r: ActivityRow) => (r.channel === 'TEXT' ? 'text' : r.channel === 'EMAIL' ? 'email' : r.channel === 'PHONE' ? 'call' : r.channel === 'APPOINTMENT' ? 'appointment' : 'note');

function line(i: HistoryItem, latestCustomer: HistoryItem | undefined): string {
  const label = i.row.channel === 'EMAIL' && i.who === 'US' ? 'email, subject only' : kindOf(i.row);
  const body = i.text || i.row.outcome || i.row.type;
  return `${day(i.row.at)} ${i.who} (${label}): ${clip(body, LIMIT[i.who])}${i === latestCustomer ? '   <- latest customer message' : ''}`;
}

/** Conversation turns, newest last: the last `exchanges` customer messages and what surrounds them. */
function recentWindow(items: HistoryItem[], exchanges: number, maxItems: number): HistoryItem[] {
  const conv = items.filter((i) => i.importance !== 'noise' && i.importance !== 'low' && (i.who !== 'NOTE' || i.text));
  const picked: HistoryItem[] = [];
  let customers = 0;
  for (let k = conv.length - 1; k >= 0 && picked.length < maxItems; k--) {
    if (conv[k].who === 'CUSTOMER') {
      if (customers >= exchanges) break;
      customers++;
    }
    picked.unshift(conv[k]);
  }
  // Never lose their latest message, even after a long run of our own messages.
  const latestCustomer = [...conv].reverse().find((i) => i.who === 'CUSTOMER');
  if (latestCustomer && !picked.includes(latestCustomer)) picked.unshift(latestCustomer);
  return picked;
}

const FACT_LABEL = Object.fromEntries([...TAGS.map((t) => [t.tag, t.label]), ['question', 'Asked']]) as Record<FactTag, string>;
const FACT_ORDER: FactTag[] = ['bought', 'not_interested', 'contact_complaint', 'timing', 'schedule', 'family', 'price', 'trade', 'vehicle', 'scheduling', 'question', 'promise'];

/**
 * Older relevant history as one-line facts (quotes, never invented). Three
 * levels: full / medium / critical-only (bought, not interested, contact
 * complaints, timing, schedule, family, price, trade — never dropped).
 */
export function summarizeOlderContext(older: HistoryItem[], level: 'full' | 'medium' | 'critical'): string[] {
  const facts: Array<{ order: number; at: string; text: string; tag: FactTag | null }> = [];
  for (const i of older) {
    if (i.importance === 'noise' || !i.text) continue;
    const top = FACT_ORDER.find((t) => i.tags.includes(t)) ?? null;
    const critical = i.tags.some((t) => CRITICAL.has(t));
    if (level === 'critical' && !critical) continue;
    if (level === 'medium' && !critical && !(i.who === 'CUSTOMER' && top)) continue;
    if (level === 'full' && !top && i.who !== 'CUSTOMER') continue; // our untagged messages are covered by PREVIOUS OUTREACH
    const who = i.who === 'CUSTOMER' ? '' : i.who === 'US' ? 'We said: ' : 'Note: ';
    const label = top ? `${FACT_LABEL[top]}: ` : 'Customer said: ';
    const n = level === 'full' ? 160 : level === 'medium' ? 130 : 110;
    facts.push({ order: top ? FACT_ORDER.indexOf(top) : 99, at: day(i.row.at), text: `- ${i.row.at ? i.row.at.slice(5, 10).replace('-', '/') + '/' + i.row.at.slice(2, 4) : '?'} ${label}${who}“${clip(i.text, n)}”`, tag: top });
  }
  // Dedupe by wording, keep the newest per tag up to a cap, then show oldest first.
  const seen = new Set<string>();
  const perTag = new Map<string, number>();
  const cap = level === 'full' ? 4 : level === 'medium' ? 3 : 2;
  const max = level === 'full' ? 30 : level === 'medium' ? 16 : 12;
  const keep = [...facts]
    .reverse()
    .filter((f) => {
      const k = norm(f.text.replace(/^- \S+ /, ''));
      if (seen.has(k)) return false;
      seen.add(k);
      const t = f.tag ?? 'other';
      perTag.set(t, (perTag.get(t) ?? 0) + 1);
      return perTag.get(t)! <= cap;
    })
    .slice(0, max);
  return keep.reverse().map((f) => f.text);
}

function outreachSummary(items: HistoryItem[], sent: SentMessage[], lastCustomerAt: string | null): string {
  const since = (at: string | null) => !lastCustomerAt || (at ?? '') > lastCustomerAt;
  const counts = new Map<OutreachAngle, { n: number; last: string }>();
  const add = (angles: OutreachAngle[], at: string | null) => {
    for (const a of angles) {
      const c = counts.get(a) ?? { n: 0, last: '' };
      counts.set(a, { n: c.n + 1, last: (at ?? '') > c.last ? (at ?? '') : c.last });
    }
  };
  for (const i of items) if (i.who === 'US' && i.angles.length && since(i.row.at)) add(i.angles, i.row.at);
  // Torque sends may not be in eLead yet (or show only an email subject there).
  for (const m of sent) if (since(m.at) && !items.some((i) => i.who === 'US' && norm(i.text) && norm(m.body).startsWith(norm(i.text).slice(0, 40)))) add(outreachAngles(m.body), m.at);
  if (!counts.size) return '';
  const head = lastCustomerAt ? 'PREVIOUS OUTREACH SINCE THEIR LAST REPLY (none of these got an answer)' : 'PREVIOUS OUTREACH (they have never replied to any of these)';
  const list = [...counts.entries()].sort((a, b) => b[1].n - a[1].n).map(([a, c]) => `${a} x${c.n} (last ${day(c.last)})`);
  const repeated = [...counts.entries()].filter(([, c]) => c.n >= 2).map(([a]) => a);
  return [
    head,
    `- ${list.join('; ')}`,
    `- Do not make the same kind of ask again in different words${repeated.length ? ` (especially: ${repeated.join(', ')})` : ''}. Choose a different, useful angle.`,
  ].join('\n');
}

function sentVersions(sent: SentMessage[]): string[] {
  const render = (list: SentMessage[]) =>
    list.length
      ? [
          'WHAT WE ALREADY SENT FROM TORQUE (full wording; do NOT repeat or reword these):',
          ...list.map((m) => `${day(m.at)} ${m.kind}${m.subject ? ` (subject: ${m.subject})` : ''}: ${clip(flat(m.body), 500)}`),
        ].join('\n')
      : '';
  return [...new Set([render(sent.slice(-3)), render(sent.slice(-1)), ''])];
}

// ------------------------------------------------------------------ assembly

export interface ContextStats {
  originalEvents: number;
  duplicatesRemoved: number;
  noiseRemoved: number;
  meaningfulEvents: number;
  recentTurns: number;
  olderFacts: number;
  noiseByKind: Record<string, number>;
  mode: MessageMode;
  limited: boolean;
}

export interface CustomerContext {
  sections: ContextSection[];
  stats: ContextStats;
  /** Everything real in the record (all comments, the list note, your sends), for the "never invent a price" check. Not sent. */
  evidence: string;
}

export interface BuildOptions {
  writer: Writerish;
  today?: Date;
  canText?: boolean;
  sent?: SentMessage[];
  /** Custom list type + note (listContext), already rendered. */
  listInfo?: string;
  listType?: ListType | null;
  finalCheckin?: boolean;
}

export function buildCustomerContext(record: CustomerRecord, opts: BuildOptions): CustomerContext {
  const today = opts.today ?? new Date();
  const sent = opts.sent ?? [];
  const { rows, removed } = dedupeHistory(record.history);
  const items = extractMeaningfulHistory(rows);
  const meaningful = items.filter((i) => i.importance !== 'noise');
  const latestCustomer = [...meaningful].reverse().find((i) => i.who === 'CUSTOMER');
  const lastCustomerAt = latestCustomer?.row.at ?? null;
  const lastUs = [...meaningful].reverse().find((i) => i.who === 'US');
  const lastSent = sent.length ? sent[sent.length - 1].at : null;
  const lastUsAt = [lastUs?.row.at ?? null, lastSent].filter(Boolean).sort().pop() ?? null;
  const sinceReply = items.filter((i) => i.who === 'US' && (i.importance !== 'noise' || i.noise === 'unanswered call') && (!lastCustomerAt || (i.row.at ?? '') > lastCustomerAt));
  const unanswered = sinceReply.filter((i) => i.noise === 'unanswered call').length;
  const attempts = sinceReply.length + sent.filter((m) => !lastCustomerAt || m.at > lastCustomerAt).length;
  const leadAge = computeHistoryFacts(record, today).leadAgeDays;

  const mode = classifyMessageMode({ lastCustomerAt, lastUsAt, attemptsSinceReply: attempts, leadAgeDays: leadAge, listType: opts.listType, finalCheckin: opts.finalCheckin }, today);
  const limited = !latestCustomer && !meaningful.some((i) => (i.who === 'US' && i.importance === 'medium') || i.who === 'NOTE') && sent.length === 0;

  const state = [
    currentState(record, opts.writer, today, opts.canText ?? true, items, attempts, unanswered),
    `\nMESSAGE MODE: ${mode}. ${MODE_GUIDANCE[mode]}`,
    limited
      ? '\nAVAILABLE CONTEXT IS LIMITED: there is no real conversation on record. Write a simple, natural message. Do not pretend to know them or mention anything not listed here.'
      : '',
  ].join('');

  // Conversation: recent turns verbatim + older facts compacted, as ONE section so the
  // older facts never repeat a line that is already shown verbatim. Versions run from
  // fullest to the required minimum (last 2 exchanges + critical older facts).
  const plan: Array<[number, number, 'full' | 'medium' | 'critical']> = [
    [5, 16, 'full'],
    [5, 16, 'medium'],
    [5, 16, 'critical'],
    [4, 12, 'critical'],
    [3, 9, 'critical'],
    [2, 6, 'critical'],
  ];
  let recentTurns = 0;
  let olderFacts = 0;
  const conversation = plan.map(([ex, max, level], idx) => {
    const recent = recentWindow(items, ex, max);
    const older = meaningful.filter((i) => !recent.includes(i));
    const facts = summarizeOlderContext(older, level);
    if (idx === 0) {
      recentTurns = recent.length;
      olderFacts = facts.length;
    }
    const parts = [
      recent.length ? ['RECENT CONVERSATION (oldest first, verbatim)', ...recent.map((i) => line(i, latestCustomer))].join('\n') : 'RECENT CONVERSATION: none on record.',
      facts.length ? ['EARLIER RELEVANT CONTEXT (older history, one fact per line, quoted)', ...facts].join('\n') : '',
    ];
    return parts.filter(Boolean).join('\n\n');
  });

  const noiseByKind: Record<string, number> = {};
  for (const i of items) if (i.noise) noiseByKind[i.noise] = (noiseByKind[i.noise] ?? 0) + 1;
  const noiseCount = items.length - meaningful.length;
  const lowLines = items
    .filter((i) => i.importance === 'low' && i.text)
    .slice(-6)
    .map((i) => line(i, undefined));
  const NOISE_NAME: Record<string, string> = {
    duplicate: 'duplicates',
    automated: 'automated emails/texts',
    'repeated template': 'repeated template messages',
    'unanswered call': 'unanswered calls',
    'CRM event': 'CRM/system events',
    empty: 'empty entries',
  };
  const noiseLine = noiseCount
    ? `Left out as noise: ${Object.entries(noiseByKind)
        .map(([k, v]) => `${v} ${NOISE_NAME[k] ?? k}`)
        .join(', ')}.`
    : '';
  const otherFull = lowLines.length || noiseLine ? ['OTHER HISTORY (low priority)', ...lowLines, noiseLine].filter(Boolean).join('\n') : '';
  const other = [otherFull, noiseLine ? `OTHER HISTORY: ${noiseLine}` : '', ''];

  const summary = record.crmAiSummary ? [`NOTES: ${clip(flat(record.crmAiSummary), 400)}`, ''] : [];

  const sections: ContextSection[] = [
    ...(opts.listInfo ? [{ key: 'list', label: 'List type', required: true, versions: [opts.listInfo.trim()] }] : []),
    { key: 'state', label: 'Current state + mode', required: true, versions: [state] },
    { key: 'conversation', label: 'Recent conversation + older facts', required: true, versions: [...new Set(conversation)] },
    { key: 'outreach', label: 'Previous outreach', required: true, versions: [outreachSummary(items, sent, lastCustomerAt)].filter(Boolean) },
    { key: 'sent', label: 'Torque sends (full wording)', versions: sent.length ? sentVersions(sent) : [] },
    { key: 'other', label: 'Other history', versions: [...new Set(other)] },
    ...(summary.length ? [{ key: 'summary', label: 'Notes', versions: summary }] : []),
  ].filter((s) => s.versions.length > 0 && !(s.versions.length === 1 && !s.versions[0]));

  const evidence = [opts.listInfo ?? '', ...record.history.map((h) => `${h.comment ?? ''} ${h.outcome ?? ''}`), ...sent.map((m) => `${m.subject ?? ''} ${m.body}`)].join('\n');

  return {
    sections,
    evidence,
    stats: {
      originalEvents: record.history.length,
      duplicatesRemoved: removed,
      noiseRemoved: noiseCount,
      meaningfulEvents: meaningful.length,
      recentTurns,
      olderFacts,
      noiseByKind,
      mode,
      limited,
    },
  };
}

/** Order in which sections are shrunk when the request is too big (first = first to go). */
export const SHRINK_ORDER = ['other', 'examples', 'winners', 'summary', 'sent', 'conversation'];
