import { describe, expect, it } from 'vitest';
import { MONTHLY_TITLE, QUARTERLY_TITLE, next15th, nextRepeat, tasksForStage } from '../src/crm/cadence';
import type { Task } from '../src/crm/types';

const NOW = new Date('2026-11-21T15:00:00');
const open = (title: string, extra: Partial<Task> = {}): Task => ({ id: title, kind: 'email', dueAt: '2026-11-24T15:00:00.000Z', title, done: false, ...extra });
const day = (iso: string) => { const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()}`; };

describe('follow-up schedules that come with a stage', () => {
  it('next 15th: this month if still ahead, else next month', () => {
    expect(day(next15th(new Date('2026-11-10T12:00:00')).toISOString())).toBe('11/15');
    expect(day(next15th(NOW).toISOString())).toBe('12/15');
    expect(day(next15th(new Date('2026-12-20T12:00:00')).toISOString())).toBe('1/15');
  });

  it('Long-term follow-up replaces every open follow-up with one email on the 15th', () => {
    const tasks = tasksForStage({ tasks: [open('Follow-up 2 of 6'), open('Hot 3 of 7'), open('Reply to Pat', { reply: true }), open('Appointment', { kind: 'appointment' })] }, 'attempted', 'longterm', NOW)!;
    const openNow = tasks.filter((t) => !t.done);
    expect(openNow.map((t) => t.title)).toEqual(['Reply to Pat', 'Appointment', MONTHLY_TITLE]);
    expect(day(openNow[2].dueAt)).toBe('12/15');
  });

  it('checking off the monthly email schedules next month; leaving the stage stops it', () => {
    const monthly = tasksForStage({ tasks: [] }, 'hot', 'longterm', NOW)!.find((t) => t.repeat)!;
    expect(day(nextRepeat(monthly, new Date('2026-12-15T16:00:00'))!.dueAt)).toBe('1/15');
    const left = tasksForStage({ tasks: [monthly] }, 'longterm', 'hot', NOW)!;
    expect(left.every((t) => t.done)).toBe(true);
  });

  it('Sold follow-up: 2 days, 2 weeks, 45 days, then every 3 months forever', () => {
    const tasks = tasksForStage({ tasks: [open('Follow-up 3 of 6')] }, 'sold', 'soldfollow', NOW)!.filter((t) => !t.done);
    expect(tasks.map((t) => day(t.dueAt))).toEqual(['11/23', '12/5', '1/5', '3/21']);
    const q = tasks.find((t) => t.title === QUARTERLY_TITLE)!;
    const next = nextRepeat(q, new Date(q.dueAt))!;
    expect(next.repeat).toBe('quarterly');
    expect(Math.round((new Date(next.dueAt).getTime() - new Date(q.dueAt).getTime()) / 86_400_000)).toBe(91);
  });

  it('other stage moves leave tasks alone', () => {
    expect(tasksForStage({ tasks: [open('Follow-up 2 of 6')] }, 'attempted', 'hot', NOW)).toBeNull();
  });
});
