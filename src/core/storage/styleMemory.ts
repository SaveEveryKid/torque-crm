import { kv } from './kv';
import { SITUATION_LABEL, type Situation } from '../analysis/situation';

/**
 * HOW YOU WRITE AND THINK (LOCAL ONLY, this browser). Every draft you send is
 * kept here with what the AI wrote: changed ones show your voice, and the reason
 * you tap shows your thinking; unchanged ones mean "this was right". Claude is
 * shown the most relevant ones each time, plus your profile (styleProfile.ts).
 * Skipped drafts are never recorded: a skip just means "not today".
 */
const KEY = 'styleExamples';
const MAX = 300;

export type StyleKind = 'text' | 'email' | 'reply' | 'appointment';

/** One-tap reasons for changing a draft. */
export const EDIT_REASONS = ['Too pushy', 'Too long', 'Misread the customer', "Not how I talk", 'Missed what they said', 'Wrong next step', 'Too stiff / formal'] as const;

export interface StyleExample {
  id?: string;
  at: string;
  kind: StyleKind;
  /** What the AI wrote. */
  ai: string;
  /** What you sent (same as ai when approved). */
  sent: string;
  /** True when you sent it without changing a word. */
  approved?: boolean;
  situation?: Situation;
  /** Why you changed it (tapped after DONE / COPY). */
  reasons?: string[];
  note?: string;
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

/** Other customers' details never go into a prompt: their name becomes "Alex"; phone numbers and email addresses are removed. */
export function anonymize(s: string, firstName: string): string {
  let out = s.replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '(email)').replace(/(\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g, '(phone)');
  const name = firstName.trim();
  if (name.length > 1) out = out.replace(new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), 'Alex');
  return out.trim();
}

export async function getStyleExamples(): Promise<StyleExample[]> {
  const { [KEY]: list = [] } = (await kv.get(KEY)) as { [KEY]?: StyleExample[] };
  return list;
}

/**
 * Keep a send: edited (your voice) or approved as-is ("this was right").
 * Returns the saved example's id when you changed the wording (so a reason can be added), otherwise null.
 */
export async function recordEdit(
  kind: StyleKind,
  ai: string | null | undefined,
  sent: string | null | undefined,
  firstName: string,
  now = new Date(),
  situation?: Situation,
): Promise<string | null> {
  if (!ai?.trim() || !sent?.trim()) return null;
  const approved = norm(ai) === norm(sent);
  const id = crypto.randomUUID();
  const list = await getStyleExamples();
  list.push({ id, at: now.toISOString(), kind, ai: anonymize(ai, firstName), sent: anonymize(sent, firstName), ...(approved ? { approved: true } : {}), ...(situation ? { situation } : {}) });
  await kv.set({ [KEY]: list.slice(-MAX) });
  return approved ? null : id;
}

/** Add why you changed a draft. */
export async function setReasons(ids: string[], reasons: string[], note: string): Promise<void> {
  if (!ids.length || (!reasons.length && !note.trim())) return;
  const list = await getStyleExamples();
  await kv.set({
    [KEY]: list.map((e) => (e.id && ids.includes(e.id) ? { ...e, reasons, ...(note.trim() ? { note: note.trim().slice(0, 200) } : {}) } : e)),
  });
}

export async function clearStyleExamples(): Promise<void> {
  await kv.remove(KEY);
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const flat = (s: string) => s.replace(/\s+/g, ' ');

/**
 * The examples most useful for this draft: your edits in the same situation
 * first (with your reasons), then your newest edits, one approved-as-is
 * message in the same situation, and (for emails) your newest email edit.
 */
export function pickExamples(
  examples: StyleExample[],
  situation: Situation | null,
  kind: 'short' | 'all' = 'all',
  maxShort = 4,
  /** Only edits made after this time (edits already learned into your profile are left out). */
  since: string | null = null,
  /** Include a "sent as written" example (only useful before a profile exists). */
  includeApproved = true,
): StyleExample[] {
  const fresh = since ? examples.filter((e) => e.at > since) : examples;
  const edits = fresh.filter((e) => !e.approved);
  const short = edits.filter((e) => e.kind !== 'email');
  const newest = (l: StyleExample[]) => [...l].reverse();
  const same = situation ? newest(short.filter((e) => e.situation === situation)) : [];
  // Edits you explained teach the most: prefer them within each group.
  const explainedFirst = (l: StyleExample[]) => [...l.filter((e) => e.reasons?.length || e.note), ...l.filter((e) => !e.reasons?.length && !e.note)];
  const picked: StyleExample[] = [];
  for (const e of [...explainedFirst(same).slice(0, 3), ...explainedFirst(newest(short))]) {
    if (picked.length >= maxShort) break;
    if (!picked.includes(e)) picked.push(e);
  }
  const approved = includeApproved && situation ? newest(fresh.filter((e) => e.approved && e.kind !== 'email' && e.situation === situation))[0] : undefined;
  const email = kind === 'all' ? newest(edits.filter((e) => e.kind === 'email'))[0] : undefined;
  return [...picked, ...(approved ? [approved] : []), ...(email ? [email] : [])];
}

/** The examples, written for the prompt. */
export function styleBlock(
  examples: StyleExample[],
  me: string,
  kind: 'short' | 'all' = 'all',
  situation: Situation | null = null,
  maxShort = 4,
  since: string | null = null,
  includeApproved = true,
): string {
  const pick = pickExamples(examples, situation, kind, maxShort, since, includeApproved);
  if (!pick.length) return '';
  const lines = pick.map((e) => {
    const where = e.situation ? ` [customer ${SITUATION_LABEL[e.situation]}]` : '';
    if (e.approved) return `${me} sent this as written${where}: ${clip(flat(e.sent), 320)}`;
    const why = [...(e.reasons ?? []), e.note ?? ''].filter(Boolean).join('; ');
    return `AI wrote${where}: ${clip(flat(e.ai), 320)}\n${me} sent: ${clip(flat(e.sent), 320)}${why ? `\nWhy he changed it: ${why}` : ''}`;
  });
  return `${since ? `RECENT EDITS NOT YET IN ${me.toUpperCase()}'S PROFILE` : `HOW ${me.toUpperCase()} EDITS AI DRAFTS`} (his real changes to other customers' messages; names changed). Match his voice and his reasoning. Never copy these lines.\n${lines.join('\n\n')}\n\n---\n\n`;
}

export interface WeekScore {
  /** Monday of the week (YYYY-MM-DD). */
  week: string;
  sent: number;
  asIs: number;
}

/** % of drafts sent without changing a word, week by week (newest last). */
export function asIsByWeek(examples: StyleExample[], weeks = 6, now = new Date()): WeekScore[] {
  const monday = (d: Date) => {
    const m = new Date(d);
    m.setHours(0, 0, 0, 0);
    m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
    return m;
  };
  const out: WeekScore[] = [];
  const start = monday(now);
  for (let i = weeks - 1; i >= 0; i--) {
    const from = new Date(start);
    from.setDate(from.getDate() - 7 * i);
    const to = new Date(from);
    to.setDate(to.getDate() + 7);
    const inWeek = examples.filter((e) => new Date(e.at) >= from && new Date(e.at) < to);
    out.push({ week: from.toLocaleDateString('en-CA'), sent: inWeek.length, asIs: inWeek.filter((e) => e.approved).length });
  }
  return out;
}
