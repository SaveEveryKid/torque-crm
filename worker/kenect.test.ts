import { describe, expect, it } from 'vitest';
import { kenectMissing, kenectReady, rowFromKenect } from './kenect';
import type { Env } from './env';

describe('Kenect texting', () => {
  it('is on only with all five keys', () => {
    const env = { KENECT_API_KEY: 'k', KENECT_API_SECRET: 's', KENECT_LOCATION_ID: 'l', KENECT_PARTNER_LOCATION_ID: 'p' } as Env;
    expect(kenectReady(env)).toBe(false);
    expect(kenectMissing(env)).toEqual(['KENECT_PARTNER_LOCATION_ZIP']);
    expect(kenectReady({ ...env, KENECT_PARTNER_LOCATION_ZIP: '35630' })).toBe(true);
  });

  it('turns a Kenect message into a Torque text with a stable id', () => {
    const inbound = rowFromKenect({ id: 42, messageBody: 'Still love it!', outgoing: false, sentAt: '2026-11-24T20:00:00Z' }, '(931) 622-5957', 'cust-1')!;
    expect(inbound).toMatchObject({ id: 'kenect-42', direction: 'INBOUND', phone: '+19316225957', customerId: 'cust-1', status: 'received', body: 'Still love it!' });
    const out = rowFromKenect({ id: 'abc', messageBody: 'Hey Haley', outgoing: true, externalStatus: 'DELIVERED' }, '9316225957', 'cust-1')!;
    expect(out).toMatchObject({ id: 'kenect-abc', direction: 'OUTBOUND', status: 'delivered' });
    expect(rowFromKenect({ id: 7, messageBody: 'STOP', outgoing: false }, '9316225957', null)!.optOut).toBe(true);
    expect(rowFromKenect({ messageBody: 'no id' }, '9316225957', null)).toBeNull();
  });
});
