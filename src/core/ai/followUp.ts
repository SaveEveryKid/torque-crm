import type { ActivityRow, CustomerRecord } from '../types/schema';
import { computeHistoryFacts } from '../analysis/historyFacts';
import type { ChatMessage } from './localEngine';
import { gatesSection, NEVER_LIST, voiceSection } from './playbook';
import type { SentMessage } from '../storage/sentLog';
import type { ListType } from '../analysis/customList';
import { buildCustomerContext, SHRINK_ORDER, type ContextStats } from './customerContext';
import {
  asLearningParts,
  ContextBudgetError,
  FIRST_TRY_BUDGET,
  fitContextToBudget,
  HARD_BUDGET,
  learningSections,
  type BudgetReport,
  type ContextSection,
  type LearningParts,
} from './contextBudget';

/**
 * FOLLOW-UP DRAFTS: one short text + one email per customer, written by a
 * free AI running on this computer. The salesperson reviews, edits, copies and
 * sends them from eLead themselves. Nothing here sends anything anywhere.
 */
export interface Writer {
  /** e.g. "Byron Green" */
  name: string;
  /** e.g. "Singing River Toyota" */
  dealership: string;
  /** Not used in drafts any more (eLead adds your email signature). */
  phone: string;
}

export interface FollowUpDraft {
  skip: boolean;
  skipReason: string | null;
  text: string | null;
  emailSubject: string | null;
  emailBody: string | null;
  /** One line for the salesperson: why this message fits this customer. */
  why: string;
}

export const DRAFT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['skip', 'skipReason', 'text', 'emailSubject', 'emailBody', 'why'],
  properties: {
    skip: { type: 'boolean' },
    // Plain strings ("" = none): small in-browser grammar engines handle these reliably.
    skipReason: { type: 'string' },
    text: { type: 'string' },
    emailSubject: { type: 'string' },
    emailBody: { type: 'string' },
    why: { type: 'string' },
  },
} as const;

const firstWord = (s: string) => s.trim().split(/\s+/)[0] ?? '';

export type DraftEngine = 'claude' | 'local';

/**
 * The instructions for the AI. Claude gets the full appointment playbook (Byron's
 * "three gates" method); the small free model on this computer gets the short
 * version, because a long prompt makes it slower and less reliable.
 */
export function systemPrompt(w: Writer, engine: DraftEngine = 'claude'): string {
  return engine === 'local' ? shortPrompt(w) : playbookPrompt(w);
}

