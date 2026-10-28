import type { CustomerRecord } from '../types/schema';
import { buildCallContext } from './callContext';

/**
 * DIALER OPENER: the first line to say when a customer picks up, matched to the
 * gate their history shows is closed (Byron's three-gates method). Local and
 * instant: no AI, nothing leaves the browser.
 */
export interface Opener {
  gate: 'Safety' | 'Control' | 'Self-image';
  /** Why this opener, in a few words. */
  reason: string;
  line: string;
  /** What to do next on the call. */
  next: string;
}

const MAKES =
  /^(toyota|gmc|chevrolet|chevy|ford|honda|nissan|hyundai|kia|jeep|ram|dodge|subaru|mazda|lexus|bmw|mercedes-benz|mercedes|volkswagen|vw|audi|buick|cadillac|chrysler|lincoln|acura|infiniti|mitsubishi|tesla|volvo|genesis|land rover|porsche|mini)\s+/i;

/** "2026 GMC Sierra 1500 Denali Ultimate 4x4 Crew Cab" → "the Sierra". */
export function shortVehicle(v: string | null | undefined): string {
  const rest = (v ?? '').replace(/^\s*(new|used|certified|pre-owned)\s+/i, '').replace(/^\s*(19|20)\d{2}\s+/, '').replace(MAKES, '').trim();
  const model = rest.split(/\s+/)[0];
  return model && /[a-z]/i.test(model) ? `the ${model}` : 'the vehicle you asked about';
}

const THINKING = /\b(think (about|it over)|let you know|get back to you|talk (to|with) my (wife|husband|spouse|dad|mom)|not (ready|sure yet)|need (more )?time)\b/i;
const RESEARCH = /\b(research|looking around|comparing|shopping around|other dealers?|more careful|feels? (fast|rushed))\b/i;
const ANNOYED = /\b(bother(ing)?|stop (calling|texting)|quit (calling|texting)|leave me alone|annoy(ed|ing)?|keep (calling|texting)|too many (calls|texts))\b/i;
const clip = (s: string, n = 70) => (s.length > n ? `${s.slice(0, n - 1).trim()}…` : s);

export function openerFor(record: CustomerRecord, me: { name: string; dealership: string }, today = new Date()): Opener {
  const ctx = buildCallContext(record, today);
  const f = ctx.facts;
  const name = record.customer.firstName || 'there';
  const who = `${me.name.trim().split(/\s+/)[0] || 'this is'} at ${me.dealership || 'the dealership'}`;
  const car = shortVehicle(record.opportunity.vehicle);
  const said = record.history.filter((h) => h.direction === 'INBOUND' && h.comment).map((h) => h.comment!);
  const last = ctx.lastCustomerResponse?.text ?? '';

  if (said.some((s) => ANNOYED.test(s)))
    return {
      gate: 'Safety',
      reason: "They've been bothered by contact before",
      line: `Hi ${name}, it's ${who}. I'll be quick. Is now an okay time, or would a text be easier?`,
      next: 'If they hesitate, offer to text and get off the phone. Keep it under a minute.',
    };
  if (f.appointmentMissed)
    return {
      gate: 'Control',
      reason: 'Missed an appointment',
      line: `Hi ${name}, it's ${who}. No worries at all about the other day, things come up. Did I catch you at an okay time?`,
      next: 'Zero guilt. Offer another day as a choice with an out: "This week, or is it still a little early?"',
    };
  if (f.customerReplies === 0)
    return {
      gate: 'Safety',
      reason: 'Has never replied',
      line: `Hi ${name}, this is ${who}. You'd asked about ${car}. Did I catch you at an okay time?`,
      next: 'If they sound rushed: "I\'ll send you a text instead." If yes: "What made you start looking?"',
    };
  if (THINKING.test(last))
    return {
      gate: 'Control',
      reason: `Last said: “${clip(last)}”`,
      line: `Hi ${name}, it's ${who}. No rush on anything. Is now an okay time for a quick question?`,
      next: 'Hand back control: "Are you hoping to see something this week, or still just exploring?"',
    };
  if (RESEARCH.test(last))
    return {
      gate: 'Self-image',
      reason: `Last said: “${clip(last)}”`,
      line: `Hi ${name}, it's ${who}. Sounds like you're doing your homework, which makes sense. Is now an okay time?`,
      next: 'Most careful buyers come in to confirm what they already know. Ask: "What would make this feel solid for you?"',
    };
  if ((f.daysSinceLastReply ?? 0) > 30)
    return {
      gate: 'Safety',
      reason: `Quiet for ${f.daysSinceLastReply} days`,
      line: `Hi ${name}, it's ${who}. It's been a little while, so I'll keep it short. Did I catch you at an okay time?`,
      next: 'Permission first: "Are you still looking, or did you get taken care of?" Either answer is fine.',
    };
  return {
    gate: 'Safety',
    reason: last ? `Last said: “${clip(last)}”` : 'Has talked with us before',
    line: `Hi ${name}, it's ${who}. Did I catch you at an okay time?`,
    next: last
      ? `Recognize what they told you first. If it feels open: "Want to come see ${car} this week, or still a bit early?"`
      : `Ask what made them start looking. If it feels open: "Want to come see ${car} this week, or still a bit early?"`,
  };
}
