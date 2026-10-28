import type { CustomerRecord } from '../types/schema';
import type { ChatMessage } from './localEngine';
import { checkDraft, customerTranscript, parseDraft, type Writer } from './followUp';
import { FIRST_TRY_BUDGET, learningText, type LearningParts } from './contextBudget';
import { firstName, gatesSection, NEVER_LIST, voiceSection } from './playbook';

/**
 * REPLY HELPER: you paste what the customer just said (or the whole thread);
 * Claude names the gate that's closed and suggests your next reply. You copy it
 * and send it from eLead yourself. Nothing is sent from here.
 *
 * Uses the same answer shape as follow-up drafts (so your dialer needs no update):
 * text = the reply, why = the gate diagnosis, skip = "hold off for now",
 * skipReason = why to hold off, or a warning for you when replying.
 */
export interface ReplySuggestion {
  /** The gate diagnosis, e.g. "Control: 'let me think about it' after you asked for a time." */
  gate: string;
  reply: string | null;
  /** Don't reply right now (give them space, or they asked us to stop). */
  hold: boolean;
  /** Why to hold off, or a heads-up such as "compliance yes" or "they said yes: stop selling". */
  note: string | null;
}

export const MAX_THREAD = 4000;

/** For the last-name check when no eLead record was picked. */
const NO_RECORD = { customer: { fullName: '' } } as CustomerRecord;

export function replyPrompt(w: Writer): string {
  const me = firstName(w);
  return `You coach ${me}, a salesperson at ${w.dealership || 'the dealership'}, in a live text conversation with a customer. ${me} pasted the conversation (most recent message last). Lines starting "Me:" are ${me}; other lines are the customer. If nothing is labeled, treat it all as the customer's latest message. eLead history may follow; the pasted conversation is newer. Suggest ${me}'s next reply. The goal is an appointment the customer actually keeps, set without pressure.

${gatesSection(w)}READ THE LATEST CUSTOMER MESSAGE
- Name the gate it shows. Answer the gate underneath, not the surface words. "Just send me the price": recognize first and ask what made this one stand out; never invent a number.
- INTERNAL YES: they ask logistics (what time, what to bring, can I drive it) or say "when I come in". Stop selling. Reply with logistics only: two time choices if no time is set yet, or a simple confirmation. Note: "They've said yes: logistics only."
- COMPLIANCE YES: "yeah I guess", "sure, why not", a bare "ok", "probably", agreeing fast right after being pushed. Don't lock it in yet: check in ("Before I put you down, does Thursday really work, or would another day feel better?"). Note: "Sounds like a compliance yes. Make sure it's real."
- EXCITED, rapid-fire: don't match the energy. Calm the pace with one grounding question before setting a time.
- PROCESSING: they said they'd think it over, or went quiet after engaging, and ${me}'s last line already answered them: hold off. skip=true; skipReason says to give them space and try again in a day or two.
- They asked us to stop, said wrong number, or bought: skip=true with the reason.

${NEVER_LIST}${voiceSection(w)}OUTPUT
- text: the reply, 1-3 short sentences, under 300 characters. Use the customer's first name only if it's natural mid-conversation (usually not needed).
- emailSubject and emailBody: "".
- why: the gate diagnosis for ${me} in one short sentence, quoting the customer's words.
- skip: true only when ${me} should NOT reply right now; then text is "" and skipReason says why and what to do instead.
- When skip is false, skipReason is a one-line heads-up for ${me} if one applies (compliance yes, they've said yes, a red flag), otherwise "".`;
}

export async function suggestReply(opts: {
  thread: string;
  record: CustomerRecord | null;
  writer: Writer;
  complete: (messages: ChatMessage[]) => Promise<unknown>;
  /** Your profile (never cut) + optional extras. */
  style?: string | LearningParts;
  today?: Date;
}): Promise<{ suggestion: ReplySuggestion; warnings: string[] }> {
  const { thread, record, writer, complete, style = '', today = new Date() } = opts;
  const pasted = thread.trim().slice(-MAX_THREAD);
  if (!pasted) throw new Error('Paste what the customer said first.');
  const history = record ? `\n\nCUSTOMER HISTORY (older):\n${customerTranscript(record, writer, today)}` : `\n\nToday: ${today.toISOString().slice(0, 10)} (${today.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })})`;
  const system = replyPrompt(writer);
  const rest = `CONVERSATION (pasted by ${firstName(writer)}, most recent last):\n${pasted}${history}`;
  const user = learningText(style, FIRST_TRY_BUDGET - system.length - rest.length) + rest;
  const messages: ChatMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
  let warnings: string[] = [];
  for (let attempt = 1; ; attempt++) {
    const raw = await complete(messages);
    const parsed = parseDraft(raw);
    if (!parsed.ok) {
      if (attempt >= 2) throw new Error(`The AI's answer was unusable: ${parsed.errors.join('; ')}`);
      warnings = parsed.errors;
    } else {
      const d = parsed.value;
      // Rule check on the reply only (no email); the pasted thread counts as history for money mentions.
      warnings = checkDraft({ ...d, emailSubject: null, emailBody: null }, { text: !d.skip, email: false }, user, record ?? NO_RECORD);
      if (d.text && d.text.length > 320) warnings.push('reply is long (keep it under 300 characters)');
      if (warnings.length === 0 || attempt >= 2) {
        return {
          suggestion: { gate: d.why, reply: d.skip ? null : d.text, hold: d.skip, note: d.skipReason },
          warnings,
        };
      }
    }
    messages.push(
      { role: 'assistant', content: JSON.stringify(raw) },
      { role: 'user', content: `Your answer had these problems. Fix them and answer again with the full JSON:\n- ${warnings.join('\n- ')}` },
    );
  }
}
