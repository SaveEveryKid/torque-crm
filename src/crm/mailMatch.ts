import type { Activity, Customer } from './types';

/**
 * CHECK FOR REPLIES (your exported Outlook Inbox): which emails came from
 * customers, as a pure step. A reply is matched by the sender's exact address,
 * or (business domains only) by the company domain of someone you emailed,
 * because another person there often answers. Bounces and out-of-office
 * auto-replies are told apart. Emails from anyone else are ignored.
 */
export interface Mail {
  /** Internet message id (the same on every export: used to skip ones already logged). */
  id: string;
  subject: string;
  /** Sender's address, lower case. */
  from: string;
  fromName: string;
  /** When it arrived (ISO). */
  at: string;
  text: string;
  /** A delivery report (bounce) by message class. */
  report?: boolean;
}

/** Webmail and ISPs: a shared domain says nothing about which customer it is. */
const PUBLIC =
  /^(gmail|googlemail|yahoo|ymail|rocketmail|outlook|hotmail|live|msn|aol|icloud|me|mac|comcast|att|sbcglobal|bellsouth|charter|cox|verizon|protonmail|proton|mail|gmx|zoho|windstream|earthlink|frontier|centurylink|q|juno|netzero|spectrum|roadrunner|rr|tds|mchsi|aim)\.[a-z.]+$/;
export const domainOf = (e: string) => e.split('@')[1]?.toLowerCase() ?? '';
export const businessDomain = (e: string) => {
  const d = domainOf(e);
  return d && !PUBLIC.test(d) ? d : '';
};

export const isAutoReply = (m: Pick<Mail, 'subject'>) => /^\s*(automatic reply|auto[- ]?reply|autoreply|out of (the )?office|ooo\b|away from (the )?office|on vacation)/i.test(m.subject);
export const isBounce = (m: Pick<Mail, 'subject' | 'from' | 'report'>) =>
  !!m.report ||
  /^\s*(undeliverable|undelivered|delivery (status notification|has failed|failure)|mail delivery (failed|subsystem)|returned mail|failure notice|message not delivered)/i.test(m.subject) ||
  /^(postmaster|mailer-daemon|microsoftexchange)/i.test(m.from);
const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g;
export const addressesIn = (s: string) => [...new Set((s.toLowerCase().match(EMAIL) ?? []).map((e) => e.replace(/\.+$/, '')))];

/** Stable short id for a timeline entry from a message id. */
export function mailActivityId(messageId: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < messageId.length; i++) h = Math.imul(h ^ messageId.charCodeAt(i), 0x01000193);
  return `mail-${(h >>> 0).toString(36)}-${messageId.length.toString(36)}`;
}

const lastEmailedAt = (c: Customer) => c.activities.find((a) => a.channel === 'EMAIL' && a.direction === 'OUTBOUND')?.at ?? null;

export interface Found {
  customerId: string;
  kind: 'reply' | 'auto' | 'bounce';
  mail: Mail;
  /** Matched by company domain (someone else at the company answered). */
  viaDomain?: boolean;
}

/** What the export holds for your customers (only emails newer than the customer, never twice). */
export function findReplies(mails: Mail[], customers: Customer[]): Found[] {
  const byEmail = new Map<string, Customer[]>();
  const byDomain = new Map<string, Customer[]>();
  for (const c of customers) {
    const e = c.email.trim().toLowerCase();
    if (!e) continue;
    byEmail.set(e, [...(byEmail.get(e) ?? []), c]);
    const d = businessDomain(e);
    // Only companies you've emailed: a domain match is "someone there answered you".
    if (d && lastEmailedAt(c)) byDomain.set(d, [...(byDomain.get(d) ?? []), c]);
  }
  const newest = (l: Customer[]) => [...l].sort((a, b) => (lastEmailedAt(b) ?? b.updatedAt).localeCompare(lastEmailedAt(a) ?? a.updatedAt))[0];
  const seen = new Set(customers.flatMap((c) => c.activities.map((a) => a.id)));
  const out: Found[] = [];
  const add = (f: Found) => {
    const id = mailActivityId(f.mail.id);
    if (seen.has(id)) return;
    seen.add(id);
    out.push(f);
  };
  for (const m of [...mails].sort((a, b) => a.at.localeCompare(b.at))) {
    if (isBounce(m)) {
      for (const e of addressesIn(`${m.text} ${m.subject}`)) {
        const c = byEmail.get(e)?.[0];
        if (c && m.at >= (lastEmailedAt(c) ?? c.createdAt)) add({ customerId: c.id, kind: 'bounce', mail: m });
      }
      continue;
    }
    const exact = byEmail.get(m.from);
    const c = exact ? newest(exact) : byDomain.get(businessDomain(m.from)) ? newest(byDomain.get(businessDomain(m.from))!) : null;
    if (!c) continue;
    // Their email to you since they've been in the CRM (a domain match: since you emailed them).
    if (m.at < (exact ? c.createdAt : (lastEmailedAt(c) ?? c.createdAt))) continue;
    add({ customerId: c.id, kind: isAutoReply(m) ? 'auto' : 'reply', mail: m, ...(exact ? {} : { viaDomain: true }) });
  }
  return out;
}

/** The timeline entry for something found. */
export function foundActivity(f: Found): Activity {
  const { mail: m } = f;
  const id = mailActivityId(m.id);
  const text = m.text.replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, 4000);
  if (f.kind === 'bounce') return { id, at: m.at, channel: 'NOTE', direction: 'INTERNAL', outcome: null, text: `Email bounced: the address doesn't work. Follow-up emails stopped.\n${m.subject}` };
  if (f.kind === 'auto') return { id, at: m.at, channel: 'NOTE', direction: 'INTERNAL', outcome: null, text: `Auto-reply: ${m.subject}${text ? `\n${text.slice(0, 400)}` : ''}` };
  return {
    id,
    at: m.at,
    channel: 'EMAIL',
    direction: 'INBOUND',
    outcome: [m.subject && `Subject: ${m.subject}`, f.viaDomain && `from ${m.fromName ? `${m.fromName} <${m.from}>` : m.from}`].filter(Boolean).join(' · ') || null,
    text,
  };
}
