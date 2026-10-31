import { describe, expect, it } from 'vitest';
import { composeUrl } from '../src/crm/email';
import { applyView, DEFAULT_VIEW, placeOf, sortLetter } from '../src/crm/listView';
import { blankCustomer } from '../src/crm/store';

const people = [
  blankCustomer({ firstName: 'Beth', lastName: 'Carter', company: 'Riverbend Paving', address: '100 Mill Rd, Florence, AL', email: 'beth@riverbend.example', createdAt: '2026-10-01T00:00:00Z' }),
  blankCustomer({ firstName: 'adam', lastName: 'zeller', address: 'Tupelo, MS 38801', createdAt: '2026-10-03T00:00:00Z' }),
  blankCustomer({ company: 'Summit Equipment Rental', address: '2 Depot St, Athens, AL 35611', createdAt: '2026-10-02T00:00:00Z' }),
  blankCustomer({ firstName: 'Cole', lastName: 'Dawson', stage: 'sold', address: 'Memphis, TN' }),
];
const names = (v: Partial<typeof DEFAULT_VIEW>) => applyView(people, { ...DEFAULT_VIEW, ...v }).map((c) => c.lastName || c.company);

describe('the customer list', () => {
  it('A–Z by last name (a business-only contact by its business), open customers by default', () => {
    expect(names({})).toEqual(['Carter', 'Summit Equipment Rental', 'zeller']);
    expect(names({ stage: 'all', sort: 'name-desc' })).toEqual(['zeller', 'Summit Equipment Rental', 'Dawson', 'Carter']);
    expect(names({ sort: 'added' })).toEqual(['zeller', 'Summit Equipment Rental', 'Carter']);
    expect(sortLetter(people[1], 'name')).toBe('Z');
    expect(names({ sort: 'first' })).toEqual(['zeller', 'Carter', 'Summit Equipment Rental']);
    expect(sortLetter({ ...people[0], lastName: '/ Odd' }, 'name')).toBe('O');
  });

  it('filters: people vs businesses, state, has email, search by city', () => {
    expect(names({ kind: 'business' })).toEqual(['Summit Equipment Rental']);
    expect(names({ kind: 'people' })).toEqual(['Carter', 'zeller']);
    expect(names({ state: 'AL' })).toEqual(['Carter', 'Summit Equipment Rental']);
    expect(names({ reach: 'email' })).toEqual(['Carter']);
    expect(names({ q: 'tupelo' })).toEqual(['zeller']);
    expect(placeOf(people[2])).toEqual({ city: 'Athens', state: 'AL' });
    expect(placeOf(people[3])).toEqual({ city: 'Memphis', state: 'TN' });
  });
});

describe('email in Outlook', () => {
  const m = { to: 'beth@riverbend.example', subject: 'Crew machines', body: 'Hi Beth,\n\nQuick question & a quote?' };
  it('the Outlook app through mailto, Outlook on the web through its compose link', () => {
    expect(composeUrl(m, 'outlook-app')).toBe('mailto:beth@riverbend.example?subject=Crew%20machines&body=Hi%20Beth%2C%0D%0A%0D%0AQuick%20question%20%26%20a%20quote%3F');
    const web = new URL(composeUrl(m, 'outlook-web'));
    expect(web.origin + web.pathname).toBe('https://outlook.office.com/mail/deeplink/compose');
    expect(web.searchParams.get('body')).toBe(m.body);
    expect(composeUrl({ ...m, body: 'x'.repeat(5000) }, 'outlook-web').length).toBeLessThanOrEqual(2000);
  });
});
