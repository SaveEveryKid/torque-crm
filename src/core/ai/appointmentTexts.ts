import type { CustomerRecord } from '../types/schema';
import type { ChatMessage } from './localEngine';
import { checkDraft, customerTranscript, parseDraft, type Writer } from './followUp';
import { FIRST_TRY_BUDGET, learningText, type LearningParts } from './contextBudget';
import { firstName, NEVER_LIST, storeName } from './playbook';

/**
 * APPOINTMENT TEXTS (no-show prevention): the confirmation the day before, the
 * morning-of text, and the no-guilt text after a missed appointment. You copy
 * and send them from eLead yourself. Same answer shape as follow-up drafts.
 */
export type AppointmentTextKind = 'confirm' | 'dayof' | 'noshow';

export const APPOINTMENT_TEXT_LABEL: Record<AppointmentTextKind, string> = {
  confirm: 'Confirmation text (day before)',
  dayof: 'Day-of text',
  noshow: 'No-show text',
};

const JOB: Record<AppointmentTextKind, string> = {
  confirm:
    'Sent the day before. Confirm the day and time simply and warmly, and make it easy to reschedule if something changes. No selling, no new information.',
  dayof:
    'Sent the morning of. Say you are looking forward to seeing them, and ask them to text when they are on the way so you can meet them out front (or have it pulled up front). No selling.',
  noshow:
    'Sent after they missed it. Zero guilt: never "what happened", "we had you down" or "I waited". Say you totally understand if something came up, and leave the door open with one easy choice question that has an out (another day, or no pressure either way).',
};

export function appointmentPrompt(w: Writer, kind: AppointmentTextKind): string {
  const me = firstName(w);
  return `You write one short text for ${me}, a salesperson at ${storeName(w)}, about a customer's appointment. ${me} reviews and sends it personally.

THIS TEXT: ${JOB[kind]}
Customers show up when they feel safe and still in control: calm, short, no pressure, an easy out. A text that keeps selling after they've said yes plants doubt.

${NEVER_LIST}VOICE
- Calm, short, human, plain American English. First name only. No sign-off.
- Call it what a person would say ("the Grizzly"), not the listing title.
- Use the appointment day and time exactly as given; never invent another one.
- Write fresh; don't sound like a template.

OUTPUT
- text: 1-2 short sentences, under 240 characters.
- emailSubject and emailBody: "". skip: false. skipReason: "".
- why: one short sentence for ${me} on the approach.`;
}

export interface AppointmentInfo {
  customerFirstName: string;
  vehicle: string | null;
  /** When the appointment is (ISO), if known. */
  at: string | null;
  note: string | null;
}

export function describeWhen(iso: string | null, now = new Date()): string {
  if (!iso) return 'time not recorded';
  const d = new Date(iso);
  const days = Math.round((new Date(d.toDateString()).getTime() - new Date(now.toDateString()).getTime()) / 86_400_000);
  const rel = days === 0 ? 'today' : days === 1 ? 'tomorrow' : days === -1 ? 'yesterday' : '';
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${d.toLocaleDateString('en-US', { weekday: 'long', month: 'numeric', day: 'numeric' })}${rel ? ` (${rel})` : ''} at ${time}`;
}

export async function draftAppointmentText(opts: {
  kind: AppointmentTextKind;
  info: AppointmentInfo;
  record: CustomerRecord | null;
  writer: Writer;
  complete: (messages: ChatMessage[]) => Promise<unknown>;
  /** Your profile (never cut) + optional extras. */
  style?: string | LearningParts;
  now?: Date;
}): Promise<{ text: string; why: string; warnings: string[] }> {
  const { kind, info, record, writer, complete, style = '', now = new Date() } = opts;
  const facts = [
    `Customer first name: ${info.customerFirstName}`,
    `Vehicle: ${info.vehicle ?? 'not recorded'}`,
    `Appointment: ${describeWhen(info.at, now)}`,
    `Now: ${describeWhen(now.toISOString(), now).replace(' (today)', '')}`,
    info.note ? `${firstName(writer)}'s note: ${info.note}` : '',
  ].filter(Boolean);
  const history = record ? `\n\nCUSTOMER HISTORY:\n${customerTranscript(record, writer, now)}` : '';
  const system = appointmentPrompt(writer, kind);
  const rest = `${facts.join('\n')}${history}`;
  const user = learningText(style, FIRST_TRY_BUDGET - system.length - rest.length) + rest;
  const messages: ChatMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
  let warnings: string[] = [];
  for (let attempt = 1; ; attempt++) {
    const raw = await complete(messages);
    const parsed = parseDraft(raw);
    if (parsed.ok) {
      const d = { ...parsed.value, skip: false, emailSubject: null, emailBody: null };
      warnings = checkDraft(d, { text: true, email: false }, user, record ?? ({ customer: { fullName: '' } } as CustomerRecord));
      if (d.text && (warnings.length === 0 || attempt >= 2)) return { text: d.text, why: d.why, warnings };
      if (!d.text) warnings = ['text is missing'];
    } else warnings = parsed.errors;
    if (attempt >= 2) throw new Error(`The AI's answer was unusable: ${warnings.join('; ')}`);
    messages.push(
      { role: 'assistant', content: JSON.stringify(raw) },
      { role: 'user', content: `Your answer had these problems. Fix them and answer again with the full JSON:\n- ${warnings.join('\n- ')}` },
    );
  }
}
