import { describe, expect, it } from 'vitest';
import { applyChat, cleanChat, customerFor, listingLine, matchUnit, newLines, phoneInChat, theyWroteLast, type ChatLead } from '../src/crm/chatLeads';
import { readUnit } from '../src/crm/inventory';
import { blankCustomer } from '../src/crm/store';

// Fictional buyers and units only.
const units = [
  readUnit({ objectID: 'r1', Year: 2024, Manufacturer: 'Polaris', ProductName: 'Ranger 1000 Premium', Price: 15999, Condition: 'Used' }),
  readUnit({ objectID: 'r2', Year: 2025, Manufacturer: 'Polaris', ProductName: 'Ranger 1000 Premium', Price: 17499, Condition: 'New' }),
  readUnit({ objectID: 's1', Year: 2024, Manufacturer: 'Polaris', ProductName: 'Sportsman 570', Price: 8999, Condition: 'Used' }),
];

const lead = (over: Partial<ChatLead> = {}): ChatLead => ({
  thread: '1234567890',
  name: 'Jordan Testerson',
  phone: '',
  unit: '2024 Polaris Ranger 1000',
  chat: 'Them: Is this still available?\nMe: It sure is!\nThem: What would payments be?',
  url: 'https://www.facebook.com/messages/t/1234567890',
  ...over,
});

describe('Facebook Marketplace chats → Torque', () => {
  it('matches the listing to the right unit (same year), or none', () => {
    expect(matchUnit('2024 Polaris Ranger 1000', units)?.id).toBe('r1');
    expect(matchUnit('2025 Polaris Ranger 1000 Premium', units)?.id).toBe('r2');
    expect(matchUnit('Polaris Sportsman 570', units)?.id).toBe('s1');
    expect(matchUnit('2019 Honda Pioneer 700', units)).toBeNull();
    expect(matchUnit('', units)).toBeNull();
  });

  it('reads who wrote last and a phone number the buyer typed (not mine)', () => {
    expect(theyWroteLast('Them: hi\nMe: hello')).toBe(false);
    expect(theyWroteLast('Me: hello\nThem: ok')).toBe(true);
    expect(phoneInChat('Me: call me at 256-555-2100\nThem: my number is (256) 555-2143')).toBe('(256) 555-2143');
    expect(phoneInChat('Them: no number here')).toBe('');
    expect(cleanChat('Them:   hi \n\nThem: hi\nMe: yo')).toBe('Them: hi\nMe: yo');
  });

  it('a new buyer becomes a customer with the chat on the timeline and a task to answer', () => {
    const { customer, isNew, added } = applyChat(lead({ chat: lead().chat + '\nThem: my cell is 256-555-2143' }), null, units[0], new Date('2026-11-25T15:00:00Z'));
    expect(isNew).toBe(true);
    expect(added).toBe(true);
    expect(customer).toMatchObject({ id: 'fb-1234567890', firstName: 'Jordan', lastName: 'Testerson', phone: '(256) 555-2143', source: 'Facebook Marketplace', interest: units[0].title });
    expect(customer.vehicle?.id).toBe('r1');
    expect(customer.activities[0]).toMatchObject({ channel: 'OTHER', direction: 'INBOUND', outcome: 'Facebook Marketplace chat' });
    expect(customer.activities[0].text).toContain('Them: What would payments be?');
    expect(customer.tasks.filter((t) => !t.done && t.title.startsWith('Answer their Marketplace message'))).toHaveLength(1);
  });

  it('saving the same chat again adds only what is new (and nothing when nothing is)', () => {
    const first = applyChat(lead(), null, null, new Date('2026-11-25T15:00:00Z')).customer;
    const customers = { [first.id]: first };
    expect(customerFor(lead(), customers)?.id).toBe(first.id);
    const same = applyChat(lead(), first, null, new Date('2026-11-25T16:00:00Z'));
    expect(same.added).toBe(false);
    const more = lead({ chat: lead().chat + '\nMe: About $299 a month\nThem: Can I come Saturday?' });
    expect(newLines(more.chat, first, more.thread)).toBe('Me: About $299 a month\nThem: Can I come Saturday?');
    const next = applyChat(more, first, null, new Date('2026-11-25T17:00:00Z'));
    expect(next.added).toBe(true);
    expect(next.customer.activities).toHaveLength(2);
    // Still only one open "answer them" task.
    expect(next.customer.tasks.filter((t) => !t.done && t.title.startsWith('Answer'))).toHaveLength(1);
  });

  it('finds a customer you already have by the phone number they gave', () => {
    const existing = blankCustomer({ id: 'c1', firstName: 'Jordan', phone: '(256) 555-2143' });
    expect(customerFor(lead({ thread: '999', chat: 'Them: text me 2565552143' }), { c1: existing })?.id).toBe('c1');
    expect(customerFor(lead({ thread: '999' }), { c1: existing })).toBeNull();
  });

  it('tells Claude the real listing price and payment (so it never makes one up)', () => {
    expect(listingLine(lead(), units[0], 299)).toBe('(This is a Facebook Marketplace chat about my listing: 2024 Polaris Ranger 1000 Premium, listed at $15,999, payments as low as $299/mo WAC.)\n');
    expect(listingLine(lead({ unit: '' }), null, null)).toBe('');
  });
});
