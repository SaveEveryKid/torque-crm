import type { ChatMessage } from './localEngine';
import { parseDraft } from './followUp';
import { SITUATION_LABEL } from '../analysis/situation';
import type { StyleExample } from '../storage/styleMemory';

/**
 * Claude reads your edits (what the AI wrote, what you sent, why) and the
 * messages that worked, and writes or updates the "How Byron sells" profile.
 * Uses the same answer shape as drafts (profile in emailBody, what changed in
 * why) so your dialer needs no update.
 */
export function profilePrompt(me: string): string {
  return `You study how ${me}, a salesperson, writes and thinks, so an AI can draft follow-ups that sound and decide exactly like him.

You get his current profile (may be empty; it already reflects his earlier edits), then his NEW examples since that profile: what an AI drafted, what ${me} actually sent instead, sometimes why he changed it, and messages he sent as written. Messages that got replies or appointments may follow.

Write the updated profile in two sections:
VOICE: how he writes. Length, openings, greetings, phrases he uses, phrases he removes, punctuation, tone, how he asks questions, how he signs off (or doesn't).
THINKING: how he reads customers and decides the next move. When he pushes, when he backs off, how he handles "let me think", price questions, busy customers, silence; what he offers instead of asking for an appointment; what he refuses to do.

Rules:
- 8-16 short, concrete bullet rules, each one something the AI can act on ("Removes 'or should I leave it with you?' when the customer hasn't said no").
- Base every rule on the examples. Keep rules from the current profile unless the new examples contradict them; then change them.
- Quote his short phrases when they are typical of him. Never include customer names, phone numbers, prices or other customer details.
- Under 1600 characters total.

Answer in JSON: emailBody = the full profile; why = one sentence on what changed from the current profile (or "First profile"); text, emailSubject, skipReason = ""; skip = false.`;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const flat = (s: string) => s.replace(/\s+/g, ' ');

/** Profile updates must fit the dialer too (system prompt + this input). */
const PROFILE_REQUEST_BUDGET = 20_500;

/**
 * What Claude reads to update your profile, bounded: the current profile (which
 * already holds everything learned before), plus only the edits made since it was
 * last updated (newest 25), a few as-written sends and what worked. If that is
 * still too big, the oldest new edits are left for the next update.
 */
export function profileInput(current: string, examples: StyleExample[], winners: string, since: string | null = null): { text: string; learnedThrough: string | null; editsUsed: number } {
  const fresh = since ? examples.filter((e) => e.at > since) : examples;
  let edits = fresh.filter((e) => !e.approved).slice(-25);
  const approved = fresh.filter((e) => e.approved).slice(-6);
  const render = () => {
    const lines = edits.map((e) => {
      const where = e.situation ? ` [customer ${SITUATION_LABEL[e.situation]}]` : '';
      const why = [...(e.reasons ?? []), e.note ?? ''].filter(Boolean).join('; ');
      return `AI wrote${where}: ${clip(flat(e.ai), 220)}\nHe sent: ${clip(flat(e.sent), 220)}${why ? `\nWhy: ${why}` : ''}`;
    });
    const ok = approved.map((e) => `Sent as written${e.situation ? ` [customer ${SITUATION_LABEL[e.situation]}]` : ''}: ${clip(flat(e.sent), 220)}`);
    return [
      `CURRENT PROFILE (already learned from his earlier edits):\n${current.trim() || '(none yet)'}`,
      `HIS NEW EDITS SINCE THAT PROFILE (oldest first):\n${lines.join('\n\n') || '(none)'}`,
      ok.length ? `SENT AS WRITTEN:\n${ok.join('\n')}` : '',
      winners.trim(),
    ]
      .filter(Boolean)
      .join('\n\n');
  };
  const room = PROFILE_REQUEST_BUDGET - profilePrompt('X').length - 200;
  let text = render();
  // Too big: leave the oldest new edits for the next update (they stay in storage).
  while (text.length > room && edits.length > 5) {
    edits = edits.slice(1);
    text = render();
  }
  if (text.length > room) {
    winners = '';
    text = render();
  }
  const newest = [...edits, ...approved].map((e) => e.at).sort().pop() ?? null;
  return { text, learnedThrough: newest, editsUsed: edits.length };
}

export async function buildProfile(opts: {
  me: string;
  current: string;
  examples: StyleExample[];
  winners: string;
  complete: (messages: ChatMessage[]) => Promise<unknown>;
  /** Only edits after this are new to the profile. */
  since?: string | null;
}): Promise<{ text: string; summary: string; learnedThrough: string | null }> {
  const input = profileInput(opts.current, opts.examples, opts.winners, opts.since ?? null);
  const raw = await opts.complete([
    { role: 'system', content: profilePrompt(opts.me) },
    { role: 'user', content: input.text },
  ]);
  const parsed = parseDraft(raw);
  if (!parsed.ok || !parsed.value.emailBody) throw new Error("Claude's profile answer was unusable. Try again.");
  return { text: parsed.value.emailBody.slice(0, 2400), summary: parsed.value.why, learnedThrough: input.learnedThrough };
}
