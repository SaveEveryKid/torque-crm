import type { ListType } from '../core/analysis/customList';
import type { Activity, Customer, Stage, Task } from './types';

/**
 * FOLLOW-UP EMAILS, SCHEDULED: the first email you send a customer starts
 * three follow-up email tasks (#2 a short bump, #3 a new angle, #4 a
 * closing note). They show on Today when due, and Pre-draft writes them.
 * Making contact stops the rest: a reply, a call where you talked, an
 * appointment, a stage past Contacted, do-not-contact, or Stop on the
 * customer. A reply also adds "Reply to them", due now.
 */
export const STEPS: { step: 2 | 3 | 4; days: number; type: ListType; title: string }[] = [
  { step: 2, days: 4, type: 'bump', title: 'Follow-up email #2: short bump' },
  { step: 3, days: 10, type: 'new_angle', title: 'Follow-up email #3: new angle' },
  { step: 4, days: 21, type: 'breakup', title: 'Follow-up email #4: closing note' },
];

/** Stages that mean you've made contact (the automatic follow-ups stop). */
const CONTACT_STAGES: Stage[] = ['appointment', 'showed', 'working', 'sold', 'lost'];

/** n business days after `from`, at 9 AM. */
export function addBusinessDays(from: Date, n: number): Date {
  const d = new Date(from);
  let left = n;
  while (left > 0) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) left--;
  }
  d.setHours(9, 0, 0, 0);
  return d;
}

const id = () => crypto.randomUUID();
const open = (c: Customer) => c.tasks.filter((t) => !t.done);
export const running = (c: Customer) => !!c.sequence && !c.sequence.stoppedAt && open(c).some((t) => t.seq);

/** The scheduled follow-up that's due (today or overdue), if any. */
export function dueStep(c: Customer, now = new Date()): (Task & { seq: 2 | 3 | 4 }) | null {
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  const t = open(c)
    .filter((x) => x.seq && new Date(x.dueAt) <= end)
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt))[0];
  return (t as Task & { seq: 2 | 3 | 4 }) ?? null;
}
export const stepType = (seq: 2 | 3 | 4): ListType => STEPS.find((s) => s.step === seq)!.type;

/** Stop the automatic follow-ups (their open tasks go away). */
export function stopSequence(c: Customer, reason: string, at = new Date().toISOString()): Partial<Customer> {
  if (!running(c)) return {};
  return { tasks: c.tasks.filter((t) => t.done || !t.seq), sequence: { ...c.sequence!, stoppedAt: at, reason } };
}

const madeContact = (a: Activity) =>
  a.direction === 'INBOUND' || a.channel === 'APPOINTMENT' || (a.channel === 'PHONE' && a.direction === 'OUTBOUND' && /talked/i.test(a.outcome ?? ''));

/** What a new timeline entry changes: start, advance or stop the follow-ups, and "reply to them". */
export function afterActivity(c: Customer, a: Activity): Partial<Customer> {
  if (a.direction === 'INTERNAL') return {};
  // You got back to them (email, text, or a call where you talked): the "reply" task is done.
  const answered = a.direction === 'OUTBOUND' && (a.channel === 'EMAIL' || a.channel === 'TEXT' || madeContact(a));
  let tasks = answered && c.tasks.some((t) => !t.done && t.reply) ? c.tasks.map((t) => (!t.done && t.reply ? { ...t, done: true, doneAt: a.at } : t)) : c.tasks;

  if (madeContact(a)) {
    const stop = stopSequence({ ...c, tasks }, a.direction === 'INBOUND' ? 'They replied' : a.channel === 'APPOINTMENT' ? 'Visit' : 'You talked', a.at);
    tasks = stop.tasks ?? tasks;
    const wrote = a.direction === 'INBOUND' && (a.channel === 'EMAIL' || a.channel === 'TEXT');
    if (wrote && !tasks.some((t) => !t.done && t.reply))
      tasks = [...tasks, { id: id(), kind: a.channel === 'TEXT' ? 'text' : 'email', dueAt: a.at, title: `Reply to their ${a.channel === 'TEXT' ? 'text' : 'email'}`, done: false, reply: true }];
    return tasks === c.tasks ? stop : { ...stop, tasks };
  }
  if (a.channel !== 'EMAIL' || a.direction !== 'OUTBOUND') return tasks === c.tasks ? {} : { tasks };
  const at = new Date(a.at);
  const emailedBefore = c.activities.some((x) => x.id !== a.id && x.channel === 'EMAIL' && x.direction === 'OUTBOUND');
  const heardFrom = c.activities.some((x) => x.id !== a.id && madeContact(x));
  if (!c.sequence && !emailedBefore && !heardFrom && !c.doNotContact && !CONTACT_STAGES.includes(c.stage)) {
    // The first email: schedule #2, #3 and #4.
    tasks = [...tasks, ...STEPS.map((s): Task => ({ id: id(), kind: 'email', dueAt: addBusinessDays(at, s.days).toISOString(), title: s.title, done: false, seq: s.step }))];
    return { tasks, sequence: { startedAt: a.at } };
  }
  if (running(c)) {
    // A follow-up went out: check off the scheduled one it was for (due by about now).
    const soon = new Date(at.getTime() + 2 * 86_400_000).toISOString();
    const next = tasks.filter((t) => !t.done && t.seq && t.dueAt <= soon).sort((x, y) => x.dueAt.localeCompare(y.dueAt))[0];
    if (next) tasks = tasks.map((t) => (t.id === next.id ? { ...t, done: true, doneAt: a.at } : t));
  }
  return tasks === c.tasks ? {} : { tasks };
}

/** Any change that means you've made contact (stage, do not contact) stops the follow-ups. */
export function autoStop(c: Customer): Partial<Customer> {
  if (!running(c)) return {};
  if (c.doNotContact) return stopSequence(c, 'Do not contact');
  if (CONTACT_STAGES.includes(c.stage)) return stopSequence(c, `Moved to ${c.stage}`);
  return {};
}
