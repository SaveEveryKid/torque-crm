import { describe, expect, it } from 'vitest';
import { autoStage, stageFromHistory } from '../src/crm/stage';
import { activity, blankCustomer } from '../src/crm/store';
import { normalizeStage, type Activity, type Customer, type Stage } from '../src/crm/types';

const out = (t = 'Hello') => activity({ channel: 'EMAIL', direction: 'OUTBOUND', outcome: null, text: t });
const reply = (t = 'Sounds good, send a quote') => activity({ channel: 'EMAIL', direction: 'INBOUND', outcome: null, text: t });
const run = (stage: Stage, ...acts: Activity[]): Stage => {
  let c: Customer = blankCustomer({ stage });
  for (const a of acts) c = { ...c, stage: autoStage(c, a) ?? c.stage, activities: [a, ...c.activities] };
  return c.stage;
};

describe('pipeline stages', () => {
  it('New lead -> Attempted when you reach out', () => expect(run('new', out())).toBe('attempted'));
  it('Attempted stays Attempted through more follow-ups', () => expect(run('new', out(), out(), out())).toBe('attempted'));
  it('Contacted once they respond', () => expect(run('new', out(), reply())).toBe('contacted'));
  it('Hot after more than one engagement', () => expect(run('new', out(), reply(), out(), reply('What colors?'))).toBe('hot'));
  it('an appointment or visit makes them Hot', () =>
    expect(run('attempted', activity({ channel: 'APPOINTMENT', direction: 'INBOUND', outcome: 'Showroom visit', text: '' }))).toBe('hot'));
  it('a connected call counts as a response; voicemail does not', () => {
    expect(run('attempted', activity({ channel: 'PHONE', direction: 'OUTBOUND', outcome: 'Connected — follow up', text: '' }))).toBe('contacted');
    expect(run('attempted', activity({ channel: 'PHONE', direction: 'OUTBOUND', outcome: 'Left voicemail', text: '' }))).toBe('attempted');
  });
  it('auto-replies and bounces are not responses', () => {
    expect(run('attempted', reply('Automatic reply: out of office until Monday'))).toBe('attempted');
    expect(run('attempted', reply('Undeliverable: Polaris side-by-sides'))).toBe('attempted');
  });
  it('never moves Working deal, Sold or Lost, and never moves backward', () => {
    expect(run('working', reply(), reply())).toBe('working');
    expect(run('sold', reply())).toBe('sold');
    expect(run('lost', reply())).toBe('lost');
    expect(run('hot', out())).toBe('hot');
  });
  it('stage from a whole history', () => {
    expect(stageFromHistory([])).toBe('new');
    expect(stageFromHistory([out()])).toBe('attempted');
    expect(stageFromHistory([reply(), out()])).toBe('contacted');
  });
  it('old Appointment / Showed stages read as Hot', () => {
    expect(normalizeStage('appointment')).toBe('hot');
    expect(normalizeStage('showed')).toBe('hot');
    expect(normalizeStage('contacted')).toBe('contacted');
  });
});
