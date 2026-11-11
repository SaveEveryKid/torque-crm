import { beforeEach, describe, expect, it } from 'vitest';
import { kv } from '../src/core/storage/kv';
import { addCustomer, blankCustomer, getCustomers, updateCustomer } from '../src/crm/store';
import { addLeadsToCustomers, customerForLead, leadText, type WebLead } from '../src/crm/webLeads';

const lead = (patch: Partial<WebLead> = {}): WebLead => ({
  id: 'rwb-lead-1',
  at: '2026-11-12T15:00:00.000Z',
  name: 'Pat Rider',
  phone: '+12565552964',
  email: 'pat@example.com',
  type: 'quote',
  label: 'Get My Best Quote',
  message: 'Do you take trades?',
  preferredTime: '',
  vehicle: { id: 'guid-1', title: '2026 Polaris Ranger Crew XP 1000', stock: 'R12345', url: 'https://www.ridewithbyron.com/inventory/x' },
  source: 'Google Ads',
  campaign: 'rangers-nov',
  customerId: null,
  ...patch,
});

describe('website leads become customers', () => {
  beforeEach(async () => {
    await kv.remove(['customers', 'webLeads']);
  });

  it('someone new: a customer with the inquiry, the unit, where they came from, and a call task', async () => {
    const fresh = await addLeadsToCustomers([lead()]);
    expect(fresh).toHaveLength(1);
    const list = Object.values(await getCustomers());
    expect(list).toHaveLength(1);
    const c = list[0];
    expect([c.firstName, c.lastName, c.phone, c.email, c.stage]).toEqual(['Pat', 'Rider', '(256) 555-2964', 'pat@example.com', 'new']);
    expect(c.source).toBe('RideWithByron.com: Google Ads');
    expect(c.vehicle?.stock).toBe('R12345');
    expect(c.interest).toBe('2026 Polaris Ranger Crew XP 1000');
    expect(c.activities[0]).toMatchObject({ direction: 'INBOUND', outcome: 'Website lead' });
    expect(c.activities[0].text).toContain('Get My Best Quote: 2026 Polaris Ranger Crew XP 1000 (Stock #R12345)');
    expect(c.activities[0].text).toContain('“Do you take trades?”');
    expect(c.activities[0].text).toContain('Found you through: Google Ads (rangers-nov)');
    expect(c.tasks).toHaveLength(1);
    expect(c.tasks[0]).toMatchObject({ kind: 'call', done: false, dueAt: '2026-11-12T15:15:00.000Z' });
    expect(await customerForLead(lead())).toBe(c.id);
  });

  it('the same lead again (another device, a later sync) changes nothing', async () => {
    await addLeadsToCustomers([lead()]);
    const again = await addLeadsToCustomers([lead()]);
    expect(again).toHaveLength(0);
    const c = Object.values(await getCustomers())[0];
    expect(c.activities).toHaveLength(1);
    expect(c.tasks).toHaveLength(1);
  });

  it('someone you already have (by phone) keeps everything you entered; the inquiry is added', async () => {
    const mine = await addCustomer(blankCustomer({ firstName: 'Patricia', lastName: 'Rider', phone: '256.555.2964', source: 'Walk-in', interest: 'RZR', stage: 'working' }));
    await addLeadsToCustomers([lead()]);
    const all = await getCustomers();
    expect(Object.keys(all)).toEqual([mine.id]);
    const c = all[mine.id];
    expect([c.firstName, c.source, c.interest, c.stage]).toEqual(['Patricia', 'Walk-in', 'RZR', 'working']);
    expect(c.email).toBe('pat@example.com');
    expect(c.vehicle?.title).toBe('2026 Polaris Ranger Crew XP 1000');
    expect(c.activities[0].outcome).toBe('Website lead');
    expect(c.tasks).toHaveLength(1);
  });

  it('matches by email when the phone is different, and reopens a sold or lost customer', async () => {
    const mine = await addCustomer(blankCustomer({ firstName: 'Pat', phone: '(256) 555-9999', email: 'Pat@Example.com' }));
    await updateCustomer(mine.id, { stage: 'lost' });
    await addLeadsToCustomers([lead()]);
    const all = await getCustomers();
    expect(Object.keys(all)).toEqual([mine.id]);
    expect(all[mine.id].stage).toBe('new');
  });

  it('two inquiries from the same new person make one customer with both on the timeline', async () => {
    await addLeadsToCustomers([lead(), lead({ id: 'rwb-lead-2', at: '2026-11-12T16:00:00.000Z', type: 'visit', label: 'Schedule a Visit', preferredTime: 'Saturday morning', vehicle: null, message: '' })]);
    const list = Object.values(await getCustomers());
    expect(list).toHaveLength(1);
    expect(list[0].activities.map((a) => a.id)).toEqual(['weblead-rwb-lead-2', 'weblead-rwb-lead-1']);
    expect(list[0].tasks.map((t) => t.title)).toContain('Website lead: confirm their visit (Saturday morning)');
  });

  it('a lead is never dropped: a number Torque cannot read still becomes a customer, as typed', async () => {
    expect(await addLeadsToCustomers([lead({ phone: '+12565550142', email: '' })])).toHaveLength(1);
    const list = Object.values(await getCustomers());
    expect(list).toHaveLength(1);
    expect([list[0].id, list[0].phone]).toEqual(['web-rwb-lead-1', '+12565550142']);
    expect(await addLeadsToCustomers([lead({ phone: '+12565550142', email: '' })])).toHaveLength(0);
  });

  it('the timeline text reads plainly for a general question', () => {
    expect(leadText(lead({ vehicle: null, message: '', campaign: '', source: 'Direct', label: 'Ask Byron' }))).toBe('Ask Byron\nFound you through: Direct');
  });
});
