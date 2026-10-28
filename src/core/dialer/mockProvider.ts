import type { CallState, DialerEvent, DialerProvider, DialTarget } from './provider';

/**
 * PRACTICE MODE: a pretend phone system. No real calls are placed and nothing
 * leaves the browser. Outcomes come from a script (tests) or at random
 * (practice), so the whole power-dialer workflow can be learned safely.
 */
export type MockOutcome = 'HUMAN' | 'MACHINE' | 'NO_ANSWER' | 'BUSY' | 'FAILED' | 'INVALID' | 'UNKNOWN_ANSWER';

export interface MockOptions {
  /** Outcomes in order; when exhausted, falls back to random. */
  script?: MockOutcome[];
  random?: () => number;
  ringMs?: number;
  agentAnswerMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
}

export class MockDialerProvider implements DialerProvider {
  readonly name = 'practice';
  private listeners = new Set<(e: DialerEvent) => void>();
  private seq = 0;
  private live = new Set<string>();
  /** Highest number of simultaneous customer calls ever (tests assert 1). */
  maxConcurrent = 0;
  dialed: DialTarget[] = [];
  /** Anything a provider might "play" to a customer. The mock never plays anything; tests assert it stays empty. */
  readonly played: string[] = [];
  private humanCall: string | null = null;

  constructor(private readonly opts: MockOptions = {}) {}

  private emit(e: DialerEvent) {
    for (const l of this.listeners) l(e);
  }
  private later(fn: () => void, ms: number) {
    (this.opts.setTimer ?? ((f, t) => setTimeout(f, t)))(fn, ms);
  }
  private nextOutcome(): MockOutcome {
    const scripted = this.opts.script?.shift();
    if (scripted) return scripted;
    const r = (this.opts.random ?? Math.random)();
    if (r < 0.25) return 'HUMAN';
    if (r < 0.55) return 'MACHINE';
    if (r < 0.85) return 'NO_ANSWER';
    if (r < 0.95) return 'BUSY';
    return 'FAILED';
  }

  onEvent(listener: (e: DialerEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async connectAgent() {
    this.emit({ type: 'AGENT', state: 'CALLING' });
    this.later(() => this.emit({ type: 'AGENT', state: 'CONNECTED' }), this.opts.agentAnswerMs ?? 1500);
  }

  async dial(target: DialTarget) {
    const callId = `practice-${++this.seq}`;
    this.dialed.push(target);
    this.live.add(callId);
    this.maxConcurrent = Math.max(this.maxConcurrent, this.live.size);
    const outcome = this.nextOutcome();
    this.later(() => this.emit({ type: 'CALL', callId, state: 'RINGING' }), 0);
    this.later(() => {
      if (!this.live.has(callId)) return;
      this.emit({ type: 'CALL', callId, state: outcome as CallState });
      if (outcome === 'HUMAN' || outcome === 'UNKNOWN_ANSWER') this.humanCall = callId;
      else if (outcome !== 'MACHINE') this.end(callId);
    }, this.opts.ringMs ?? 4000);
    return { callId };
  }

  /** Practice UI: the pretend customer hangs up. */
  customerHangsUp() {
    if (this.humanCall) this.end(this.humanCall);
  }

  private end(callId: string) {
    if (!this.live.delete(callId)) return;
    if (this.humanCall === callId) this.humanCall = null;
    this.emit({ type: 'CALL', callId, state: 'COMPLETED' });
  }

  async hangup(callId: string) {
    this.end(callId);
  }

  async endSession() {
    for (const id of [...this.live]) this.end(id);
    this.emit({ type: 'AGENT', state: 'ENDED' });
  }
}
