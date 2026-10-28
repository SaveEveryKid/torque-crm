import { kv } from './kv';
import { isAppointment, isManualAppointment, type CallLogEntry } from '../dialer/dispositions';

/** Local call history (this browser only). NEVER written to eLead. */
const KEY = 'callLog';

export async function getCallLog(): Promise<CallLogEntry[]> {
  const { [KEY]: log = [] } = (await kv.get(KEY)) as { [KEY]?: CallLogEntry[] };
  return log;
}

export async function appendCall(entry: CallLogEntry): Promise<void> {
  const log = await getCallLog();
  log.push(entry);
  await kv.set({ [KEY]: log.slice(-5000) });
}

export async function updateCall(id: string, patch: Partial<CallLogEntry>): Promise<void> {
  const log = await getCallLog();
  await kv.set({ [KEY]: log.map((e) => (e.id === id ? { ...e, ...patch } : e)) });
}

export async function clearCallLog(): Promise<void> {
  await kv.remove(KEY);
}

/** The latest open callback per customer. */
export function openCallbacks(log: CallLogEntry[]): CallLogEntry[] {
  const latest = new Map<string, CallLogEntry>();
  for (const e of log) latest.set(e.opportunityId, e);
  return [...latest.values()].filter((e) => e.result === 'CALL_BACK_LATER' && e.callbackAt).sort((a, b) => a.callbackAt!.localeCompare(b.callbackAt!));
}

export interface SessionStats {
  attempted: number;
  humans: number;
  noAnswer: number;
  voicemail: number;
  busy: number;
  wrongNumber: number;
  appointments: number;
  /** Appointments you logged that came from a text or email follow-up. */
  appointmentsFromFollowUps: number;
  callbacks: number;
  avgTalkSeconds: number;
  /** Appointments you marked SHOWED / NO-SHOW. */
  showed: number;
  noShows: number;
  /** showed ÷ (showed + no-shows); null until you've marked one. */
  showRate: number | null;
  /** Appointments you moved with RESCHEDULED (each still counts once, by how it ends). */
  rescheduled: number;
  /** appointments ÷ conversations; null with no conversations. */
  setRate: number | null;
  /** set rate × show rate: the number that counts. */
  effectiveSetRate: number | null;
}

export function stats(entries: CallLogEntry[]): SessionStats {
  const calls = entries.filter((e) => e.result !== 'SKIP' && !isManualAppointment(e.result));
  const manual = entries.filter((e) => isManualAppointment(e.result));
  const talked = calls.filter((e) => e.talkSeconds > 0);
  const appts = entries.filter((e) => isAppointment(e.result));
  const showed = appts.filter((e) => e.apptResult === 'showed').length;
  const noShows = appts.filter((e) => e.apptResult === 'no_show').length;
  const showRate = showed + noShows ? showed / (showed + noShows) : null;
  const setRate = talked.length ? Math.min(1, appts.length / talked.length) : null;
  return {
    attempted: calls.length,
    humans: talked.length,
    noAnswer: calls.filter((e) => e.result === 'NO_ANSWER').length,
    voicemail: calls.filter((e) => e.result === 'VOICEMAIL').length,
    busy: calls.filter((e) => e.result === 'BUSY').length,
    wrongNumber: calls.filter((e) => e.result === 'WRONG_NUMBER').length,
    appointments: calls.filter((e) => e.result === 'CONNECTED_APPOINTMENT').length + manual.length,
    appointmentsFromFollowUps: manual.filter((e) => e.result === 'APPOINTMENT_FROM_TEXT' || e.result === 'APPOINTMENT_FROM_EMAIL').length,
    callbacks: calls.filter((e) => e.result === 'CALL_BACK_LATER').length,
    avgTalkSeconds: talked.length ? Math.round(talked.reduce((s, e) => s + e.talkSeconds, 0) / talked.length) : 0,
    showed,
    noShows,
    rescheduled: appts.filter((e) => (e.rescheduledFrom?.length ?? 0) > 0 || e.needsNewTime).length,
    showRate,
    setRate,
    effectiveSetRate: showRate !== null && setRate !== null ? setRate * showRate : null,
  };
}

/** Appointments worth acting on: the latest per customer, from 3 days ago to 2 weeks ahead (or logged in the last week with no time). */
export function activeAppointments(log: CallLogEntry[], now = new Date()): CallLogEntry[] {
  const latest = new Map<string, CallLogEntry>();
  for (const e of log) if (isAppointment(e.result)) latest.set(e.opportunityId, e);
  const t = now.getTime();
  const DAY = 86_400_000;
  return [...latest.values()]
    .filter((e) => {
      if (e.appointmentAt) {
        const a = new Date(e.appointmentAt).getTime();
        // No-shows and reschedules waiting for a time stay listed for 2 weeks.
        return a >= t - (e.apptResult === 'no_show' || e.needsNewTime ? 14 : 3) * DAY && a <= t + 14 * DAY;
      }
      return new Date(e.at).getTime() >= t - 7 * DAY;
    })
    .sort((a, b) => (a.appointmentAt ?? a.at).localeCompare(b.appointmentAt ?? b.at));
}

/**
 * RESCHEDULED: same appointment (counted once), any SHOWED / NO-SHOW mark cleared.
 * With a new time it moves there; without one it waits as "needs a new time".
 */
export async function rescheduleAppointment(id: string, newAt: string | null): Promise<void> {
  const log = await getCallLog();
  await kv.set({
    [KEY]: log.map((e) => {
      if (e.id !== id) return e;
      if (!newAt) return { ...e, apptResult: null, needsNewTime: true };
      return { ...e, rescheduledFrom: [...(e.rescheduledFrom ?? []), ...(e.appointmentAt ? [e.appointmentAt] : [])], appointmentAt: newAt, apptResult: null, needsNewTime: false };
    }),
  });
}

/** Earlier appointments for the same customer that you marked NO-SHOW (to fix into a reschedule). */
export function earlierNoShows(log: CallLogEntry[], latest: CallLogEntry): CallLogEntry[] {
  return log.filter((e) => e.id !== latest.id && e.opportunityId === latest.opportunityId && isAppointment(e.result) && e.apptResult === 'no_show' && e.at <= latest.at);
}

/**
 * "That no-show was really a reschedule": fold the earlier appointment into the
 * newer one (one appointment, moved), so it no longer counts as a no-show or a second appointment.
 */
export async function mergeAsReschedule(oldId: string, newId: string): Promise<void> {
  const log = await getCallLog();
  const old = log.find((e) => e.id === oldId);
  if (!old || !log.some((e) => e.id === newId)) return;
  await kv.set({
    [KEY]: log
      .filter((e) => e.id !== oldId)
      .map((e) =>
        e.id === newId
          ? { ...e, rescheduledFrom: [...(old.rescheduledFrom ?? []), ...(old.appointmentAt ? [old.appointmentAt] : [old.at]), ...(e.rescheduledFrom ?? [])] }
          : e,
      ),
  });
}
