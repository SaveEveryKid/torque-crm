import type { CustomerRecord, Suppression } from '../types/schema';

/**
 * Local, deterministic contact-safety rules. They run BEFORE any AI call; a
 * suppressed customer is never sent to the AI and gets "NO DRAFT CREATED".
 * The AI may later add a suppression, but can never remove one of these.
 *
 * Lessons from real eLead data, encoded here:
 *  - Our OWN outbound texts end with "STOP to unsubscribe…". Opt-out words are
 *    therefore only honored when the CUSTOMER says them (INBOUND rows) or when
 *    eLead itself records an opt-out outcome — never from outbound text.
 *  - Managers write notes like "Write Up SOLD- USED #1" at desking time even
 *    when the deal later falls through. "Sold" comes only from Sales Status.
 *  - eLead's "Do not text" phone icon appears on every customer we've seen,
 *    including ones actively texting back. It is shown as a caution, not a
 *    suppression (see HistoryFacts.textsDespiteDoNotTextIcon).
 */

/** A whole inbound message that is just an opt-out keyword (carrier keywords). */
const OPT_OUT_KEYWORD = /^\s*(stop|stop all|stopall|unsubscribe|cancel|end|quit|opt ?out|remove)\s*[.!]*\s*$/i;

/** Opt-out phrases inside a longer inbound message. */
const OPT_OUT_PHRASES: Array<[RegExp, string]> = [
  [/\b(stop|quit) (texting|calling|contacting|messaging|emailing)( me)?\b/i, 'Customer asked us to stop contacting them.'],
  [/\b(do not|don'?t|dont) (contact|text|call|email|message) me\b/i, 'Customer asked not to be contacted.'],
  [/\b(remove|take) me (off|from)\b/i, 'Customer asked to be removed from contact.'],
  [/\bunsubscribe\b/i, 'Customer unsubscribed.'],
  [/\bleave me alone\b/i, 'Customer asked to be left alone.'],
  [/\bno (more|further) (contact|texts|calls|messages|emails)\b/i, 'Customer requested no further contact.'],
];

const WRONG_NUMBER = /\b(wrong (number|person)|not (the right|this) person|you have the wrong|who is this for\?? i don'?t know)\b/i;

/** eLead-recorded (not free-text) opt-out outcomes, on any non-outbound row. */
const SYSTEM_OPT_OUT = /\b(opted[- ]?out|opt[- ]?out|unsubscribed|do not (contact|call|text|email)|dnc)\b/i;

export function evaluateSuppression(record: CustomerRecord): Suppression {
  const triggers: string[] = [];
  let reason: string | null = null;
  const set = (r: string, t: string) => {
    triggers.push(t);
    reason ??= r;
  };

  const status = record.opportunity.salesStatus ?? '';
  if (/\bsold\b/i.test(status)) set(`Customer already purchased (sales status: ${status}).`, `salesStatus:${status}`);
  if (/\b(lost|dead|bought elsewhere|duplicate|bad lead|invalid)\b/i.test(status)) {
    set(`Opportunity is closed in eLead (sales status: ${status}).`, `salesStatus:${status}`);
  }

  for (const row of record.history) {
    const text = row.comment ?? '';
    if (row.direction === 'INBOUND') {
      if (OPT_OUT_KEYWORD.test(text)) set('Customer requested no further contact.', `inbound:${row.rawDate}:keyword`);
      for (const [re, r] of OPT_OUT_PHRASES) if (re.test(text)) set(r, `inbound:${row.rawDate}:phrase`);
      if (WRONG_NUMBER.test(text)) set('Wrong number — this is not the customer.', `inbound:${row.rawDate}:wrong-number`);
    } else if (row.direction !== 'OUTBOUND') {
      if (SYSTEM_OPT_OUT.test(`${row.type} ${row.outcome ?? ''}`)) set('Customer is opted out in eLead.', `system:${row.rawDate}:${row.outcome ?? row.type}`);
    }
  }

  return { suppressed: triggers.length > 0, reason, triggers };
}
