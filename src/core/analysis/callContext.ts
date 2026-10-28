import type { ActivityRow, CustomerRecord } from '../types/schema';
import { computeHistoryFacts, type HistoryFacts } from './historyFacts';

/**
 * What to know at a glance while the phone rings. Deterministic and local:
 * quotes the customer's own words; no AI, nothing leaves the browser.
 */
export interface CallContext {
  facts: HistoryFacts;
  lastCustomerResponse: { text: string; at: string | null } | null;
  lastDealershipAttempt: { at: string | null; what: string } | null;
  /** Short, plain-language flags ("Customer previously expressed frustration…"). */
  important: string[];
  /** The most useful recent activity, oldest → newest. */
  recent: ActivityRow[];
  crmSummary: string | null;
}

const CUES: Array<[RegExp, (quote: string) => string]> = [
  [
    /\b(bother(ing)?|stop (calling|texting)|quit (calling|texting)|leave me alone|annoy(ed|ing)?|harass|keep (calling|texting)|too many (calls|texts))\b/i,
    (q) => `Customer previously expressed frustration with contact: “${q}”`,
  ],
  [
    /\b(get paid|payday|pay ?check|tax (return|refund)|after \d|until \d|work until|off work|next (week|month)|this weekend|monday|tuesday|wednesday|thursday|friday|saturday|sunday|call me (back|later|tomorrow|after)|in a (few|couple) (days|weeks|months))\b/i,
    (q) => `Timing: “${q}”`,
  ],
  [
    /\b(payment|per month|a month|\/mo|price|too (high|much|expensive)|afford|budget|down payment|interest|rate|apr|credit|financ|trade|upside down|owe)\b/i,
    (q) => `Money / trade: “${q}”`,
  ],
  [
    /\b(pass on|not interested|don'?t feel comfortable|changed my mind|went with|bought (one|a|another)|found (one|something|another))\b/i,
    (q) => `Said: “${q}”`,
  ],
];

const clip = (s: string, n = 160) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const shortDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '');

export function buildCallContext(record: CustomerRecord, today = new Date()): CallContext {
  const facts = computeHistoryFacts(record, today);
  const inbound = record.history.filter((h) => h.direction === 'INBOUND' && h.comment);

  const important: string[] = [];
  const used = new Set<string>();
  for (const [re, label] of CUES) {
    const hit = inbound.find((h) => re.test(h.comment!) && !used.has(h.comment!));
    if (hit) {
      used.add(hit.comment!);
      important.push(`${label(clip(hit.comment!))}${hit.at ? ` (${shortDate(hit.at)})` : ''}`);
    }
  }
  if (facts.customerReplies === 0) important.push('Has never replied.');
  if (facts.attemptsSinceLastReply >= 5) {
    important.push(`${facts.attemptsSinceLastReply} attempts since ${facts.customerReplies ? 'their last reply' : 'the lead came in'} (${facts.noAnswerCallsSinceLastReply} unanswered calls).`);
  }
  if (facts.visitEvidence.length) important.push('Has visited the store.');
  if (facts.appointmentMissed) important.push('Set an appointment, then missed it.');
  if (record.opportunity.trade) important.push(`Trade: ${record.opportunity.trade}`);

  // Meaningful activity: messages, notes with content, anything the customer said. Not bare "(No Answer)" calls.
  const meaningful = record.history.filter(
    (h) => h.direction === 'INBOUND' || h.channel === 'TEXT' || h.channel === 'EMAIL' || h.channel === 'APPOINTMENT' || (h.comment && !/^\(?no answer\)?$/i.test(h.comment)),
  );
  const recent = meaningful.slice(0, 6).reverse(); // history is newest-first

  return {
    facts,
    lastCustomerResponse: facts.lastCustomerReply?.text ? { text: facts.lastCustomerReply.text, at: facts.lastCustomerReply.at } : null,
    lastDealershipAttempt: facts.lastDealershipContact ? { at: facts.lastDealershipContact.at, what: facts.lastDealershipContact.type } : null,
    important,
    recent,
    crmSummary: record.crmAiSummary,
  };
}
