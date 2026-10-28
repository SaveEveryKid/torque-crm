/**
 * SAFETY + BEHAVIOR SUITE — power dialer rules, with the practice provider and fake time.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PowerDialerSession, type SessionCustomer, type DelaySeconds } from '../src/core/dialer/session';
import { MockDialerProvider, type MockOutcome } from '../src/core/dialer/mockProvider';
import type { CallLogEntry } from '../src/core/dialer/dispositions';
import { recordRef } from '../src/core/storage/hash';

const customers = (n: number): SessionCustomer[] =>
  Array.from({ length: n }, (_, i) => ({
    opportunityId: String(900000 + i),
    name: `Customer ${i + 1}`,
    e164: `+1731613${String(1000 + i)}`,
    phone: `(731) 613-${1000 + i}`,
    vehicle: null,
    source: 'Google',
    dateIn: null,
  }));

const RING = 4000;

function setup(script: MockOutcome[], n = script.length, delay: DelaySeconds = 5, voicemail: 'connect' | 'hangup' = 'hangup') {
  const provider = new MockDialerProvider({ script: [...script], ringMs: RING, agentAnswerMs: 1000, setTimer: (f, ms) => setTimeout(f, ms) });
  const log: CallLogEntry[] = [];
  let id = 0;
  const session = new PowerDialerSession(
    {
      provider,
      now: () => Date.now(),
      setTimer: (f, ms) => setTimeout(f, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      onChange: () => undefined,
      onLog: (e) => log.push(e),
      refFor: (c) => recordRef(c.opportunityId),
      newId: () => String(++id),
    },
    customers(n),
    delay,
    voicemail,
  );
  const hangups: string[] = [];
  const realHangup = provider.hangup.bind(provider);
  provider.hangup = async (callId: string) => {
    hangups.push(callId);
    return realHangup(callId);
  };
  return { provider, session, log, hangups };
}

/** Let promises and timers run up to `ms` of fake time. */
const run = async (ms: number) => {
  await vi.advanceTimersByTimeAsync(ms);
};

beforeEach(() => vi.useFakeTimers({ now: new Date('2026-10-08T09:00:00') }));
afterEach(() => vi.useRealTimers());