function playbookPrompt(w: Writer): string {
  const me = firstWord(w.name) || 'the salesperson';
  const store = w.dealership || 'the dealership';
  return `You write follow-ups for ${me}, a salesperson at ${store}. ${me} reviews, edits and sends every one personally. The goal of every message is an appointment the customer actually shows up for, set without pressure.

${gatesSection(w)}FIRST, DIAGNOSE (read the history)
- If a LIST TYPE comes first, it tells you what kind of customer this is and what the follow-up is for. Follow it, but the customer's own history still decides the gate.
- Which gate is closed right now? Use the CUSTOMER's own words above everything else.
- Where are they? Never replied / went quiet mid-conversation / long silence / has an appointment / missed an appointment / visited but didn't buy.
- What did they tell us about their situation, timing or worries? That is your material.
- Did they write back after our last message (a CUSTOMER line is the newest)? Then this is a REPLY: answer what they said first, then make the next move.
- What have WE already said? Read every US line and WHAT WE ALREADY SENT. If they didn't answer it, never send it again in new words: take a different angle (a different question, a new reason to visit, much shorter, or a permission-based close of the loop). Never reuse a previous opening, question or email subject.

THEN WRITE ONE MOVE TOWARD THE APPOINTMENT, sized to the gate
Every message moves toward a visit. How directly depends on the gate:
- Safety closed, or they've never really talked to us: lead with recognition and a question about their situation ("what got you looking at the Tundra?"). Then, at most, one low-key line that the door is open to see it in person. No times, no ask.
- Safety open, control unclear: a choice question with a built-in out: "Want to come drive it Thursday or Saturday, or is it still a little early?"
- They've shown readiness (asked about the car, timing, trade, availability): a clean invitation with two specific days and afternoon/evening. Logistics only; stop selling.
- Appointment set: confirm it simply. Missed it: no guilt, keep the door open ("totally understand if something came up").
- Long silence: permission-based. Offer to help with this one or something else, or close the loop gracefully.
When suggesting days, use the weekday given under Today and pick days in the next week. Never Sunday.

${NEVER_LIST}${voiceSection(w)}- text: 1-2 short sentences, under 240 characters. If they haven't replied recently, say who you are ("${me} at ${store}").
- emailSubject: 2-6 words, plain, no hype.
- emailBody: start with the customer's first name and a comma, then 2-5 short sentences. The same one move, with a little more room for recognition. Do NOT add a sign-off, name or signature; the email program adds the signature.
- Can text: no => text "". Can email: no => emailSubject and emailBody "".

SKIP
If the customer clearly asked us to stop, said wrong number, or already bought, set skip=true, give skipReason, and set text, emailSubject and emailBody to "". Desk notes like "SOLD" in a write-up are not proof of a sale; the notes may be out of date. When skip is false, skipReason is "".

why: one short sentence for ${me} naming the gate you judged closed (safety, control or self-image) and the move you made, e.g. "Safety: never replied, so recognition first with a soft open door."

Shape only (do not copy):
- Never replied: "Marcus, it's ${me} at ${store}. What has you looking at trucks right now, replacing something or adding one?"
- Talked, then quiet: "No rush at all on the Sierra. Want to come drive it Thursday or Saturday, or is it still a bit early?"`;
}

function shortPrompt(w: Writer): string {
  const me = firstWord(w.name) || 'the salesperson';
  const store = w.dealership || 'the dealership';
  return `You help ${me}, a salesperson at ${store}, write short, personal follow-ups that ${me} will review and send personally.

Read the customer's history below. CUSTOMER lines are the customer's own words and matter most: timing ("I get paid Friday"), objections, irritation, "I bought something". US lines are the dealership. NOTE lines are internal. Desk notes like "SOLD" in a write-up are not proof of a sale. The eLead summary may be wrong.

If the customer clearly asked us to stop, said wrong number, or already bought, set skip=true, give skipReason, and set text, emailSubject and emailBody to "".

Otherwise write like a real person, not an AI:
- Plain, friendly American English. No emojis. No hype. At most one "!".
- Never say "hope this finds you well", "touch base", "circle back", "don't hesitate", "vehicle needs", "valued customer".
- Never mention how many times we called, texted or emailed.
- NEVER invent prices, payments, rates, rebates, incentives, availability, approvals, trade values or deadlines.
- Use only the customer's first name. Mention something real from the history when it helps.
- End with ONE easy question they can answer in a few words that moves toward a visit, e.g. "Want to come see it Thursday or Saturday, or is it still a little early?"
- Never use urgency ("won't last", "lot of interest") or guilt ("are you still interested?", "just checking in").
- Never repeat a message we already sent (US lines and WHAT WE ALREADY SENT). Take a different angle.
- text: 1-2 short sentences, under 240 characters. If they haven't replied recently, say who you are: "${me} at ${store}".
- emailSubject: 2-6 words.
- emailBody: start with the customer's first name and a comma, then 3-5 short sentences. Do NOT add a sign-off, name or signature; the email program adds the signature.
- Can text: no => text "". Can email: no => emailSubject and emailBody "".
- When skip is false, skipReason is "".
- why: one short sentence for ${me} explaining the approach.

Example for a long-silent customer who was once annoyed:
text: "Jennifer, this is ${me} at ${store}. I know it's been a while, so I'll keep this quick. Are you still looking, or can I close the loop on my end?"
emailSubject: "Quick question"
emailBody: "Jennifer,\\n\\nI'm cleaning up my customer list and wanted to check with you before I marked anything complete. Are you still looking for a vehicle, or have you already taken care of it?\\n\\nEither way is completely fine."`;
}

