import { describe, expect, it } from 'vitest';
import bankJson from '../src/training/bank.json';
import {
  EMPTY_PROGRESS,
  addDays,
  buildSession,
  checkTyped,
  currentStreak,
  grade,
  level,
  newCards,
  questionFor,
  recordDay,
  type Card,
  type Progress,
} from '../src/training/engine';

const bank = (bankJson as { cards: Card[] }).cards;
const T = '2026-10-29';
let seed = 1;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

describe('the question bank', () => {
  it('covers the whole store, and every card has a question and an answer', () => {
    expect(bank.length).toBeGreaterThan(600);
    for (const cat of ['Polaris', 'Boats', 'Mercury', 'Mowers', 'Colors', 'Lessons', 'Product line']) expect(bank.some((c) => c.cat === cat)).toBe(true);
    for (const c of bank) expect(c.q && c.a && c.id).toBeTruthy();
    expect(new Set(bank.map((c) => c.id)).size).toBe(bank.length);
    expect(bank.some((c) => /Polaris Polaris|1 people/.test(c.q + c.a))).toBe(false);
    // No price questions: customers ask about the machine, not the sticker.
    expect(bank.some((c) => /MSRP|price/i.test(c.q) || /^\$/.test(c.a))).toBe(false);
  });
});

describe('spaced repetition', () => {
  it('right answers come back later and later; a miss comes back tomorrow', () => {
    let s = grade(undefined, true, T);
    expect(s).toMatchObject({ box: 1, due: addDays(T, 1) });
    s = grade(s, true, T);
    s = grade(s, true, T);
    expect(s.box).toBe(3);
    expect(s.due).toBe(addDays(T, 4));
    s = grade(s, false, T);
    expect(s).toMatchObject({ box: 1, due: addDays(T, 1), misses: 1 });
  });

  it('a daily session is what is due (most-missed first) plus new facts from your focus', () => {
    const p: Progress = { ...EMPTY_PROGRESS, focus: ['Boats'], newPerDay: 5, cards: { [bank[0].id]: { box: 2, due: T, seen: 2, misses: 3 } } };
    const s = buildSession('daily', bank, p, T, rnd);
    expect(s.map((c) => c.id)).toContain(bank[0].id);
    expect(s.filter((c) => c.id !== bank[0].id).every((c) => c.cat === 'Boats')).toBe(true);
    expect(newCards(bank, p, rnd)).toHaveLength(5);
  });
});

describe('questions', () => {
  const numeric = bank.find((c) => c.kind === 'type' && c.num !== undefined && c.field === 'Horsepower')!;
  it('new facts are multiple choice; known ones must be typed', () => {
    const q = questionFor(numeric, undefined, bank, () => 0.9);
    expect(q.format).toBe('choice');
    if (q.format === 'choice') {
      expect(q.options[q.correct]).toBe(numeric.a);
      expect(new Set(q.options).size).toBe(q.options.length);
    }
    expect(questionFor(numeric, { box: 3, due: T, seen: 3, misses: 0 }, bank, () => 0.9).format).toBe('type');
    expect(questionFor(numeric, { box: 3, due: T, seen: 3, misses: 0 }, bank, () => 0.1).format).toBe('versus');
  });

  it('typed answers: numbers must match; names can be loose', () => {
    expect(checkTyped({ ...numeric, a: '2,500 lb.', num: 2500 }, '2500')).toBe(true);
    expect(checkTyped({ ...numeric, a: '2,500 lb.', num: 2500 }, '2,500 lbs')).toBe(true);
    expect(checkTyped({ ...numeric, a: '2,500 lb.', num: 2500 }, '2000')).toBe(false);
    const name: Card = { ...numeric, num: undefined, a: 'RANGER XP KINETIC' };
    expect(checkTyped(name, 'ranger xp kinetic')).toBe(true);
    expect(checkTyped(name, 'xp kinetic')).toBe(true);
    expect(checkTyped(name, 'rzr')).toBe(false);
  });
});

describe('streaks and levels', () => {
  it('the streak grows on consecutive days you hit the daily goal, and breaks after a missed day', () => {
    let p = recordDay(EMPTY_PROGRESS, T, 20);
    expect(p.streak).toBe(1);
    p = recordDay(p, addDays(T, 1), 25);
    expect(p.streak).toBe(2);
    expect(currentStreak(p, addDays(T, 2))).toBe(2);
    expect(currentStreak(p, addDays(T, 3))).toBe(0);
    p = recordDay(p, addDays(T, 3), 20);
    expect(p.streak).toBe(1);
  });
  it('levels and ranks', () => {
    expect(level(0)).toMatchObject({ level: 1, rank: 'Lot Rookie' });
    expect(level(60 * 16).level).toBe(5);
    expect(level(60 * 16).rank).toBe('Walkaround Pro');
  });
});

describe('multiple choice', () => {
  it('never offers the same answer twice ("64 in" and "64 in.")', () => {
    for (const c of bank.filter((x) => x.kind !== 'flash').slice(0, 300)) {
      const q = questionFor(c, undefined, bank, rnd);
      if (q.format !== 'choice') continue;
      const keys = q.options.map((o) => o.toLowerCase().replace(/[^a-z0-9]+/g, ''));
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});

describe('customer questions', () => {
  it('colors use the family\'s other colors as wrong answers; yes/no questions get two choices', () => {
    const color = bank.find((c) => c.cat === 'Colors')!;
    const q = questionFor(color, undefined, bank, rnd);
    expect(q.format).toBe('choice');
    if (q.format === 'choice') expect(q.options.filter((o) => o !== color.a).every((o) => color.wrong!.includes(o))).toBe(true);
    const steer = bank.find((c) => c.field === 'Steering')!;
    const s = questionFor(steer, undefined, bank, rnd);
    expect(s.format).toBe('choice');
    if (s.format === 'choice') expect(s.options.sort()).toEqual(['No power steering', 'Yes, power steering (EPS)']);
  });
});

describe('no data glitches in the answers', () => {
  it('seating is believable (no "33 people"), towing is never a winch rating, numbers are short', () => {
    for (const c of bank.filter((x) => x.field === 'Seating')) expect(c.num!).toBeLessThanOrEqual(9);
    expect(bank.find((c) => c.q.includes('2027 Polaris Ranger 1000 (every trim) seat'))?.a).toBe('3 people');
    for (const c of bank.filter((x) => x.field === 'Towing Capacity')) expect(c.a).not.toMatch(/winch/i);
    for (const c of bank.filter((x) => x.num !== undefined && x.field !== 'Length')) expect(c.a.length).toBeLessThan(20);
  });
});
