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

/**
 * KENECT: past buyers. Light touches, not a sales push: one short thank-you
 * text (thanks for doing business with us, still enjoying the unit?), one
 * friendly nudge a month later, then a check-in every 3 months.
 * Their reply stops the scheduled texts (see sequence.ts).
 */
export const KENECT_PREFIX = 'Kenect:';
export const KENECT_STEPS: { days: number; title: string; repeat?: 'quarterly' }[] = [
  { days: 0, title: 'Kenect: thank-you text: thanks for doing business with us, still enjoying the unit?' },
  { days: 30, title: 'Kenect: friendly check-in text, no pitch' },
  { days: 120, title: 'Kenect: check-in text (every 3 months)', repeat: 'quarterly' },
];
export const isKenectTask = (t: Task) => t.title.startsWith(KENECT_PREFIX);

/** The Kenect text schedule starting on `start` (the first text that day at 9 AM). */
export function kenectTasks(start: Date): Task[] {
  return KENECT_STEPS.map((s) => task({ kind: 'text', dueAt: addDays(start, s.days).toISOString(), title: s.title, ...(s.repeat ? { repeat: s.repeat } : {}) }));
}

/**
 * First-text days for `n` imported customers, `perDay` a work day so it stays light.
 * Work days are Tuesday through Saturday (the store is closed Sunday and Monday).
 * Starts with the next work day after `from`.
 */
export function spreadStarts(n: number, perDay: number, from = new Date(), workDays = [2, 3, 4, 5, 6]): Date[] {
  const out: Date[] = [];
  const per = Math.max(1, Math.floor(perDay));
  const d = at9(from);
  while (out.length < n) {
    d.setDate(d.getDate() + 1);
    if (!workDays.includes(d.getDay())) continue;
    for (let i = 0; i < per && out.length < n; i++) out.push(new Date(d));
  }
  return out;
}

/** "HALEY RYE" or "haley" → "Haley": names from Kenect often come in all caps. Mixed case (McDonald) is left alone. */
export function properName(n: string): string {
  const t = n.trim();
  if (!t || (t !== t.toUpperCase() && t !== t.toLowerCase())) return t;
  return t.toLowerCase().replace(/(^|[\s'-])([a-z])/g, (_, p: string, ch: string) => p + ch.toUpperCase());
}