const LINE_LIMIT_CUSTOMER = 300;
const LINE_LIMIT_OTHER = 180;
/** Our own texts and emails: long enough that the AI sees what we said and doesn't repeat it. */
const LINE_LIMIT_OURS = 320;
const SENT_LIMIT = 500;
const TRANSCRIPT_BUDGET = 3000; // characters (~800 tokens): less work per draft for slow built-in graphics
/** Carrier compliance footer our own texting platform appends; not the customer opting out. */
const COMPLIANCE_FOOTER = /\s*(Reply\s+)?STOP to (unsubscribe|opt[ -]?out|end)[^]*$/i;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const yes = (b: boolean) => (b ? 'yes' : 'no');

export interface DraftChannels {
  text: boolean;
  email: boolean;
}

/** Can we draft a text / an email for this customer at all? */
/**
 * A text is drafted for EVERY customer in the queue. The only reasons not to text
 * (they texted STOP / opted out, or they bought) are handled before drafting: the
 * queue already leaves out Opted-out and Sold customers, and the AI skips anyone
 * whose history says they stopped us or bought elsewhere. eLead's "Do not text"
 * icon does not block a draft (you decide when you send). An email needs an address.
 */
export function channelsFor(record: CustomerRecord, canText = true): DraftChannels {
  return { text: canText, email: record.customer.emails.length > 0 };
}

