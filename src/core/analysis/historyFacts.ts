import type { ActivityRow, CustomerRecord } from '../types/schema';

/**
 * Plain facts computed locally from the activity history. These feed the
 * review card (LAST CUSTOMER RESPONSE, LAST DEALERSHIP CONTACT, …) and the AI
 * input. No interpretation here — the AI does that; these just can't be wrong.
 */
export interface HistoryFacts {
  totalActivities: number;
  customerReplies: number;
  lastCustomerReply: { at: string | null; channel: string; text: string | null } | null;
  lastDealershipContact: { at: string | null; channel: string; type: string } | null;
  /** Outbound calls/texts/emails since the customer last replied (or ever, if never). */
  attemptsSinceLastReply: number;
  noAnswerCallsSinceLastReply: number;
  daysSinceLastReply: number | null;
  daysSinceLastContact: number | null;
  leadAgeDays: number | null;
  appointments: number;
  /** Any sign of a missed appointment (a no-show outcome, or an "Apt. No Show Call" follow-up). */
  appointmentMissed: boolean;
  /** Evidence of an in-store visit, quoted from the history (e.g. "Write Up", "Thanks for visiting us!"). */
  visitEvidence: string[];
  /** The customer has replied to texts even though eLead shows a "Do not text" icon. */
  textsDespiteDoNotTextIcon: boolean;
  /** eLead sometimes logs the same call twice in the same minute; those are counted once. */
  duplicateEntriesIgnored: number;
}

const DAY = 86_400_000;

function daysBetween(fromIso: string | null, today: Date): number | null {
  if (!fromIso) return null;
  const t = new Date(fromIso).getTime();
  return Number.isNaN(t) ? null : Math.max(0, Math.floor((today.getTime() - t) / DAY));
}

/** eLead lists newest first; sort defensively anyway. */
function newestFirst(rows: ActivityRow[]): ActivityRow[] {
  return [...rows].sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''));
}

/** Identical entries logged in the same minute are one real event. */
function dedupe(rows: ActivityRow[]): ActivityRow[] {
  const seen = new Set<string>();
  return rows.filter((r) => {
    const key = [r.at, r.type, r.outcome, r.comment, r.completedBy, r.direction].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function computeHistoryFacts(record: CustomerRecord, today = new Date()): HistoryFacts {
  const rows = dedupe(newestFirst(record.history));
  const inbound = rows.filter((r) => r.direction === 'INBOUND');
  const outbound = rows.filter((r) => r.direction === 'OUTBOUND');
  const lastReply = inbound[0] ?? null;
  const since = lastReply ? outbound.filter((r) => (r.at ?? '') > (lastReply.at ?? '')) : outbound;

  const visitEvidence = rows
    .filter((r) => /\bwrite ?up\b|test ?drive|\bvisit(ed|ing)?\b|in showroom|showroom visit/i.test(`${r.type} ${r.outcome ?? ''} ${r.comment ?? ''}`))
    .map((r) => `${r.rawDate}: ${r.comment || r.type}`);
  if (record.opportunity.salesSteps.some((s) => /showroom/i.test(s.name) && s.done)) visitEvidence.push('In Showroom step completed');

  const oldest = rows[rows.length - 1];
  return {
    totalActivities: rows.length,
    customerReplies: inbound.length,
    lastCustomerReply: lastReply ? { at: lastReply.at, channel: lastReply.channel, text: lastReply.comment } : null,
    lastDealershipContact: outbound[0] ? { at: outbound[0].at, channel: outbound[0].channel, type: outbound[0].type } : null,
    attemptsSinceLastReply: since.length,
    noAnswerCallsSinceLastReply: since.filter((r) => r.channel === 'PHONE' && /no answer/i.test(`${r.outcome ?? ''} ${r.comment ?? ''}`)).length,
    daysSinceLastReply: daysBetween(lastReply?.at ?? null, today),
    daysSinceLastContact: daysBetween(outbound[0]?.at ?? null, today),
    leadAgeDays: daysBetween(record.opportunity.dateIn ?? oldest?.at ?? null, today),
    appointments: rows.filter((r) => r.channel === 'APPOINTMENT' || /appointment/i.test(r.type)).length,
    appointmentMissed: rows.some((r) => /no ?show/i.test(`${r.outcome ?? ''} ${r.type}`)),
    visitEvidence,
    textsDespiteDoNotTextIcon: Boolean(record.customer.doNotText) && inbound.some((r) => r.channel === 'TEXT'),
    duplicateEntriesIgnored: record.history.length - rows.length,
  };
}
