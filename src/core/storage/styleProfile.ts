import { kv } from './kv';
/**
 * "HOW BYRON SELLS" PROFILE (LOCAL ONLY, this browser): Claude's summary of
 * your voice and thinking, built from all your edits. You can edit it. Updates
 * are proposed (pending) until you approve them.
 */
const KEY = 'styleProfile';

export interface StyleProfile {
  text: string;
  updatedAt: string | null;
  /** How many of your sends it was built from (to know when 10 more have come in). */
  basedOn: number;
  /**
   * Time of the newest edit already learned into this profile. Edits up to here
   * don't need to go into every draft any more (they're kept in storage).
   */
  learnedThrough?: string | null;
  /** A proposed update waiting for your OK. */
  pending: { text: string; summary: string; at: string; basedOn: number; learnedThrough?: string | null } | null;
}

export const EMPTY_PROFILE: StyleProfile = { text: '', updatedAt: null, basedOn: 0, pending: null };

export async function getProfile(): Promise<StyleProfile> {
  const { [KEY]: p } = (await kv.get(KEY)) as { [KEY]?: StyleProfile };
  return { ...EMPTY_PROFILE, ...p };
}

export async function saveProfile(p: StyleProfile): Promise<void> {
  await kv.set({ [KEY]: p });
}

/** Your own edits to the profile text. */
export async function editProfileText(text: string, now = new Date()): Promise<void> {
  const p = await getProfile();
  await saveProfile({ ...p, text: text.trim(), updatedAt: now.toISOString() });
}

export async function approvePending(now = new Date()): Promise<void> {
  const p = await getProfile();
  if (!p.pending) return;
  await saveProfile({ text: p.pending.text, updatedAt: now.toISOString(), basedOn: p.pending.basedOn, learnedThrough: p.pending.learnedThrough ?? now.toISOString(), pending: null });
}

/** Keep the current profile; the next update is proposed after 10 more sends. */
export async function rejectPending(): Promise<void> {
  const p = await getProfile();
  if (!p.pending) return;
  await saveProfile({ ...p, basedOn: p.pending.basedOn, pending: null });
}

/** Time to propose an update? (10 new edits since the last one, and none waiting.) */
export function profileDue(p: StyleProfile, editCount: number): boolean {
  return !p.pending && editCount >= 5 && editCount - p.basedOn >= 10;
}

/** For the prompt. */
export function profileBlock(p: StyleProfile, me: string): string {
  return p.text.trim() ? `HOW ${me.toUpperCase()} SELLS (his profile, built from his own edits; follow it closely):\n${p.text.trim()}\n\n---\n\n` : '';
}

/**
 * Edits newer than this aren't in the profile yet. A profile written before this
 * was tracked counts as covering everything up to when it was last saved.
 */
export function learnedCutoff(p: StyleProfile): string | null {
  if (!p.text.trim()) return null;
  return p.learnedThrough ?? p.updatedAt ?? null;
}
