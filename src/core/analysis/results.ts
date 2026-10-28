import type { CustomerRecord } from '../types/schema';
import { isAppointment, type CallLogEntry } from '../dialer/dispositions';
import type { SentMessage } from '../storage/sentLog';
import { anonymize } from '../storage/styleMemory';

/**
 * WHAT WORKED: for each message you sent from Torque, what happened next,
 * from what Torque already reads (eLead history, read-only) and logs (your
 * appointments and SHOWED / NO-SHOW). The best ones teach Claude.
 */
export interface SendResult {
  opportunityId: string;
  firstName: string;
  msg: SentMessage;
  /** They wrote back before your next message (within 7 days). */
  replied: boolean;
  /** The reply was a no ("stop", "not interested", "bought elsewhere"). */
  negativeReply: boolean;
  /** An appointment was logged within 14 days, and this was your last message before it. */
  appointment: boolean;
  showed: boolean;
  /** The customer is Sold now, and this was your last message to them. */
  sold: boolean;
}

export interface CustomerInfo {
  firstName: string;
  record: CustomerRecord | null;
  sold: boolean;
}

const DAY = 86_400_000;
const NEGATIVE = /\b(stop|unsubscribe|not interested|no thanks|wrong number|leave me alone|bought|went with|found (one|something)|quit (texting|calling))\b/i;
const t = (iso: string) => new Date(iso).getTime();

export function sendResults(sentMap: Record<string, SentMessage[]>, customers: Map<string, CustomerInfo>, log: CallLogEntry[]): SendResult[] {
  const out: SendResult[] = [];
  for (const [id, sends] of Object.entries(sentMap)) {
    const info = customers.get(id);
    const sorted = [...sends].sort((a, b) => a.at.localeCompare(b.at));
    const inbound = (info?.record?.history ?? []).filter((h) => h.direction === 'INBOUND' && h.at && h.comment);
    const appts = log.filter((e) => e.opportunityId === id && isAppointment(e.result));
    sorted.forEach((msg, i) => {
      const start = t(msg.at);
      const next = sorted[i + 1] ? t(sorted[i + 1].at) : Infinity;
      const replyEnd = Math.min(next, start + 7 * DAY);
      const reply = inbound.find((h) => t(h.at!) > start && t(h.at!) <= replyEnd);
      // Credit an appointment to the last message before it was logged.
      const appt = appts.find((e) => t(e.at) > start && t(e.at) <= Math.min(next, start + 14 * DAY));
      const last = i === sorted.length - 1;
      out.push({
        opportunityId: id,
        firstName: info?.firstName ?? '',
        msg,
        replied: !!reply,
        negativeReply: !!reply && NEGATIVE.test(reply.comment!),
        appointment: !!appt,
        showed: appt?.apptResult === 'showed',
        sold: last && !!info?.sold,
      });
    });
  }
  return out.sort((a, b) => b.msg.at.localeCompare(a.msg.at));
}

export interface ResultStats {
  sent: number;
  replied: number;
  appointments: number;
  showed: number;
  sold: number;
}

export function resultStats(results: SendResult[], kind?: 'text' | 'email'): ResultStats {
  const r = kind ? results.filter((x) => x.msg.kind === kind) : results;
  return {
    sent: r.length,
    replied: r.filter((x) => x.replied && !x.negativeReply).length,
    appointments: r.filter((x) => x.appointment).length,
    showed: r.filter((x) => x.showed).length,
    sold: r.filter((x) => x.sold).length,
  };
}

/** Sends from the last N days. */
export const since = (results: SendResult[], days: number, now = new Date()) => results.filter((r) => t(r.msg.at) >= now.getTime() - days * DAY);

const score = (r: SendResult) => (r.sold ? 4 : r.showed ? 3 : r.appointment ? 2 : r.replied && !r.negativeReply ? 1 : 0);
const LABEL = ['', 'Got a reply', 'Got an appointment', 'Customer showed', 'Customer bought'];
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * The messages that worked best (bought > showed > appointment > positive reply),
 * newest first within each, for the prompt. Names, phones and emails removed;
 * the customer's own reply is never included.
 */
export function winnersBlock(results: SendResult[], me: string, max = 4): string {
  const wins = results.filter((r) => score(r) > 0).sort((a, b) => score(b) - score(a) || b.msg.at.localeCompare(a.msg.at)).slice(0, max);
  if (!wins.length) return '';
  const lines = wins.map((r) => `${LABEL[score(r)]} (${r.msg.kind}): ${clip(anonymize(r.msg.body, r.firstName).replace(/\s+/g, ' '), 400)}`);
  return `MESSAGES THAT WORKED FOR ${me.toUpperCase()} (real results with other customers; names changed). Learn why they worked: what they referenced, how they asked. Never copy them.\n${lines.join('\n')}\n\n---\n\n`;
}
