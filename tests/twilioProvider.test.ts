import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { mapCall, twilioBaseOk, TwilioDialerProvider } from '../src/core/dialer/twilioProvider';
import type { DialerEvent } from '../src/core/dialer/provider';

describe('Twilio dialer address', () => {
  it.each(['https://elead-dialer-1234.twil.io', 'https://elead-dialer-1234-dev.twil.io/', 'https://torque-dialer.byron.workers.dev'])('accepts %s', (u) => expect(twilioBaseOk(u)).toBe(true));
  it.each([
    'http://elead-dialer-1234.twil.io',
    'https://twil.io.evil.example',
    'https://evil.example/elead.twil.io',
    'https://crm.connectcdk.com',
    'https://user:pw@x.twil.io',
    'https://x.twil.io:8443',
    'javascript:alert(1)',
    '',
  ])('refuses %s', (u) => expect(twilioBaseOk(u)).toBe(false));

  it('never sends a request to a refused address', async () => {
    let calls = 0;
    const p = new TwilioDialerProvider('https://crm.connectcdk.com', 'pw-pw-pw-pw-pw-pw', async () => {
      calls++;
      return new Response('{}');
    });
    await expect(p.connectAgent()).rejects.toThrow(/workers\.dev/);
    expect(calls).toBe(0);
  });
});

describe('call status mapping', () => {
  it.each([
    ['ringing', null, null, 'RINGING'],
    ['in-progress', null, 'RINGING', 'UNKNOWN_ANSWER'], // connected to me at once; machine check still running
    ['in-progress', 'human', 'UNKNOWN_ANSWER', 'HUMAN'],
    ['in-progress', 'machine_start', 'UNKNOWN_ANSWER', 'MACHINE'],
    // You were already connected (to a voicemail or a person): the call simply ended. Pick the result.
    ['completed', 'machine_start', 'UNKNOWN_ANSWER', 'COMPLETED'],
    ['completed', 'machine_start', 'MACHINE', 'COMPLETED'],
    ['completed', 'machine_start', 'RINGING', 'MACHINE'],
    ['completed', 'human', 'HUMAN', 'COMPLETED'],
    ['completed', null, 'RINGING', 'NO_ANSWER'],
    ['busy', null, 'RINGING', 'BUSY'],
    ['no-answer', null, 'RINGING', 'NO_ANSWER'],
    ['failed', null, null, 'FAILED'],
    ['canceled', null, 'RINGING', 'COMPLETED'],
  ] as const)('%s / %s (after %s) → %s', (status, answeredBy, prev, want) => expect(mapCall(status, answeredBy, prev)).toBe(want));
});

describe('provider requests', () => {
  function fake(responses: Record<string, unknown>) {
    const sent: Array<{ url: string; method: string; body: Record<string, string> }> = [];
    const p = new TwilioDialerProvider('https://elead-dialer-1234.twil.io', 'a-long-dialer-password-123', async (url, init) => {
      const body = Object.fromEntries(new URLSearchParams(String(init.body)));
      sent.push({ url, method: String(init.method), body });
      return new Response(JSON.stringify(responses[body.action] ?? {}), { status: 200 });
    });
    const events: DialerEvent[] = [];
    p.onEvent((e) => events.push(e));
    return { p, sent, events, responses };
  }

  it('sends only the password, ids and the customer phone number — as a simple form POST to /api', async () => {
    const f = fake({ start: { session: '0123456789abcdef', agentSid: `CA${'1'.repeat(32)}` }, dial: { callSid: `CA${'2'.repeat(32)}` } });
    await f.p.connectAgent();
    await f.p.dial({ e164: '+17316138558', ref: 'r_deadbeef' });
    await f.p.endSession();
    expect(f.sent.map((s) => s.url)).toEqual(Array(3).fill('https://elead-dialer-1234.twil.io/api'));
    expect(f.sent.every((s) => s.method === 'POST')).toBe(true);
    expect(f.sent[1].body).toEqual({ token: 'a-long-dialer-password-123', action: 'dial', session: '0123456789abcdef', agentSid: `CA${'1'.repeat(32)}`, to: '+17316138558', voicemail: 'hangup' });
    expect(JSON.stringify(f.sent)).not.toContain('r_deadbeef');
  });

  it('turns status polls into dialer events: my phone connects, then the call is answered and ends', async () => {
    const agentSid = `CA${'1'.repeat(32)}`;
    const callSid = `CA${'2'.repeat(32)}`;
    const f = fake({ start: { session: '0123456789abcdef', agentSid }, dial: { callSid } });
    await f.p.connectAgent();
    f.responses.status = { agent: { status: 'in-progress', inConference: true }, call: null };
    await f.p.poll();
    await f.p.dial({ e164: '+17316138558', ref: 'r' });
    for (const call of [
      { status: 'ringing', answeredBy: null, duration: 0 },
      { status: 'in-progress', answeredBy: null, duration: 0 },
      { status: 'in-progress', answeredBy: 'human', duration: 5 },
      { status: 'completed', answeredBy: 'human', duration: 222 },
    ]) {
      f.responses.status = { agent: { status: 'in-progress', inConference: false }, call };
      await f.p.poll();
    }
    await f.p.endSession();
    expect(f.events).toEqual([
      { type: 'AGENT', state: 'CALLING' },
      { type: 'AGENT', state: 'CONNECTED' },
      { type: 'CALL', callId: callSid, state: 'RINGING' },
      { type: 'CALL', callId: callSid, state: 'UNKNOWN_ANSWER' },
      { type: 'CALL', callId: callSid, state: 'HUMAN' },
      { type: 'CALL', callId: callSid, state: 'COMPLETED' },
    ]);
  });
});

describe('no credentials anywhere in what ships', () => {
  const roots = ['src'];
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx|js|json|html|css)$/.test(n) ? [p] : [];
    });
  const files = roots.flatMap(walk);
  it.each([
    ['Twilio account SID', /\bAC[0-9a-f]{32}\b/],
    ['Twilio API key SID', /\bSK[0-9a-f]{32}\b/],
    ['auth token assignment', /auth[_-]?token\s*[:=]\s*['"][0-9a-f]{32}['"]/i],
    ['bearer secret', /Bearer\s+[A-Za-z0-9._-]{20,}/],
    ['phone numbers hard-coded as AGENT_CELL/CALLER_ID values', /(AGENT_CELL|CALLER_ID)\s*[:=]\s*['"]\+1\d{10}['"]/],
  ])('no %s', (_what, re) => {
    expect(files.filter((f) => re.test(readFileSync(f, 'utf8')))).toEqual([]);
  });
});
