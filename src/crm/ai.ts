import { draftFollowUp, type DraftResult, type Writer } from '../core/ai/followUp';
import type { ChatMessage } from '../core/ai/localEngine';
import { firstName } from '../core/ai/playbook';
import { buildProfile } from '../core/ai/profile';
import { suggestReply } from '../core/ai/replyHelper';
import { draftAppointmentText, type AppointmentTextKind } from '../core/ai/appointmentTexts';
import type { LearningParts } from '../core/ai/contextBudget';
import { listContext, type ListType } from '../core/analysis/customList';
import { sendResults, winnersBlock, type CustomerInfo, type SendResult } from '../core/analysis/results';
import { situationFor, type Situation } from '../core/analysis/situation';
import { dialerProvider, dialerReady } from './server';
import { getCallLog } from '../core/storage/callLog';
import { getSent, getSentMap } from '../core/storage/sentLog';
import { getStyleExamples, styleBlock } from '../core/storage/styleMemory';
import { getProfile, learnedCutoff, profileBlock, profileDue, saveProfile } from '../core/storage/styleProfile';
import { toRecord } from './record';
import { getCustomers } from './store';
import type { Customer, Settings } from './types';

/**
 * Claude, through YOUR dialer's /draft (your Anthropic key stays in the
 * Cloudflare Worker). One customer at a time; nothing is ever sent to a customer.
 */
export type Complete = (messages: ChatMessage[]) => Promise<unknown>;

export const writerOf = (s: Settings): Writer => ({ name: s.name, dealership: s.dealership, phone: s.phone, sells: s.sells });
export const meOf = (s: Settings) => firstName(writerOf(s));

/** Claude goes through your dialer, set up on Cloudflare. */
export const aiReady = () => dialerReady();

export function completeFor(s: Settings): Complete {
  if (!aiReady()) throw new Error('Claude goes through your dialer: add DIALER_URL and DIALER_PASSWORD in Cloudflare first (see Settings).');
  const provider = dialerProvider();
  return (messages) => {
    const [system, ...rest] = messages;
    const turns = rest.map((m) => ({ role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const), content: m.content }));
    return provider.draft(system.content, turns, s.claudeQuality);
  };
}

function customerInfo(customers: Customer[], me: string): Map<string, CustomerInfo> {
  return new Map(customers.map((c) => [c.id, { firstName: c.firstName, record: toRecord(c, me), sold: c.stage === 'sold' }]));
}

/** What happened after each message you sent from Torque. */
export async function loadResults(s: Settings): Promise<SendResult[]> {
  return sendResults(await getSentMap(), customerInfo(Object.values(await getCustomers()), s.name), await getCallLog());
}

/** Your profile (never cut), your newest not-yet-learned edits, and messages that worked. */
export async function learningFor(s: Settings, situation: Situation | null, kind: 'short' | 'all' = 'all'): Promise<LearningParts> {
  const me = meOf(s);
  const p = await getProfile();
  const examples = await getStyleExamples();
  const hasProfile = !!p.text.trim();
  const cutoff = learnedCutoff(p);
  const counts = hasProfile ? [2, 1] : [4, 2, 1];
  const results = await loadResults(s);
  return {
    profile: profileBlock(p, me),
    examples: [...new Set([...counts.map((n) => styleBlock(examples, me, kind, situation, n, hasProfile ? cutoff : null, !hasProfile)), ''])],
    winners: [...new Set([winnersBlock(results, me, 3), winnersBlock(results, me, 1), ''])],
  };
}

export interface DraftOptions {
  listType?: ListType | null;
  /** Anything you want Claude to know for this one draft ("we just got a 2025 in green"). */
  note?: string;
  finalCheckin?: boolean;
}

export async function draftFor(c: Customer, s: Settings, opts: DraftOptions = {}): Promise<DraftResult> {
  const record = toRecord(c, s.name);
  const situation = situationFor(record);
  const list = opts.listType ? listContext({ listType: opts.listType, listNote: opts.note ?? '' } as Parameters<typeof listContext>[0]) : '';
  const info = list || (opts.note?.trim() ? `ABOUT THIS FOLLOW-UP (from the salesperson): ${opts.note.trim()}\n\n` : '');
  return draftFollowUp(record, writerOf(s), completeFor(s), new Date(), !c.doNotText && !!c.phone, 'claude', await learningFor(s, situation), await getSent(c.id), info, {
    listType: opts.listType ?? null,
    finalCheckin: opts.finalCheckin,
  });
}

/** Paste what they just said → the reply Claude would send. */
export async function replyFor(c: Customer, s: Settings, thread: string) {
  const record = toRecord(c, s.name);
  return suggestReply({ thread, record, writer: writerOf(s), complete: completeFor(s), style: await learningFor(s, situationFor(record, thread), 'short') });
}

export async function appointmentTextFor(c: Customer, s: Settings, kind: AppointmentTextKind, at: string) {
  const record = toRecord(c, s.name);
  return draftAppointmentText({
    kind,
    info: { customerFirstName: c.firstName, vehicle: c.vehicle?.title || c.interest || null, at, note: null },
    record,
    writer: writerOf(s),
    complete: completeFor(s),
    style: await learningFor(s, null, 'short'),
  });
}

/** After every 10 new edits, Claude proposes an updated "How I sell" profile for your OK (Settings). */
export async function maybeProposeProfile(s: Settings, force = false): Promise<boolean> {
  if (!aiReady()) return false;
  const examples = await getStyleExamples();
  const edits = examples.filter((e) => !e.approved).length;
  const p = await getProfile();
  if (!force && !profileDue(p, edits)) return false;
  const me = meOf(s);
  const built = await buildProfile({ me, current: p.text, examples, winners: winnersBlock(await loadResults(s), me, 6), complete: completeFor(s), since: learnedCutoff(p) });
  const latest = await getProfile();
  await saveProfile({ ...latest, pending: { text: built.text, summary: built.summary, at: new Date().toISOString(), basedOn: edits, learnedThrough: built.learnedThrough } });
  return true;
}
