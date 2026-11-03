import { describe, expect, it } from 'vitest';
import { classifyMessageMode } from '../src/core/ai/customerContext';
import { LIST_TYPES, listContext } from '../src/core/analysis/customList';
import { styleBlock, type StyleExample } from '../src/core/storage/styleMemory';
import { profileInput } from '../src/core/ai/profile';
import { composeUrl, withSignature } from '../src/crm/email';
import { targets, typeFor } from '../src/crm/predraft';
import { activity, blankCustomer } from '../src/crm/store';
import { DEFAULT_SETTINGS } from '../src/crm/types';

describe('pre-drafting a whole list', () => {
  const fresh = blankCustomer({ company: 'Summit Equipment Rental', email: 'office@summit.example' });
  const talked = blankCustomer({ firstName: 'Beth', email: 'beth@riverbend.example', activities: [activity({ channel: 'PHONE', direction: 'OUTBOUND', outcome: 'Talked', text: 'Wants two Crews in spring' })] });
  const noEmail = blankCustomer({ firstName: 'Cole', phone: '(256) 555-2501' });
  const dnc = blankCustomer({ firstName: 'Dee', email: 'dee@x.example', doNotContact: true });

  it('Auto: a cold opener for anyone never contacted, a follow-up from the history for the rest', () => {
    expect(typeFor(fresh, 'auto')).toBe('cold_opener');
    expect(typeFor(talked, 'auto')).toBe('');
    expect(typeFor(talked, 'cold')).toBe('cold');
  });

  it('drafts only customers with an email who may be contacted, and skips ones already drafted unless redoing', () => {
    const all = [fresh, talked, noEmail, dnc];
    expect(targets(all, {}, false).map((c) => c.id)).toEqual([fresh.id, talked.id]);
    const drafts = { [fresh.id]: { status: 'ready' }, [talked.id]: { status: 'error' } } as never;
    expect(targets(all, drafts, false).map((c) => c.id)).toEqual([talked.id]);
    expect(targets(all, drafts, true)).toHaveLength(2);
  });

  it('"Cold opener" is first in the follow-up types and tells Claude to ask for the right person', () => {
    expect(Object.keys(LIST_TYPES)[0]).toBe('cold_opener');
    expect(LIST_TYPES.cold_opener.label).toBe('Cold opener');
    const ctx = listContext({ listType: 'cold_opener', listNote: '' } as never);
    expect(ctx).toMatch(/who handles their UTV or equipment purchases/);
    expect(ctx).toMatch(/Never pretend we've talked/);
    // Quotes only: never a demo or bringing a unit out.
    expect(ctx).toMatch(/The only offer is a quote/);
    expect(ctx).not.toMatch(/bring a unit out for|crew to try|demo unit brought/);
  });

  it('someone we have never been in touch with is a first contact, not a follow-up', () => {
    const base = { lastCustomerAt: null, lastUsAt: null, attemptsSinceReply: 0, leadAgeDays: 0 };
    expect(classifyMessageMode(base)).toBe('FIRST_CONTACT');
    expect(classifyMessageMode({ ...base, listType: 'cold_opener', leadAgeDays: 400 })).toBe('FIRST_CONTACT');
    expect(classifyMessageMode({ ...base, lastUsAt: new Date().toISOString(), attemptsSinceReply: 1 })).not.toBe('FIRST_CONTACT');
  });
});

describe('learning from every decision', () => {
  const denied: StyleExample = { id: 'd1', at: '2026-10-31T12:00:00Z', kind: 'email', ai: 'Alex, I hope this finds you well.', sent: '', denied: true, reasons: ['Too stiff / formal'] };
  it('a denied draft (and why) goes into the examples and the profile update', () => {
    expect(styleBlock([denied], 'Byron', 'all')).toContain('Byron threw it out and sent nothing. Why: Too stiff / formal');
    expect(profileInput('', [denied], '').text).toContain('He threw it out (sent nothing)\nWhy: Too stiff / formal');
  });
});

describe('your signature', () => {
  it('is added once to emails opened in Outlook', () => {
    // Byron's signature is added by the CRM (Outlook doesn't add it to these).
    expect(withSignature('Hello,\n\nQuick question.', DEFAULT_SETTINGS.signature)).toBe(`Hello,\n\nQuick question.\n\n${DEFAULT_SETTINGS.signature}`);
    expect(withSignature(withSignature('Hi', 'Byron'), 'Byron')).toBe('Hi\n\nByron');
    expect(withSignature('Hi', '')).toBe('Hi');
    expect(composeUrl({ to: 'a@b.example', body: withSignature('Hi', 'Byron') }, 'outlook-app')).toContain('Hi%0D%0A%0D%0AByron');
  });
});
