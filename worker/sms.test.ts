import { describe, expect, it } from 'vitest';
import { digits, isOptIn, isOptOut, matchCustomer } from './sms';

describe('texting', () => {
  it('STOP and START are recognized only as the whole message', () => {
    for (const s of ['STOP', 'stop', ' Stop. ', 'unsubscribe', 'STOPALL', 'cancel']) expect(isOptOut(s)).toBe(true);
    for (const s of ['stop by saturday?', "I can't stop thinking about it", 'Ok']) expect(isOptOut(s)).toBe(false);
    expect(isOptIn('START')).toBe(true);
    expect(isOptIn('start it up for me')).toBe(false);
  });

  it('a text is matched to the customer by main or other phone', () => {
    const rows = [
      { k: 'customers/a', v: JSON.stringify({ phone: '(256) 555-2111', altPhone: '' }) },
      { k: 'customers/b', v: JSON.stringify({ phone: '', altPhone: '256.555.2964' }) },
      { k: 'customers/c', v: '{broken' },
    ];
    expect(matchCustomer(rows, '+12565552964')).toBe('b');
    expect(matchCustomer(rows, '+12565552111')).toBe('a');
    expect(matchCustomer(rows, '+12565550000')).toBeNull();
    expect(digits('+1 (256) 555-2964')).toBe('2565552964');
    expect(digits('555-2964')).toBe('');
  });
});

describe('SignalWire address', () => {
  it('uses just the space name, however SW_SPACE was pasted', async () => {
    const { swBase } = await import('./sms');
    for (const v of ['byrongreen.signalwire.com', 'https://byrongreen.signalwire.com/', 'https://byrongreen.signalwire.com/dashboard/phone_numbers', ' byrongreen.signalwire.com/api ']) expect(swBase({ SW_SPACE: v })).toBe('https://byrongreen.signalwire.com');
  });
});