describe('power dialer', () => {
  it('calls my cellphone first, then customers ONE AT A TIME', async () => {
    const t = setup(['NO_ANSWER', 'BUSY', 'NO_ANSWER']);
    await t.session.start();
    expect(t.session.state.phase).toBe('connecting_agent');
    expect(t.provider.dialed).toHaveLength(0); // no customer before my phone is connected
    await run(1000 + 3 * (RING + 5000) + 100);
    expect(t.provider.dialed.map((d) => d.e164)).toEqual(['+17316131000', '+17316131001', '+17316131002']);
    expect(t.provider.maxConcurrent).toBe(1);
    expect(t.log.map((l) => [l.name, l.result, l.automatic])).toEqual([
      ['Customer 1', 'NO_ANSWER', true],
      ['Customer 2', 'BUSY', true],
      ['Customer 3', 'NO_ANSWER', true],
    ]);
    expect(t.session.state.phase).toBe('done');
  });

  it('when a person answers it STOPS: no further dialing for as long as I talk', async () => {
    const t = setup(['HUMAN', 'NO_ANSWER'], 2);
    await t.session.start();
    await run(1000 + RING + 50);
    expect(t.session.state.phase).toBe('connected');
    await run(30 * 60 * 1000); // a 30-minute conversation
    expect(t.session.state.phase).toBe('connected');
    expect(t.provider.dialed).toHaveLength(1);
  });

  it('after the call ends it waits for MY result (with talk time), then continues', async () => {
    const t = setup(['HUMAN', 'NO_ANSWER'], 2);
    await t.session.start();
    await run(1000 + RING + 10);
    await run(222_000); // talk 3:42
    t.provider.customerHangsUp();
    await run(10);
    expect(t.session.state).toMatchObject({ phase: 'wrap_up', lastTalkSeconds: 222 });
    await run(60_000); // still waiting for me
    expect(t.provider.dialed).toHaveLength(1);
    t.session.disposition('CALL_BACK_LATER', 'Looking for RAV4 around $500/mo. Call Saturday.', '2026-10-10T10:00:00.000Z');
    expect(t.log[0]).toMatchObject({ result: 'CALL_BACK_LATER', talkSeconds: 222, automatic: false, note: 'Looking for RAV4 around $500/mo. Call Saturday.', callbackAt: '2026-10-10T10:00:00.000Z' });
    await run(5000 + 10);
    expect(t.provider.dialed).toHaveLength(2);
  });

  it('voicemail: hangs up immediately, plays nothing, and moves on only after the delay', async () => {
    const t = setup(['MACHINE', 'NO_ANSWER'], 2);
    await t.session.start();
    await run(1000 + RING + 10);
    expect(t.hangups).toEqual(['practice-1']);
    expect(t.provider.played).toEqual([]); // no prerecorded message, ever
    expect(t.log[0]).toMatchObject({ result: 'VOICEMAIL', automatic: true });
    expect(t.session.state.phase).toBe('countdown');
    await run(4900);
    expect(t.provider.dialed).toHaveLength(1);
    await run(200);
    expect(t.provider.dialed).toHaveLength(2);
  });

  it('an uncertain answer is treated as a person — never hung up on', async () => {
    const t = setup(['UNKNOWN_ANSWER', 'NO_ANSWER'], 2);
    await t.session.start();
    await run(1000 + RING + 10);
    expect(t.session.state.phase).toBe('connected');
    expect(t.hangups).toEqual([]);
  });

  it('pause during a ringing call: finishes that call, then stops; resume continues', async () => {
    const t = setup(['NO_ANSWER', 'NO_ANSWER'], 2);
    await t.session.start();
    await run(1000 + 100);
    t.session.pause();
    await run(RING + 60_000);
    expect(t.session.state.phase).toBe('paused');
    expect(t.provider.dialed).toHaveLength(1);
    t.session.resume();
    await run(10);
    expect(t.provider.dialed).toHaveLength(2);
  });

  it('manual mode: waits for NEXT after every result', async () => {
    const t = setup(['NO_ANSWER', 'NO_ANSWER'], 2, null);
    await t.session.start();
    await run(1000 + 10);
    expect(t.session.state.phase).toBe('ready');
    expect(t.provider.dialed).toHaveLength(0);
    await t.session.next();
    await run(RING + 60_000);
    expect(t.session.state.phase).toBe('ready');
    expect(t.provider.dialed).toHaveLength(1);
  });

  it('NEXT while ringing gives up on that call (hangs up) and dials the next', async () => {
    const t = setup(['NO_ANSWER', 'NO_ANSWER'], 2);
    await t.session.start();
    await run(1000 + 1000);
    await t.session.next();
    await run(10);
    expect(t.hangups).toEqual(['practice-1']);
    expect(t.provider.dialed).toHaveLength(2);
    expect(t.provider.maxConcurrent).toBe(1);
  });

  it('SKIP removes the upcoming customer without calling them', async () => {
    const t = setup(['NO_ANSWER', 'NO_ANSWER', 'NO_ANSWER'], 3, null);
    await t.session.start();
    await run(1010);
    t.session.skipUpcoming();
    await t.session.next();
    expect(t.provider.dialed.map((d) => d.e164)).toEqual(['+17316131001']);
    expect(t.log[0]).toMatchObject({ name: 'Customer 1', result: 'SKIP' });
  });

  it('if my phone hangs up, dialing stops; Resume calls my cellphone again first', async () => {
    const t = setup(['NO_ANSWER', 'NO_ANSWER'], 2);
    await t.session.start();
    await run(1000 + RING + 10); // first call done, countdown running
    (t.provider as unknown as { emit: (e: unknown) => void }).emit({ type: 'AGENT', state: 'ENDED' });
    await run(60_000);
    expect(t.session.state.phase).toBe('paused');
    expect(t.provider.dialed).toHaveLength(1);
    t.session.resume();
    expect(t.session.state.phase).toBe('connecting_agent');
    await run(1000 + 10);
    expect(t.provider.dialed).toHaveLength(2);
  });

  it('voicemail detected AFTER the call was bridged: hangs up and still moves on', async () => {
    const t = setup(['HUMAN', 'NO_ANSWER'], 2);
    await t.session.start();
    await run(1000 + RING + 10);
    expect(t.session.state.phase).toBe('connected');
    const id = t.session.state.callId!;
    (t.provider as unknown as { emit: (e: unknown) => void }).emit({ type: 'CALL', callId: id, state: 'MACHINE' });
    expect(t.hangups).toEqual([id]);
    expect(t.log[0]).toMatchObject({ name: 'Customer 1', result: 'VOICEMAIL' });
    expect(t.session.state.phase).toBe('countdown');
    await run(5000 + 10);
    expect(t.provider.dialed).toHaveLength(2);
  });

  it('if my phone hangs up mid-conversation, I still get to record the result, then it pauses', async () => {
    const t = setup(['HUMAN', 'NO_ANSWER'], 2);
    await t.session.start();
    await run(1000 + RING + 10);
    await run(20_000);
    (t.provider as unknown as { emit: (e: unknown) => void }).emit({ type: 'AGENT', state: 'ENDED' });
    expect(t.session.state.phase).toBe('wrap_up');
    expect(t.session.state.lastTalkSeconds).toBeGreaterThanOrEqual(20);
    t.session.disposition('CONNECTED_FOLLOW_UP', null, null);
    expect(t.log[0]).toMatchObject({ name: 'Customer 1', result: 'CONNECTED_FOLLOW_UP' });
    expect(t.session.state.phase).toBe('paused');
    await run(60_000);
    expect(t.provider.dialed).toHaveLength(1);
  });

  it('when the queue is finished it hangs up my phone line (no paying for an empty call)', async () => {
    const t = setup(['NO_ANSWER'], 1);
    let ended = 0;
    const real = t.provider.endSession.bind(t.provider);
    t.provider.endSession = async () => {
      ended++;
      return real();
    };
    await t.session.start();
    await run(1000 + RING + 10);
    expect(t.session.state.phase).toBe('done');
    expect(ended).toBe(1);
  });

  it('END SESSION never cuts off a person I am talking to', async () => {
    const t = setup(['HUMAN'], 1);
    await t.session.start();
    await run(1000 + RING + 10);
    await t.session.end();
    expect(t.hangups).toEqual([]);
    expect(t.session.state.phase).toBe('ended');
  });

  it('only the phone number and an opaque reference are given to the phone provider', async () => {
    const t = setup(['NO_ANSWER'], 1);
    await t.session.start();
    await run(1000 + 10);
    const sent = t.provider.dialed[0];
    expect(Object.keys(sent).sort()).toEqual(['e164', 'ref']);
    expect(sent.ref).toMatch(/^r_[0-9a-f]{8}$/);
    expect(JSON.stringify(sent)).not.toMatch(/Customer|900000|Google/);
  });
});

