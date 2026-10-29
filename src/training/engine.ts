/**
 * PRODUCT BOOTCAMP: learn every product the store sells, a little every day.
 *
 * Spaced repetition (Leitner boxes): a fact you get right comes back later
 * (1, 2, 4, 7, 14, 30, 60 days); a miss comes back tomorrow and again later
 * in the same session. New facts start as multiple choice; once you've got
 * one right twice you have to type it from memory. Numbers sometimes come as
 * "higher or lower" match-ups. XP, combos, levels and a daily streak keep it fun.
 */
export type CardKind = 'type' | 'choice' | 'flash';

export interface Card {
  id: string;
  cat: string;
  topic: string;
  kind: CardKind;
  q: string;
  a: string;
  num?: number;
  field: string;
  why: string;
  src?: string;
  /** Wrong choices to use (e.g. the family's other colors). */
  wrong?: string[];
}

export interface CardState {
  /** 0 = new … 7 = mastered. */
  box: number;
  /** YYYY-MM-DD it's due again. */
  due: string;
  seen: number;
  misses: number;
  /** Right answers in a row. */
  run?: number;
  /** Got right 5 times in a row at least once (then it's on the spaced schedule). */
  learned?: boolean;
}

export interface Progress {
  cards: Record<string, CardState>;
  xp: number;
  streak: number;
  /** Last day the daily goal was met. */
  lastGoalDay: string | null;
  /** Answers per day (YYYY-MM-DD → count). */
  days: Record<string, number>;
  bestCombo: number;
  sessions: number;
  perfect: number;
  /** How many facts are in rotation at once while learning. */
  newPerDay: number;
  /** Which categories new facts come from ([] = all). */
  focus: string[];
  speedBest: number;
}

export const EMPTY_PROGRESS: Progress = { cards: {}, xp: 0, streak: 0, lastGoalDay: null, days: {}, bestCombo: 0, sessions: 0, perfect: 0, newPerDay: 6, focus: [], speedBest: 0 };

/** Days until a card comes back, by box. */
export const INTERVALS = [0, 1, 2, 4, 7, 14, 30, 60];
export const MASTERED = 5;
export const DAILY_GOAL = 20;
const MAX_DUE = 30;

export const dayOf = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() + n);
  return dayOf(d);
}

/* ---------- questions ---------- */

export type Question =
  | { format: 'choice'; card: Card; options: string[]; correct: number }
  | { format: 'type'; card: Card }
  | { format: 'flash'; card: Card }
  | { format: 'versus'; card: Card; other: Card; answer: -1 | 0 | 1 };

export type Rng = () => number;
export function shuffle<T>(xs: T[], rnd: Rng = Math.random): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Same field, different answers: e.g. other towing capacities. */
export function distractors(card: Card, bank: Card[], rnd: Rng = Math.random, n = 3): string[] {
  // One option per distinct answer ("64 in" and "64 in." are the same answer).
  const key = (c: Card) => (c.num !== undefined ? `#${c.num}` : c.a.toLowerCase().replace(/[^a-z0-9]+/g, ''));
  const pick = (cards: Card[]) => {
    const seen = new Set([key(card)]);
    const out: string[] = [];
    for (const c of cards) if (!seen.has(key(c))) (seen.add(key(c)), out.push(c.a));
    return out;
  };
  const same = bank.filter((c) => c.field === card.field && c.id !== card.id);
  // Numbers: prefer close values, so it isn't obvious.
  if (card.num !== undefined) {
    const near = pick(same.filter((c) => c.num !== undefined).sort((x, y) => Math.abs(x.num! - card.num!) - Math.abs(y.num! - card.num!)));
    if (near.length >= n) return shuffle(near.slice(0, n * 2), rnd).slice(0, n);
  }
  return pick(shuffle(same, rnd)).slice(0, n);
}

