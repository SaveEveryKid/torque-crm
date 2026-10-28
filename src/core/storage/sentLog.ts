import { kv } from './kv';
/**
 * WHAT YOU SENT FROM TORQUE DRAFTS (LOCAL ONLY, this browser). eLead's history
 * shows only an email's subject (not the body), and Torque may not have
 * re-read a customer since you sent something, so the AI is told exactly what
 * you already sent: it must not repeat it.
 */
const KEY = 'sentMessages';
const PER_CUSTOMER = 10;
const KEEP_DAYS = 90;

export interface SentMessage {
  at: string;
  kind: 'text' | 'email';
  subject?: string | null;
  body: string;
  /** Where it came from: a follow-up draft (default) or the Reply helper. */
  source?: 'followup' | 'reply';
}

type SentMap = Record<string, SentMessage[]>;

export async function getSentMap(): Promise<SentMap> {
  const { [KEY]: m = {} } = (await kv.get(KEY)) as { [KEY]?: SentMap };
  return m;
}

export async function getSent(opportunityId: string): Promise<SentMessage[]> {
  return (await getSentMap())[opportunityId] ?? [];
}

export async function recordSent(opportunityId: string, msg: SentMessage, now = new Date()): Promise<void> {
  if (!msg.body.trim()) return;
  const m = await getSentMap();
  const cutoff = now.getTime() - KEEP_DAYS * 86_400_000;
  m[opportunityId] = [...(m[opportunityId] ?? []), msg].filter((s) => new Date(s.at).getTime() >= cutoff).slice(-PER_CUSTOMER);
  await kv.set({ [KEY]: m });
}
