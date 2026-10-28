import { beforeEach, describe, expect, it } from 'vitest';
import { _rows } from '../src/core/storage/kv';

const { rowsFor, decode, applyRows, synced, pending } = _rows;

describe('saving to Cloudflare: only what changed', () => {
  beforeEach(() => {
    synced.clear();
    pending.clear();
  });

  it('each customer is its own row; changing one customer sends one row', () => {
    const first = rowsFor('customers', { a: { n: 1 }, b: { n: 2 } });
    expect([...first.keys()].sort()).toEqual(['customers', 'customers/a', 'customers/b']);
    for (const [k, v] of first) synced.set(k, v!);
    const next = rowsFor('customers', { a: { n: 1 }, b: { n: 3 } });
    expect([...next]).toEqual([['customers/b', '{"n":3}']]);
    const removed = rowsFor('customers', { a: { n: 1 } });
    expect([...removed]).toEqual([['customers/b', null]]);
  });

  it('big values are saved in parts and put back together', () => {
    const big = { list: 'x'.repeat(900_000) };
    const rows = rowsFor('callLog', big);
    expect(rows.size).toBe(4); // head + 3 parts
    for (const v of rows.values()) expect(v!.length).toBeLessThanOrEqual(400_000);
    expect(decode(new Map([...rows].map(([k, v]) => [k, v!]))).get('callLog')).toEqual(big);
    for (const [k, v] of rows) synced.set(k, v!);
    // Smaller again: the extra parts are deleted.
    expect([...rowsFor('callLog', { list: 'small' })].filter(([, v]) => v === null).map(([k]) => k).sort()).toEqual(['callLog#0', 'callLog#1', 'callLog#2']);
  });

  it("another device's changes come in, but your unsaved change wins", () => {
    for (const [k, v] of rowsFor('customers', { a: { n: 1 } })) synced.set(k, v!);
    pending.set('customers/a', '{"n":5}');
    applyRows([
      { k: 'customers/a', v: '{"n":2}' },
      { k: 'customers/z', v: '{"n":9}' },
    ]);
    expect(synced.get('customers/a')).toBe('{"n":1}');
    expect(synced.get('customers/z')).toBe('{"n":9}');
  });
});

describe('rows the server writes by itself', () => {
  it('"sms/<id>" rows make the sms map even with no head row', () => {
    const m = decode(new Map([['sms/SM1', '{"body":"hi"}'], ['sms/SM2', '{"body":"yo"}'], ['settings', '{"a":1}']]));
    expect(m.get('sms')).toEqual({ SM1: { body: 'hi' }, SM2: { body: 'yo' } });
    expect(m.get('settings')).toEqual({ a: 1 });
  });
});