/** How to ask this card now: easier while it's new, harder once you know it. */
export function questionFor(card: Card, state: CardState | undefined, bank: Card[], rnd: Rng = Math.random): Question {
  if (card.kind === 'flash') return { format: 'flash', card };
  const box = Math.max(state?.box ?? 0, state?.run ?? 0);
  if (card.num !== undefined && box >= 1 && rnd() < 0.2) {
    const peers = bank.filter((c) => c.field === card.field && c.num !== undefined && c.id !== card.id && c.topic !== card.topic);
    if (peers.length) {
      const other = peers[Math.floor(rnd() * peers.length)];
      return { format: 'versus', card, other, answer: Math.sign(card.num - other.num!) as -1 | 0 | 1 };
    }
  }
  if (card.kind === 'type' && box >= 2) return { format: 'type', card };
  const wrong = card.wrong?.length ? shuffle(card.wrong, rnd).slice(0, 3) : distractors(card, bank, rnd);
  if (wrong.length < 1) return card.kind === 'type' ? { format: 'type', card } : { format: 'flash', card };
  const options = shuffle([card.a, ...wrong], rnd);
  return { format: 'choice', card, options, correct: options.indexOf(card.a) };
}

const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[®™’']/g, '')
    .replace(/[^a-z0-9.]+/g, ' ')
    .trim();
const firstNumber = (s: string) => {
  const m = /(\d[\d,]*\.?\d*)/.exec(s);
  return m ? Number(m[1].replace(/,/g, '')) : null;
};

/** Typed answers: numbers must match; words may be close ("ranger xp 1000" for "RANGER XP 1000"). */
export function checkTyped(card: Card, typed: string): boolean {
  if (!typed.trim()) return false;
  if (card.num !== undefined) return firstNumber(typed) === card.num;
  const t = words(typed);
  const a = words(card.a);
  return t === a || (a.length > 6 && t.length > 4 && (a.includes(t) || t.includes(a)));
}

/* ---------- scheduling ---------- */

/** Right this many times in a row = learned. */
export const LEARN_RUN = 5;

export function grade(state: CardState | undefined, ok: boolean, today: string): CardState {
  const s = state ?? { box: 0, due: today, seen: 0, misses: 0 };
  const box = ok ? Math.min(INTERVALS.length - 1, s.box + 1) : Math.max(0, Math.min(1, s.box - 2));
  const run = ok ? (s.run ?? 0) + 1 : 0;
  const learned = !!s.learned || run >= LEARN_RUN;
  // Still learning (or just missed): back tomorrow. Learned: the spaced schedule.
  const due = learned && ok ? addDays(today, INTERVALS[box]) : addDays(today, 1);
  return { box, due, seen: s.seen + 1, misses: s.misses + (ok ? 0 : 1), run, learned: learned && (ok || !!s.learned) };
}

/** Started but not yet right 5 times in a row. */
export const inProgress = (s: CardState | undefined) => !!s && (s.run ?? 0) < LEARN_RUN && !(s.learned && (s.run ?? 0) > 0);

/**
 * THE LEARNING LOOP: a small set of facts in rotation. A missed fact comes
 * back within a few questions, again and again, until it's right 5 times in
 * a row; then it graduates and a new fact takes its place. Facts learned
 * earlier come back on their spaced schedule (every 4th question or so).
 */
export class Trainer {
  working: string[] = [];
  private reviews: string[] = [];
  private fresh: string[] = [];
  private cooldown = new Map<string, number>();
  private last: string | null = null;
  private n = 0;
  learnedNow: string[] = [];
  private byId: Map<string, Card>;

  constructor(
    bank: Card[],
    private cards: () => Record<string, CardState>,
    private opts: { today: string; size: number; rnd?: Rng; filter?: (c: Card) => boolean; focus?: string[]; noNew?: boolean; seed?: Card[] },
  ) {
    const rnd = opts.rnd ?? Math.random;
    this.byId = new Map(bank.map((c) => [c.id, c]));
    const pool = bank.filter((c) => !opts.filter || opts.filter(c));
    const st = cards();
    const started = opts.seed ?? pool.filter((c) => inProgress(st[c.id])).sort((a, b) => st[b.id].misses - st[a.id].misses);
    this.working = started.slice(0, opts.size).map((c) => c.id);
    this.reviews = pool
      .filter((c) => st[c.id]?.learned && !inProgress(st[c.id]) && st[c.id].due <= opts.today)
      .sort((a, b) => st[b.id].misses - st[a.id].misses)
      .map((c) => c.id);
    if (!opts.noNew) {
      const unseen = pool.filter((c) => !st[c.id] && (!opts.focus?.length || opts.focus.includes(c.cat)));
      // A model's facts together: pick topics, then their facts.
      const topics = shuffle([...new Set(unseen.map((c) => c.topic))], rnd);
      const byTopic = new Map<string, string[]>();
      for (const c of unseen) byTopic.set(c.topic, [...(byTopic.get(c.topic) ?? []), c.id]);
      this.fresh = topics.flatMap((t) => byTopic.get(t)!);
    }
    while (this.working.length < opts.size && this.fresh.length) this.working.push(this.fresh.shift()!);
  }

  get remainingNew() {
    return this.fresh.length;
  }
  get reviewsLeft() {
    return this.reviews.length;
  }

  /** The next card, or null when there's nothing left. */
  next(): Card | null {
    const rnd = this.opts.rnd ?? Math.random;
    this.n++;
    if (this.reviews.length && (this.n % 4 === 0 || !this.working.length)) {
      const i = this.reviews.findIndex((id) => id !== this.last);
      if (i >= 0) return this.show(this.reviews.splice(i, 1)[0]);
    }
    if (!this.working.length) return null;
    const ready = this.working.filter((id) => (this.cooldown.get(id) ?? 0) <= 0 && id !== this.last);
    const pool = ready.length ? ready : this.working.filter((id) => id !== this.last).length ? this.working.filter((id) => id !== this.last) : this.working;
    const st = this.cards();
    const lowest = Math.min(...pool.map((id) => st[id]?.run ?? 0));
    const pick = shuffle(pool.filter((id) => (st[id]?.run ?? 0) === lowest), rnd)[0];
    return this.show(pick);
  }

  private show(id: string) {
    this.last = id;
    return this.byId.get(id)!;
  }

  /** After grading: missed → back in 2-3 questions; right → a little later each time; 5 in a row → graduates. */
  answered(card: Card, ok: boolean, after: CardState): { graduated: boolean } {
    const rnd = this.opts.rnd ?? Math.random;
    for (const [id, n] of this.cooldown) this.cooldown.set(id, n - 1);
    if (!this.working.includes(card.id)) {
      // A review that's missed goes back into rotation until it's solid again.
      if (!ok) {
        this.working.push(card.id);
        this.cooldown.set(card.id, 2);
      }
      return { graduated: false };
    }
    if (ok && (after.run ?? 0) >= LEARN_RUN) {
      this.working = this.working.filter((id) => id !== card.id);
      this.cooldown.delete(card.id);
      this.learnedNow.push(card.id);
      if (this.fresh.length) this.working.push(this.fresh.shift()!);
      return { graduated: true };
    }
    this.cooldown.set(card.id, ok ? 1 + (after.run ?? 0) : 2 + Math.floor(rnd() * 2));
    return { graduated: false };
  }
}

export const isDue = (s: CardState | undefined, today: string) => !!s && s.due <= today;

/** Cards due today, the ones you miss most first. */
export function dueCards(bank: Card[], p: Progress, today: string): Card[] {
  return bank
    .filter((c) => isDue(p.cards[c.id], today))
    .sort((a, b) => p.cards[b.id].misses - p.cards[a.id].misses || p.cards[a.id].box - p.cards[b.id].box);
}

export function newCards(bank: Card[], p: Progress, rnd: Rng = Math.random): Card[] {
  const fresh = bank.filter((c) => !p.cards[c.id] && (!p.focus.length || p.focus.includes(c.cat)));
  // Learn a model's facts together: pick topics, then their facts.
  const topics = shuffle([...new Set(fresh.map((c) => c.topic))], rnd);
  const out: Card[] = [];
  for (const t of topics) {
    for (const c of fresh.filter((x) => x.topic === t)) {
      if (out.length >= p.newPerDay) return out;
      out.push(c);
    }
  }
  return out;
}

export type Mode = 'daily' | 'weak' | 'speed' | 'category';

/** The cards for a session. */
export function buildSession(mode: Mode, bank: Card[], p: Progress, today: string, rnd: Rng = Math.random, category?: string): Card[] {
  if (mode === 'weak')
    return shuffle(
      bank
        .filter((c) => (p.cards[c.id]?.misses ?? 0) > 0)
        .sort((a, b) => p.cards[b.id].misses - p.cards[a.id].misses)
        .slice(0, 15),
      rnd,
    );
  if (mode === 'speed') {
    const known = bank.filter((c) => p.cards[c.id] && c.kind !== 'flash');
    return shuffle(known.length >= 20 ? known : bank.filter((c) => c.kind !== 'flash'), rnd).slice(0, 60);
  }
  if (mode === 'category') {
    const inCat = bank.filter((c) => c.cat === category);
    const due = inCat.filter((c) => isDue(p.cards[c.id], today));
    const fresh = inCat.filter((c) => !p.cards[c.id]);
    return shuffle([...due.slice(0, 15), ...shuffle(fresh, rnd).slice(0, 10)], rnd);
  }
  return shuffle([...dueCards(bank, p, today).slice(0, MAX_DUE), ...newCards(bank, p, rnd)], rnd);
}

/* ---------- points, levels, streak ---------- */

export function points(q: Question, ok: boolean, combo: number): number {
  if (!ok) return 0;
  const base = q.format === 'type' ? 15 : q.format === 'versus' ? 12 : 10;
  return base + Math.min(10, combo * 2);
}

const RANKS = ['Lot Rookie', 'Walkaround Pro', 'Spec Sheet Shark', 'Lineup Ace', 'Showroom Closer', 'Product Legend'];
export function level(xp: number) {
  const lvl = Math.floor(Math.sqrt(xp / 60)) + 1;
  const start = (lvl - 1) ** 2 * 60;
  const next = lvl ** 2 * 60;
  return { level: lvl, rank: RANKS[Math.min(RANKS.length - 1, Math.floor((lvl - 1) / 4))], progress: (xp - start) / (next - start), toNext: next - xp };
}

/** After answering: today's count, the streak (daily goal met on consecutive days). */
export function recordDay(p: Progress, today: string, answered: number): Progress {
  const days = { ...p.days, [today]: (p.days[today] ?? 0) + answered };
  let { streak, lastGoalDay } = p;
  if (days[today] >= DAILY_GOAL && lastGoalDay !== today) {
    streak = lastGoalDay === addDays(today, -1) ? streak + 1 : 1;
    lastGoalDay = today;
  }
  return { ...p, days, streak, lastGoalDay };
}

/** The streak as it stands today (broken if yesterday's goal was missed). */
export function currentStreak(p: Progress, today: string): number {
  return p.lastGoalDay === today || p.lastGoalDay === addDays(today, -1) ? p.streak : 0;
}

export function mastery(bank: Card[], p: Progress) {
  const cats = [...new Set(bank.map((c) => c.cat))];
  return cats
    .map((cat) => {
      const cards = bank.filter((c) => c.cat === cat);
      const seen = cards.filter((c) => p.cards[c.id]).length;
      const mastered = cards.filter((c) => p.cards[c.id]?.learned).length;
      return { cat, total: cards.length, seen, mastered };
    })
    .sort((a, b) => b.total - a.total);
}
