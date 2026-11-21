import type { Customer, Stage, Task } from './types';

/**
 * FOLLOW-UP SCHEDULES THAT COME WITH A STAGE.
 * Long-term follow-up: one email on the 15th of every month, and nothing else.
 * Sold follow-up: thank them (2 days), check in and ask for a review (2 weeks),
 * ask for referrals (45 days), then a service check-in and referral ask every
 * 3 months for as long as they're a customer.
 * The repeating task schedules its next one when you check it off.
 */
const at9 = (d: Date) => {
  const x = new Date(d);
  x.setHours(9, 0, 0, 0);
  return x;
};
const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return at9(x);
};

/** The next 15th at 9 AM: this month's if it's still ahead, otherwise next month's. */
export function next15th(from: Date): Date {
  const x = at9(new Date(from.getFullYear(), from.getMonth(), 15));
  if (x.getTime() > from.getTime()) return x;
  return at9(new Date(from.getFullYear(), from.getMonth() + 1, 15));
}

export const MONTHLY_TITLE = 'Long-term follow-up: monthly check-in (the 15th)';
export const QUARTERLY_TITLE = 'Sold follow-up: service check-in and referral ask (every 3 months)';
const SOLD_STEPS: { days: number; title: string }[] = [
  { days: 2, title: "Sold follow-up: thank them and make sure everything's running right" },
  { days: 14, title: "Sold follow-up: how's the machine working? Ask for a review" },
  { days: 45, title: 'Sold follow-up: referral ask (who else could use one?)' },
];

const task = (t: Omit<Task, 'id' | 'done'>): Task => ({ ...t, id: crypto.randomUUID(), done: false });
/** Follow-ups that a stage's own schedule replaces: open emails, texts and calls, but not replies they're waiting on. */
const isFollowUp = (t: Task) => !t.done && !t.reply && ['email', 'text', 'call'].includes(t.kind);

/** Tasks after moving from `from` to `to`, or null if the move changes no tasks. */
export function tasksForStage(c: Pick<Customer, 'tasks'>, from: Stage, to: Stage, now = new Date()): Task[] | null {
  if (from === to) return null;
  const doneAt = now.toISOString();
  let tasks = c.tasks;
  // Leaving a schedule: its repeating task stops.
  if (from === 'longterm' || from === 'soldfollow') tasks = tasks.map((t) => (!t.done && t.repeat ? { ...t, done: true, doneAt } : t));
  if (to === 'longterm' || to === 'soldfollow') {
    // The stage's schedule is the only follow-up.
    tasks = tasks.map((t) => (isFollowUp(t) ? { ...t, done: true, doneAt } : t));
    if (to === 'longterm') tasks = [...tasks, task({ kind: 'email', dueAt: next15th(now).toISOString(), title: MONTHLY_TITLE, repeat: 'monthly15' })];
    else
      tasks = [
        ...tasks,
        ...SOLD_STEPS.map((s) => task({ kind: 'email', dueAt: addDays(now, s.days).toISOString(), title: s.title })),
        task({ kind: 'email', dueAt: addDays(now, 120).toISOString(), title: QUARTERLY_TITLE, repeat: 'quarterly' }),
      ];
  }
  return tasks === c.tasks ? null : tasks;
}

/** Checking off a repeating task: the next one in its schedule. */
export function nextRepeat(t: Task, now = new Date()): Task | null {
  if (!t.repeat) return null;
  const from = new Date(Math.max(now.getTime(), new Date(t.dueAt).getTime()));
  const dueAt = t.repeat === 'monthly15' ? next15th(from) : addDays(from, 91);
  return task({ kind: t.kind, dueAt: dueAt.toISOString(), title: t.title, repeat: t.repeat });
}
