import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkTyped, questionFor, type Card } from '../src/training/engine';
import { COURSE_CAT, COURSES, courseIds } from '../src/training/courses';

const bank = (JSON.parse(readFileSync('src/training/bank.json', 'utf8')) as { cards: Card[] }).cards;

describe('model bootcamps', () => {
  const course = COURSES.find((c) => c.id === 'ranger-500-2027')!;
  const all = [...bank, ...course.cards];

  it('the 2027 Ranger 500 course has its spec facts plus its own', () => {
    const ids = courseIds(course, all);
    const specs = bank.filter((c) => c.topic === '2027 Polaris Ranger 500');
    expect(specs.length).toBeGreaterThanOrEqual(13);
    expect(ids.size).toBe(specs.length + course.cards.length);
    expect(course.cards.length).toBeGreaterThanOrEqual(30);
  });

  it('every fact is well-formed: unique id, an answer, a source, and wrong choices that are really wrong', () => {
    const seen = new Set(bank.map((c) => c.id));
    for (const c of course.cards) {
      expect(seen.has(c.id), c.id).toBe(false);
      seen.add(c.id);
      expect(c.cat).toBe(COURSE_CAT);
      expect(c.a.trim(), c.id).not.toBe('');
      expect(c.src, c.id).toMatch(/^https?:|inventory/);
      if (c.wrong) {
        expect(c.wrong.length, c.id).toBeGreaterThanOrEqual(3);
        expect(c.wrong, c.id).not.toContain(c.a);
      }
      if (c.kind === 'type') expect(checkTyped(c, c.a), c.id).toBe(true);
    }
  });

  it('asks every fact without crashing (choice cards get 4 options)', () => {
    for (const c of course.cards) {
      const q = questionFor(c, undefined, all, () => 0.5);
      if (q.format === 'choice') expect(q.options).toHaveLength(4);
    }
  });
});