function oldestFirst(rows: ActivityRow[]): ActivityRow[] {
  const seen = new Set<string>();
  // eLead lists newest first; reverse before the stable sort so same-minute rows keep their real order.
  return [...rows]
    .reverse()
    .sort((a, b) => (a.at ?? '').localeCompare(b.at ?? ''))
    .filter((r) => {
      const k = [r.at, r.type, r.outcome, r.comment, r.completedBy, r.direction].join('|');
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

/** Plain-text summary of one customer for a small model. Unanswered calls collapse; customer words are kept first. */
export function customerTranscript(
  record: CustomerRecord,
  w: Writer,
  today = new Date(),
  canText = true,
  /** What you sent from Torque drafts (full wording; eLead shows only email subjects). */
  sent: SentMessage[] = [],
): string {
  const f = computeHistoryFacts(record, today);
  const o = record.opportunity;
  const ch = channelsFor(record, canText);
  const header = [
    `Customer first name: ${record.customer.firstName}`,
    `Salesperson: ${firstWord(w.name)} at ${w.dealership}`,
    `Today: ${today.toISOString().slice(0, 10)} (${today.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })})`,
    `Vehicle: ${o.vehicle ?? 'none recorded'} | Trade: ${o.trade ?? 'none'} | Source: ${o.leadSource ?? '?'} | Lead date: ${o.dateIn?.slice(0, 10) ?? '?'}${f.leadAgeDays !== null ? ` (${f.leadAgeDays} days ago)` : ''}`,
    `CRM status: ${o.salesStatus ?? '?'} | Can text: ${yes(ch.text)} | Can email: ${yes(ch.email)}`,
    `Facts: customer replied ${f.customerReplies} time(s)` +
      (f.lastCustomerReply?.at ? `; last reply ${f.lastCustomerReply.at.slice(0, 10)} (${f.daysSinceLastReply} days ago)` : '; never replied') +
      `; visited: ${yes(f.visitEvidence.length > 0)}; appointment: ${f.appointments > 0 ? (f.appointmentMissed ? 'set, then missed' : 'set') : 'none'}.`,
    record.crmAiSummary ? `Notes: ${clip(record.crmAiSummary.replace(/\s+/g, ' '), 700)}` : '',
  ].filter(Boolean);

  const lines: Array<{ text: string; customer: boolean }> = [];
  let run: { from: string; to: string; n: number } | null = null;
  const flush = () => {
    if (run) lines.push({ text: `${run.from}${run.to !== run.from ? `..${run.to}` : ''} US: ${run.n} call(s), no conversation`, customer: false });
    run = null;
  };
  for (const h of oldestFirst(record.history)) {
    const day = h.at?.slice(0, 10) ?? '?';
    if (h.channel === 'PHONE' && h.direction === 'OUTBOUND' && (!h.comment || /^\(?no answer\)?$/i.test(h.comment.trim()))) {
      if (run) {
        run.to = day;
        run.n++;
      } else run = { from: day, to: day, n: 1 };
      continue;
    }
    flush();
    const who = h.direction === 'INBOUND' ? 'CUSTOMER' : h.direction === 'OUTBOUND' ? 'US' : 'NOTE';
    const kind = h.channel === 'TEXT' ? 'text' : h.channel === 'EMAIL' ? 'email' : h.channel === 'PHONE' ? 'call' : h.type;
    let detail = h.comment || h.outcome || h.type;
    if (who === 'US') detail = detail.replace(COMPLIANCE_FOOTER, '');
    const limit = who === 'CUSTOMER' ? LINE_LIMIT_CUSTOMER : who === 'US' && (h.channel === 'TEXT' || h.channel === 'EMAIL') ? LINE_LIMIT_OURS : LINE_LIMIT_OTHER;
    const label = h.channel === 'EMAIL' && who === 'US' ? 'email, subject only' : kind;
    lines.push({ text: `${day} ${who} (${label}): ${clip(detail.replace(/\s+/g, ' '), limit)}`, customer: who === 'CUSTOMER' });
  }
  flush();

  // Keep the newest lines that fit, customer lines first.
  let budget = TRANSCRIPT_BUDGET;
  const keep = new Array(lines.length).fill(false);
  for (const customerPass of [true, false]) {
    for (let i = lines.length - 1; i >= 0; i--) {
      if (keep[i] || lines[i].customer !== customerPass || lines[i].text.length + 1 > budget) continue;
      keep[i] = true;
      budget -= lines[i].text.length + 1;
    }
  }
  const kept = lines.filter((_, i) => keep[i]).map((l) => l.text);
  const dropped = lines.length - kept.length;
  const sentLines = sent
    .slice(-3)
    .map((m) => `${m.at.slice(0, 10)} ${m.kind}${m.subject ? ` (subject: ${m.subject})` : ''}: ${clip(m.body.replace(/\s+/g, ' '), SENT_LIMIT)}`);
  return [
    ...header,
    '',
    `History (oldest first${dropped ? `; ${dropped} older line(s) omitted` : ''}):`,
    ...(kept.length ? kept : ['(no activity recorded)']),
    ...(sentLines.length ? ['', 'WHAT WE ALREADY SENT (full wording; do NOT repeat these or reword them):', ...sentLines] : []),
  ].join('\n');
}

export function parseDraft(raw: unknown): { ok: true; value: FollowUpDraft } | { ok: false; errors: string[] } {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const errors: string[] = [];
  const strOrNull = (k: string) => r[k] === null || r[k] === undefined || typeof r[k] === 'string' || (errors.push(`${k} must be text`), false);
  if (typeof r.skip !== 'boolean') errors.push('skip must be true or false');
  ['skipReason', 'text', 'emailSubject', 'emailBody'].forEach(strOrNull);
  if (typeof r.why !== 'string') errors.push('why is required');
  if (errors.length) return { ok: false, errors };
  const t = (k: string) => ((r[k] as string | null | undefined)?.trim() || null);
  return {
    ok: true,
    value: { skip: r.skip as boolean, skipReason: t('skipReason'), text: t('text'), emailSubject: t('emailSubject'), emailBody: t('emailBody'), why: (r.why as string).trim() },
  };
}

const BANNED = [
  /\binquiry\b/i,
  /\bprospect\b/i,
  /\bunits?\b/i,
  /vehicle of interest/i,
  /\bregarding\b/i,
  /pertaining to/i,
  /per our (conversation|discussion)/i,
  /please advise/i,
  /checking in/i,
  /reach(ing)? out/i,
  /(haven'?t|have not) heard (back )?from you/i,
  /never (responded|replied|got back)/i,
  /still in the market/i,
  /earn your business/i,
  /what will it take/i,
  /let me know if you need anything/i,
  /huge selection/i,
  /great deals?\b/i,
  /unbeatable/i,
  /\bact now\b/i,
  /\bhurry\b/i,
  /\bI just wanted\b/i,
  /\bhopefully\b/i,
  /\bobviously\b/i,
  /\bunfortunately\b/i,
  /won'?t last/i,
  /(a )?lot of interest/i,
  /(selling|going|moving) fast/i,
  /before (it'?s|someone)/i,
  /are you still interested/i,
  /just (checking in|following up)/i,
  /great choice/i,
  /I'?d love to help/i,
  /hope (this|you)[^.]*find/i,
  /touch(ing)? base/i,
  /circl(e|ing) back/i,
  /don'?t hesitate/i,
  /vehicle needs/i,
  /valued customer/i,
  /dream (car|truck|vehicle)/i,
  /at your earliest convenience/i,
];
/** Prices, payments and rates: "$299/mo", "$1,500", "2.9%", "APR", "400 a month". */
const MONEY = /\$\s?\d[\d,]*(\.\d+)?k?|\b\d+(\.\d+)?\s?%|\bAPR\b|\b\d{2,5}\s?(\/|a |per )\s?(mo|month)\b/gi;
/** Is this amount in the customer's history? Compares the number itself ("$1,500" ~ "1500"). */
const inHistory = (m: string, transcript: string) => {
  const digits = m.replace(/[^\d.]/g, '').replace(/\.$/, '');
  return digits ? transcript.replace(/,/g, '').includes(digits) : transcript.toLowerCase().includes(m.toLowerCase());
};
const COUNTING = /\b(\d+|several|many|multiple|numerous|a few)\s+(times|calls|messages|texts|emails|attempts|voicemails)\b/i;
const EMOJI = /\p{Extended_Pictographic}/u;
const PLACEHOLDER = /\[[^\]]*\]|\{[^}]*\}|<[^>]*>/;

/** Rule check. Errors trigger one retry; anything left is shown to the salesperson as a warning. */
export function checkDraft(d: FollowUpDraft, channels: DraftChannels, transcript: string, record: CustomerRecord): string[] {
  if (d.skip) return d.skipReason ? [] : ['skip=true needs a skipReason'];
  const errors: string[] = [];
  if (channels.text && !d.text) errors.push('text is missing');
  if (channels.email && (!d.emailSubject || !d.emailBody)) errors.push('emailSubject and emailBody are required');
  const lastName = record.customer.fullName.includes(',')
    ? record.customer.fullName.split(',')[0].trim()
    : record.customer.fullName.trim().split(/\s+/).slice(1).pop() ?? '';
  for (const [label, s] of [
    ['text', d.text],
    ['email', [d.emailSubject, d.emailBody].filter(Boolean).join('\n')],
  ] as const) {
    if (!s) continue;
    if (BANNED.some((re) => re.test(s))) errors.push(`${label} uses a phrase that sounds automated`);
    for (const m of s.match(MONEY) ?? []) if (!inHistory(m.trim(), transcript)) errors.push(`${label} mentions "${m.trim()}", which is not in the history (never invent prices or rates)`);
    if (COUNTING.test(s)) errors.push(`${label} mentions how many times we reached out`);
    if (EMOJI.test(s)) errors.push(`${label} has an emoji`);
    if (PLACEHOLDER.test(s)) errors.push(`${label} has a placeholder in brackets`);
    if (lastName.length > 1 && new RegExp(`\\b${lastName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(s)) errors.push(`${label} uses the customer's last name`);
    if ((s.match(/!/g) ?? []).length > 1) errors.push(`${label} has more than one "!"`);
  }
  if (d.text && d.text.length > 320) errors.push('text is too long (keep it under 240 characters)');
  if (d.emailSubject && d.emailSubject.split(/\s+/).length > 9) errors.push('emailSubject is too long');
  return [...new Set(errors)];
}

const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter(Boolean);
const trigrams = (s: string) => {
  const w = words(s);
  return new Set(w.slice(0, -2).map((_, i) => w.slice(i, i + 3).join(' ')));
};
/** Share of the draft's 3-word phrases that already appeared in an earlier message. */
export function overlap(draft: string, previous: string): number {
  const d = trigrams(draft);
  if (d.size === 0) return 0;
  const p = trigrams(previous);
  let hit = 0;
  for (const t of d) if (p.has(t)) hit++;
  return hit / d.size;
}

/** What we already sent this customer: our texts/emails in eLead (emails: subject only) plus your Torque sends. */
export function previousMessages(record: CustomerRecord, sent: SentMessage[] = []): string[] {
  const fromElead = record.history
    .filter((h) => h.direction === 'OUTBOUND' && (h.channel === 'TEXT' || h.channel === 'EMAIL') && h.comment)
    .map((h) => h.comment!.replace(COMPLIANCE_FOOTER, ''));
  return [...fromElead, ...sent.flatMap((m) => [m.body, m.subject ?? ''])].filter((t) => t.trim().length > 0);
}

/** The draft must not repeat (or lightly reword) something we already sent. */
export function repeatProblems(d: FollowUpDraft, previous: string[]): string[] {
  if (d.skip) return [];
  const errors: string[] = [];
  // First six words, after a leading "Name," if there is one.
  const opening = (s: string) => words(/^[^,\n]{1,25},/.test(s) ? s.slice(s.indexOf(',') + 1) : s).slice(0, 6).join(' ');
  for (const [label, s] of [
    ['text', d.text],
    ['email', d.emailBody],
  ] as const) {
    if (!s) continue;
    if (previous.some((p) => overlap(s, p) >= 0.4)) errors.push(`${label} repeats a message we already sent; take a different angle`);
    else if (words(s).length > 8 && previous.some((p) => words(p).length > 8 && opening(p) === opening(s))) errors.push(`${label} opens the same way as a message we already sent`);
  }
  const subj = d.emailSubject ? words(d.emailSubject).join(' ') : '';
  if (subj && previous.some((p) => words(p).join(' ') === subj)) errors.push('emailSubject was already used; write a new one');
  return errors;
}

/** Remove any sign-off the model added anyway. No signature is added: eLead appends yours when you send. */
export function finishEmailBody(body: string, w: Writer): string {
  const sigWords = [w.name, firstWord(w.name), w.dealership, w.phone].map((s) => s.trim().toLowerCase()).filter(Boolean);
  const lines = body.replace(/\r/g, '').trimEnd().split('\n');
  while (lines.length) {
    const last = lines[lines.length - 1].trim().toLowerCase().replace(/[,.]$/, '');
    if (!last || sigWords.includes(last) || /^(thanks|thank you|best|regards|best regards|sincerely|talk soon|cheers)$/.test(last)) lines.pop();
    else break;
  }
  return lines.join('\n').trimEnd();
}

export interface DraftResult {
  draft: FollowUpDraft;
  warnings: string[];
  attempts: number;
  /** What went into the request and how it was fitted (for the "Context details" panel). */
  context?: ContextDebug;
}

export interface ContextDebug {
  budget: BudgetReport;
  stats: ContextStats;
}

/** The free model on this computer is slow with long input: give it less. */
const LOCAL_BUDGET = 7000;

/**
 * Ask the model (injected, so this is testable), check the rules, retry ONCE
 * with the problems listed, then return what we have plus any remaining warnings.
 *
 * The request is assembled by priority (customerContext + contextBudget): your
 * profile and the customer's current state, latest message and recent
 * conversation always go; noise, extras and older detail are shrunk first.
 */
export async function draftFollowUp(
  record: CustomerRecord,
  w: Writer,
  complete: (messages: ChatMessage[]) => Promise<unknown>,
  today = new Date(),
  /** false when the customer has no usable phone number: email draft only. */
  canText = true,
  /** 'local' = the small free model: shorter instructions. */
  engine: DraftEngine = 'claude',
  /** Your profile + unlearned edits + what worked (LearningParts), or plain text. Not used by the small local model. */
  style: string | LearningParts = '',
  /** What you already sent from Torque to this customer. */
  sent: SentMessage[] = [],
  /** Custom lists: what kind of list this is (listContext), first. Real offer details in it may be used. */
  listInfo = '',
  /** Custom list type (for the message mode) and an explicit final check-in. */
  extra: { listType?: ListType | null; finalCheckin?: boolean } = {},
): Promise<DraftResult> {
  const channels = channelsFor(record, canText);
  const ctx = buildCustomerContext(record, { writer: w, today, canText, sent, listInfo, listType: extra.listType, finalCheckin: extra.finalCheckin });
  const previous = previousMessages(record, sent);
  const system = systemPrompt(w, engine);
  const sections = [...(engine === 'claude' ? learningSections(asLearningParts(style)) : []), ...ctx.sections];
  const first = fitContextToBudget(sections, system.length, engine === 'claude' ? FIRST_TRY_BUDGET : LOCAL_BUDGET, SHRINK_ORDER);
  let report = first.report;
  const messages: ChatMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: first.text },
  ];
  let attempts = 0;
  for (;;) {
    attempts++;
    const raw = await complete(messages);
    const parsed = parseDraft(raw);
    const problems = parsed.ok ? [...checkDraft(parsed.value, channels, ctx.evidence, record), ...repeatProblems(parsed.value, previous)] : parsed.errors;
    // The retry repeats the request plus the answer and the problems: refit so it still fits the dialer.
    const retry = problems.length > 0 && attempts < 2 ? refit(sections, system.length, JSON.stringify(raw), problems) : null;
    if (!retry) {
      if (!parsed.ok) throw new Error(`The AI's answer was unusable: ${parsed.errors.join('; ')}`);
      const d = parsed.value;
      const draft: FollowUpDraft = {
        ...d,
        text: d.skip || !channels.text ? null : d.text,
        emailSubject: d.skip || !channels.email ? null : d.emailSubject,
        emailBody: d.skip || !channels.email || !d.emailBody ? null : finishEmailBody(d.emailBody, w),
      };
      return { draft, warnings: problems, attempts, context: { budget: report, stats: ctx.stats } };
    }
    messages[1] = { role: 'user', content: retry.text };
    messages.push({ role: 'assistant', content: JSON.stringify(raw) }, { role: 'user', content: retryNote(problems) });
    report = retry.report;
  }
}

const retryNote = (problems: string[]) => `Your answer had these problems. Fix them and answer again with the full JSON:\n- ${problems.join('\n- ')}`;

/** The retry's context, shrunk as needed to fit with the answer and problems added. Null if even that can't fit (then the first answer is kept). */
function refit(sections: ContextSection[], systemChars: number, answer: string, problems: string[]) {
  try {
    return fitContextToBudget(sections, systemChars + answer.length + retryNote(problems).length, HARD_BUDGET, SHRINK_ORDER);
  } catch (e) {
    if (e instanceof ContextBudgetError) return null;
    throw e;
  }
}
