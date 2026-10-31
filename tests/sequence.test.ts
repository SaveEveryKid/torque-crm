import { describe, expect, it } from 'vitest';
import { LIST_TYPES } from '../src/core/analysis/customList';
import { suggestedType, targets } from '../src/crm/predraft';
import { addBusinessDays, afterActivity, autoStop, dueStep, running, stopSequence } from '../src/crm/sequence';
import { activity, blankCustomer } from '../src/crm/store';
import type { Activity, Customer } from '../src/crm/types';

const MON = '2026-11-02T15:00:00.000Z';
const apply = (c: Customer, a: Activity): Customer => ({ ...c, ...afterActivity(c, a), activities: [a, ...c.activities] });
const sent = (at = MON) => activity({ at, channel: 'EMAIL', direction: 'OUTBOUND', outcome: 'Subject: Polaris UTVs', text: 'Hello…' });

describe('scheduled follow-up emails', () => {
  const fresh = blankCustomer({ company: 'Summit Equipment Rental', email: 'office@summit.example' });

  it('the first email schedules #2, #3 and #4 on business days', () => {
    const c = apply(fresh, sent());
    expect(running(c)).toBe(true);
    const seq = c.tasks.filter((t) => t.seq);
    expect(seq.map((t) => [t.seq, t.title, new Date(t.dueAt).getDay()])).toEqual([
      [2, 'Follow-up email #2: short bump', 5],
      [3, 'Follow-up email #3: new angle', 1],
      [4, 'Follow-up email #4: closing note', 2],
    ]);
    expect(addBusinessDays(new Date('2026-11-06T15:00:00Z'), 1).getDay()).toBe(1); // Friday + 1 = Monday
  });

  it('when #2 is due, it is the type picked for the draft (customer page and Pre-draft)', () => {
    const c = apply(fresh, sent());
    const due = new Date(c.tasks.find((t) => t.seq === 2)!.dueAt);
    expect(suggestedType(c, new Date(MON))).toBe('');
    expect(suggestedType(c, due)).toBe('bump');
    expect(suggestedType(fresh)).toBe('cold_opener');
    // Last draft (the cold opener) was sent: #2 due → it gets a new draft.
    const drafts = { [c.id]: { status: 'sent', type: 'cold_opener', at: MON } } as never;
    expect(targets([c], drafts, false, new Date(MON))).toHaveLength(0);
    expect(targets([c], drafts, false, due)).toHaveLength(1);
    expect(LIST_TYPES.bump.hint).toMatch(/Re: /);
  });

  it('sending a follow-up checks off the one that was due; the next stays scheduled', () => {
    let c = apply(fresh, sent());
    const due2 = c.tasks.find((t) => t.seq === 2)!.dueAt;
    c = apply(c, sent(due2));
    expect(c.tasks.find((t) => t.seq === 2)!.done).toBe(true);
    expect(c.tasks.find((t) => t.seq === 3)!.done).toBe(false);
    expect(dueStep(c, new Date(due2))).toBeNull();
  });

  it('a reply stops the rest and puts "Reply to their email" on Today; answering them clears it', () => {
    let c = apply(fresh, sent());
    c = apply(c, activity({ channel: 'EMAIL', direction: 'INBOUND', outcome: null, text: 'Talk to Jim in fleet.' }));
    expect(running(c)).toBe(false);
    expect(c.sequence?.reason).toBe('They replied');
    expect(c.tasks.filter((t) => t.seq && !t.done)).toHaveLength(0);
    expect(c.tasks.filter((t) => t.reply && !t.done).map((t) => t.title)).toEqual(['Reply to their email']);
    c = apply(c, sent());
    expect(c.tasks.filter((t) => t.reply && !t.done)).toHaveLength(0);
    // Already talking: no new automatic run.
    expect(running(c)).toBe(false);
  });

  it('a call where you talked, a stage past Contacted, do-not-contact or Stop all end it', () => {
    const c = apply(fresh, sent());
    expect(running(apply(c, activity({ channel: 'PHONE', direction: 'OUTBOUND', outcome: 'Talked', text: '' })))).toBe(false);
    expect(running(apply(c, activity({ channel: 'PHONE', direction: 'OUTBOUND', outcome: 'Left voicemail', text: '' })))).toBe(true);
    expect(autoStop({ ...c, stage: 'appointment' }).sequence?.reason).toBe('Moved to appointment');
    expect(autoStop({ ...c, doNotContact: true }).sequence?.reason).toBe('Do not contact');
    expect(running({ ...c, ...stopSequence(c, 'Stopped by you') })).toBe(false);
  });
});
