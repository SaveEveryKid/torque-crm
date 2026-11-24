import { describe, expect, it } from 'vitest';
import { KENECT_STEPS, isKenectTask, kenectTasks, nextRepeat, properName, spreadStarts } from '../src/crm/cadence';
import { suggestedType } from '../src/crm/predraft';
import { afterActivity } from '../src/crm/sequence';
import { activity, blankCustomer } from '../src/crm/store';
import { pipelineOf, type Customer } from '../src/crm/types';

const day = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`;

describe('Kenect pipeline: past buyers, light check-in texts', () => {
  it('customers without a pipeline are on Email; Kenect ones say so', () => {
    expect(pipelineOf(blankCustomer({ firstName: 'Pat' }))).toBe('email');
    expect(pipelineOf({ pipeline: 'kenect' })).toBe('kenect');
  });

  it('three light texts: the check-in, a nudge a month later, then every 3 months', () => {
    const start = new Date('2026-11-25T09:00:00');
    const t = kenectTasks(start);
    expect(t.map((x) => [x.kind, day(new Date(x.dueAt)), !!x.repeat])).toEqual([
      ['text', '11/25', false],
      ['text', '12/25', false],
      ['text', '3/25', true],
    ]);
    expect(t.every(isKenectTask)).toBe(true);
    expect(KENECT_STEPS[0].title).toMatch(/thanks for doing business with us, still enjoying the unit/);
    // Checking off the every-3-months text schedules the next one.
    expect(day(new Date(nextRepeat(t[2], new Date('2027-03-25T10:00:00'))!.dueAt))).toBe('6/24');
  });

  it('first texts are spread a set number per work day, Tuesday to Saturday', () => {
    const d = spreadStarts(7, 3, new Date('2026-11-27T14:00:00')); // Friday afternoon
    expect(d.map(day)).toEqual(['11/28', '11/28', '11/28', '12/1', '12/1', '12/1', '12/2']); // skips Sun 11/29 and Mon 11/30
  });

  it('a reply stops the scheduled check-in texts, keeps the every-3-months one, and asks you to answer', () => {
    const base = blankCustomer({ firstName: 'Haley', phone: '931-555-0101' });
    const c: Customer = { ...base, pipeline: 'kenect', tasks: kenectTasks(new Date('2026-11-25T09:00:00')) };
    const reply = activity({ at: '2026-11-25T16:00:00.000Z', channel: 'TEXT', direction: 'INBOUND', outcome: null, text: 'Loving it! Might look at a new one in spring.' });
    const tasks = afterActivity(c, reply).tasks!;
    const open = tasks.filter((t) => !t.done);
    expect(open.map((t) => (t.reply ? 'reply' : t.repeat ? 'quarterly' : t.title))).toEqual(['quarterly', 'reply']);
  });

  it('names are never left in all caps', () => {
    expect(properName('HALEY')).toBe('Haley');
    expect(properName('MARY-ANN')).toBe('Mary-Ann');
    expect(properName("O'NEAL")).toBe("O'Neal");
    expect(properName('McDonald')).toBe('McDonald');
    expect(properName('')).toBe('');
  });

  it('drafts for Kenect customers use the light past-buyer check-in', () => {
    const c: Customer = { ...blankCustomer({ firstName: 'Haley', phone: '931-555-0101' }), pipeline: 'kenect' };
    expect(suggestedType(c)).toBe('kenect_checkin');
  });
});