describe('voicemail: connect me, and HANG UP', () => {
  it('stays on a voicemail so I can leave a live message; nothing else is dialed until I hang up', async () => {
    const t = setup(['MACHINE', 'NO_ANSWER'], 2, 5, 'connect');
    await t.session.start();
    await run(1000 + RING + 50);
    expect(t.session.state.phase).toBe('connected');
    expect(t.session.state.onVoicemail).toBe(true);
    expect(t.session.state.lastEvent).toMatch(/leave a short message/);
    expect(t.hangups).toEqual([]);
    await run(60_000);
    expect(t.provider.dialed).toHaveLength(1);
    const id = t.session.state.callId!;
    await t.session.hangUp();
    expect(t.hangups).toEqual([id]);
    expect(t.session.state.phase).toBe('wrap_up');
    expect(t.session.state.lastTalkSeconds).toBeGreaterThanOrEqual(60);
    t.session.disposition('VOICEMAIL', 'left message', null);
    expect(t.log.map((l) => [l.result, l.automatic, l.note])).toEqual([['VOICEMAIL', false, 'left message']]);
    await run(5000 + RING + 100);
    expect(t.provider.dialed).toHaveLength(2); // my line stayed open: the next customer is called
  });

  it('the old way still works: hang up on voicemail automatically', async () => {
    const t = setup(['MACHINE'], 1, 5, 'hangup');
    await t.session.start();
    await run(1000 + RING + 50);
    expect(t.hangups).toHaveLength(1);
    expect(t.log[0].result).toBe('VOICEMAIL');
  });

  it('HANG UP on a person ends just their call; my phone line stays connected', async () => {
    const t = setup(['HUMAN', 'NO_ANSWER'], 2);
    await t.session.start();
    await run(1000 + RING + 50);
    await run(20_000);
    await t.session.hangUp();
    expect(t.session.state.phase).toBe('wrap_up');
    t.session.disposition('CONNECTED_FOLLOW_UP', null, null);
    await run(5000 + RING + 100);
    expect(t.provider.dialed).toHaveLength(2);
  });

  it('HANG UP does nothing unless a call is connected', async () => {
    const t = setup(['NO_ANSWER'], 1);
    await t.session.start();
    await t.session.hangUp();
    expect(t.hangups).toEqual([]);
  });
});
