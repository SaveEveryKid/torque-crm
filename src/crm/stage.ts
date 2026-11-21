import type { Activity, Customer, Stage } from './types';

/**
 * WHERE A CUSTOMER IS, FROM WHAT HAS HAPPENED.
 * New lead -> Attempted (you reached out) -> Contacted (they answered)
 * -> Hot (they've engaged more than once, set an appointment or came in).
 * Stages only move forward on their own; Working deal, Long-term follow-up, Sold, Sold follow-up and Lost are yours to set.
 */
const RANK: Record<Stage, number> = { new: 0, attempted: 1, contacted: 2, hot: 3, working: 4, longterm: 4, sold: 5, soldfollow: 5, lost: 5 };

const AUTO_REPLY = /^(subject:\s*)?(automatic reply|auto-?reply|out of (the )?office|undeliverable|delivery (has )?failed)/i;

/** They engaged: wrote, texted, called in, answered a call, set or kept an appointment, came in. */
export function isEngagement(a: Activity): boolean {
  if (a.direction === 'INBOUND') return a.channel !== 'NOTE' && !AUTO_REPLY.test(a.text ?? '') && !AUTO_REPLY.test(a.outcome ?? '');
  if (a.channel === 'PHONE' && a.direction === 'OUTBOUND') return /^connected/i.test(a.outcome ?? '');
  if (a.channel === 'APPOINTMENT' && a.direction === 'OUTBOUND') return /appointment set/i.test(a.outcome ?? '');
  return false;
}

const isHotSignal = (a: Activity) => a.channel === 'APPOINTMENT' && a.direction !== 'INTERNAL';
const reachedOut = (a: Activity) => a.direction === 'OUTBOUND';

/** The stage the history calls for (never past Hot). */
export function stageFromHistory(activities: Activity[]): Stage {
  const engaged = activities.filter(isEngagement).length;
  if (engaged >= 2 || activities.some(isHotSignal)) return 'hot';
  if (engaged === 1) return 'contacted';
  if (activities.some(reachedOut)) return 'attempted';
  return 'new';
}

/** After a new activity: the stage to move to, or null to stay put (only ever forward). */
export function autoStage(c: Pick<Customer, 'stage' | 'activities'>, entry: Activity): Stage | null {
  if (RANK[c.stage] >= RANK.working) return null;
  const next = stageFromHistory([entry, ...c.activities]);
  return RANK[next] > RANK[c.stage] ? next : null;
}

/** Move forward to at least `stage` (for an appointment set or a visit); null if already there or past it. */
export function atLeast(current: Stage, stage: Stage): Stage | null {
  return RANK[current] < RANK[stage] && RANK[current] < RANK.working ? stage : null;
}
