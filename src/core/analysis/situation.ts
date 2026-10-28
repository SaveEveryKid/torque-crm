import type { CustomerRecord } from '../types/schema';
import { computeHistoryFacts } from './historyFacts';

/**
 * WHAT SITUATION IS THIS CUSTOMER IN? Used to file your edits, so a draft for a
 * "let me think about it" customer is shown how YOU handled "let me think about
 * it" before. Local and instant (no AI).
 */
export type Situation =
  | 'never_replied'
  | 'thinking'
  | 'price'
  | 'trade'
  | 'research'
  | 'not_now'
  | 'missed_appt'
  | 'has_appt'
  | 'went_quiet'
  | 'talking'
  | 'appointment_text';

export const SITUATION_LABEL: Record<Situation, string> = {
  never_replied: 'never replied',
  thinking: 'said they need to think / talk to someone',
  price: 'asked about price or payments',
  trade: 'talking about their trade',
  research: 'still researching / comparing',
  not_now: 'busy or not ready yet',
  missed_appt: 'missed an appointment',
  has_appt: 'has an appointment',
  went_quiet: 'went quiet after talking',
  talking: 'in an active conversation',
  appointment_text: 'appointment confirmation / reminder',
};

const THINKING = /\b(think (about|it over|on it)|let you know|get back (to|with) you|talk (to|with) (my )?(wife|husband|spouse|dad|mom|family)|need (more )?time|sleep on it)\b/i;
const PRICE = /\b(price|pricing|payment|per month|a month|\/mo|out the door|otd|numbers|down payment|rate|apr|financ|afford|budget|cost)\b/i;
const TRADE = /\b(trade|trade-in|my (truck|car|suv|atv|four.?wheeler|side.?by.?side|utv|boat|bike|mower)|payoff|owe|upside down|appraise|appraisal)\b/i;
const RESEARCH = /\b(research|looking around|comparing|shopping around|other dealers?|just looking|browsing)\b/i;
const NOT_NOW = /\b(not (ready|right now|yet)|busy|work (those|that|all)|working|later|next (week|month)|after (the|my)|in a (few|couple)|when i('m| am) ready|no rush)\b/i;

/** Situation from the latest thing the customer said (or the pasted thread). */
export function situationFromText(text: string): Situation | null {
  if (THINKING.test(text)) return 'thinking';
  if (PRICE.test(text)) return 'price';
  if (TRADE.test(text)) return 'trade';
  if (RESEARCH.test(text)) return 'research';
  if (NOT_NOW.test(text)) return 'not_now';
  return null;
}

export function situationFor(record: CustomerRecord | null, latestCustomerText = '', today = new Date()): Situation {
  const fromText = latestCustomerText ? situationFromText(latestCustomerText) : null;
  if (fromText) return fromText;
  if (!record) return 'talking';
  const f = computeHistoryFacts(record, today);
  if (f.appointmentMissed) return 'missed_appt';
  if (f.customerReplies === 0) return 'never_replied';
  const said = f.lastCustomerReply?.text ? situationFromText(f.lastCustomerReply.text) : null;
  if (said) return said;
  if (f.appointments > 0 && !f.visitEvidence.length) return 'has_appt';
  return (f.daysSinceLastReply ?? 0) > 3 ? 'went_quiet' : 'talking';
}
