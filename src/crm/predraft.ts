import { useEffect, useState } from 'react';
import type { ListType } from '../core/analysis/customList';
import { kv } from '../core/storage/kv';
import { draftFor } from './ai';
import { dueStep, stepType } from './sequence';
import { serial, useStored } from './store';
import type { Customer, Settings } from './types';

/**
 * PRE-DRAFT: Claude writes an email (and text) for every customer in a list,
 * in the background, saved to your account. Then you go down the list and
 * Approve (open it in Outlook), Edit then approve, or Deny. Every decision
 * teaches Claude (styleMemory).
 */
export interface PreDraft {
  at: string;
  /** The follow-up type it was written as ('' = regular follow-up). */
  type: ListType | '';
  subject: string;
  body: string;
  text: string;
  why: string;
  warnings: string[];
  status: 'ready' | 'skipped' | 'error' | 'sent' | 'denied';
  /** Why Claude skipped it, or what went wrong. */
  note?: string;
}
export type Drafts = Record<string, PreDraft>;

const KEY = 'drafts';
export async function getDrafts(): Promise<Drafts> {
  return ((await kv.get(KEY))[KEY] as Drafts | undefined) ?? {};
}
export const useDrafts = () => useStored([KEY], getDrafts, {} as Drafts);

function saveDraft(id: string, d: PreDraft | null): Promise<void> {
  return serial(async () => {
    const m = await getDrafts();
    if (d) m[id] = d;
    else delete m[id];
    await kv.set({ [KEY]: m });
  });
}
/** Drop the drafts of deleted customers. */
export const removeDrafts = (ids: string[]) =>
  serial(async () => {
    const m = await getDrafts();
    if (!ids.some((id) => m[id])) return;
    for (const id of ids) delete m[id];
    await kv.set({ [KEY]: m });
  });

export const setDraftStatus = (id: string, status: PreDraft['status']) =>
  serial(async () => {
    const m = await getDrafts();
    if (m[id]) await kv.set({ [KEY]: { ...m, [id]: { ...m[id], status } } });
  });

/** Has anything ever been said between us (a text, call, email or visit)? */
export const talkedTo = (c: Customer) => c.activities.some((a) => a.direction !== 'INTERNAL');
/** The follow-up type that fits right now: the scheduled email that's due, else a cold opener if we've never talked. */
export function suggestedType(c: Customer, now = new Date()): ListType | '' {
  const due = dueStep(c, now);
  if (due) return stepType(due.seq);
  return talkedTo(c) ? '' : 'cold_opener';
}
/** "Auto": the scheduled follow-up that's due, a cold opener for anyone never contacted, a follow-up from the history for the rest. */
export const typeFor = (c: Customer, mode: ListType | '' | 'auto'): ListType | '' => (mode === 'auto' ? suggestedType(c) : mode);

/**
 * Who gets a draft: has an email, may be contacted, and has nothing waiting
 * (unless redoing). Someone whose last draft was sent or denied gets a new
 * one when their next scheduled follow-up comes due.
 */
export function targets(list: Customer[], drafts: Drafts, redo: boolean, now = new Date()): Customer[] {
  return list.filter((c) => {
    if (!c.email.trim() || c.doNotContact) return false;
    const d = drafts[c.id];
    if (redo || !d || d.status === 'error') return true;
    const due = dueStep(c, now);
    // A different email is due now than the last draft was (e.g. the cold opener went out, #2 is due).
    return (d.status === 'sent' || d.status === 'denied') && !!due && d.type !== stepType(due.seq);
  });
}

export interface RunState {
  running: boolean;
  stopping: boolean;
  done: number;
  total: number;
  errors: number;
  current: string[];
  message: string | null;
}
let state: RunState = { running: false, stopping: false, done: 0, total: 0, errors: 0, current: [], message: null };
const listeners = new Set<(s: RunState) => void>();
const emit = (patch: Partial<RunState>) => {
  state = { ...state, ...patch };
  for (const l of listeners) l(state);
};

/** Live progress of the pre-draft run (it keeps going while you use other pages). */
export function useRun(): RunState {
  const [s, setS] = useState(state);
  useEffect(() => {
    listeners.add(setS);
    return () => void listeners.delete(setS);
  }, []);
  return s;
}

export const stopRun = () => state.running && emit({ stopping: true });

const PARALLEL = 2;

export async function startRun(list: Customer[], settings: Settings, mode: ListType | '' | 'auto', note = ''): Promise<void> {
  if (state.running) return;
  const queue = [...list];
  emit({ running: true, stopping: false, done: 0, total: queue.length, errors: 0, current: [], message: null });
  const one = async (c: Customer) => {
    const type = typeFor(c, mode);
    emit({ current: [...state.current, c.id] });
    let last: Error | null = null;
    for (let attempt = 0; attempt < 2 && !state.stopping; attempt++) {
      try {
        const r = await draftFor(c, settings, { listType: type || null, note });
        // Still offering a demo after Claude's own retry: try again rather than queue it for review.
        if (r.warnings.some((w) => /bring a unit out/.test(w))) throw new Error('Claude kept offering a demo instead of a quote.');
        const d = r.draft;
        await saveDraft(c.id, {
          at: new Date().toISOString(),
          type,
          subject: d.emailSubject ?? '',
          body: d.emailBody ?? '',
          text: d.text ?? '',
          why: d.why,
          warnings: r.warnings,
          status: d.skip || !d.emailBody ? 'skipped' : 'ready',
          ...(d.skip ? { note: d.skipReason ?? '' } : {}),
        });
        last = null;
        break;
      } catch (e) {
        last = e as Error;
        // Not set up: no point trying the rest.
        if (/dialer|DIALER|log in|401|403/.test(last.message)) {
          emit({ stopping: true, message: last.message });
          break;
        }
        await new Promise((r) => setTimeout(r, 4000));
      }
    }
    if (last) {
      await saveDraft(c.id, { at: new Date().toISOString(), type, subject: '', body: '', text: '', why: '', warnings: [], status: 'error', note: last.message });
      emit({ errors: state.errors + 1 });
    }
    emit({ done: state.done + 1, current: state.current.filter((x) => x !== c.id) });
  };
  const worker = async () => {
    while (queue.length && !state.stopping) await one(queue.shift()!);
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));
  emit({ running: false, stopping: false, current: [] });
}
