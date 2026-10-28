import type { CallState, DialerEvent, DialerProvider } from './provider';
import type { CallLogEntry, Disposition } from './dispositions';

/**
 * POWER DIALER session: one customer at a time.
 *
 * Rules enforced here, whatever the telephony provider (tests/dialerSession.test.ts):
 *  - never more than one customer call at a time;
 *  - never advance while a person is on the line or the result hasn't been chosen;
 *  - a confidently detected voicemail is hung up immediately — nothing is played,
 *    no message is left — and the dialer moves on after the delay;
 *  - an uncertain answer is treated as a person (the human decides);
 *  - pause / resume / next / skip / end are safe at any moment;
 *  - results are LOCAL (onLog) and never go anywhere near eLead.
 */

export interface SessionCustomer {
  opportunityId: string;
  name: string;
  e164: string;
  phone: string;
  vehicle: string | null;
  source: string | null;
  dateIn: string | null;
  /** Custom list only: shown on the customer card, never sent to the phone provider. */
  notes?: string | null;
  altPhone?: string | null;
}

export type SessionPhase =
  | 'idle'
  | 'connecting_agent' // calling my cellphone
  | 'ready' // agent connected, waiting for NEXT (manual mode) or about to dial
  | 'dialing' // asking the provider to place the call
  | 'ringing'
  | 'connected' // talking to a person — never advance
  | 'wrap_up' // call over, waiting for my result
  | 'countdown' // delay before the next call
  | 'paused'
  | 'done' // queue exhausted
  | 'ended';

export interface SessionState {
  phase: SessionPhase;
  pending: SessionCustomer[];
  current: SessionCustomer | null;
  callId: string | null;
  callStartedAt: number | null;
  connectedAt: number | null;
  /** Talk time of the call now in wrap-up. */
  lastTalkSeconds: number;
  /** What happened on the last call, shown to the user ("Voicemail — hung up"). */
  lastEvent: string | null;
  countdownEndsAt: number | null;
  pauseRequested: boolean;
  /** The current call reached voicemail and you stayed on to leave a message. */
  onVoicemail: boolean;
  message: string | null;
  completed: number;
  total: number;
}

export interface SessionDeps {
  provider: DialerProvider;
  now: () => number;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  onChange: (s: SessionState) => void;
  onLog: (e: CallLogEntry) => void;
  /** Opaque, non-PII reference for the provider (e.g. hash of the opportunity ID). */
  refFor: (c: SessionCustomer) => string;
  newId: () => string;
}

/** null = manual NEXT. */
export type DelaySeconds = number | null;

const AUTO_RESULT: Partial<Record<CallState, { result: Disposition; text: string }>> = {
  MACHINE: { result: 'VOICEMAIL', text: 'Voicemail detected — hung up, no message left.' },
  NO_ANSWER: { result: 'NO_ANSWER', text: 'No answer.' },
  BUSY: { result: 'BUSY', text: 'Busy.' },
  FAILED: { result: 'FAILED', text: 'Call failed.' },
  INVALID: { result: 'INVALID', text: 'Number not in service.' },
};

export class PowerDialerSession {
  state: SessionState;
  private timer: unknown = null;
  private agentConnected = false;
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly deps: SessionDeps,
    customers: SessionCustomer[],
    public delaySeconds: DelaySeconds = 5,
    /** 'connect': on voicemail, stay connected so you leave a live message, then HANG UP. */
    public voicemail: 'connect' | 'hangup' = 'hangup',
  ) {
    this.state = {
      phase: 'idle',
      pending: [...customers],
      current: null,
      callId: null,
      callStartedAt: null,
      connectedAt: null,
      lastTalkSeconds: 0,
      lastEvent: null,
      countdownEndsAt: null,
      pauseRequested: false,
      onVoicemail: false,
      message: null,
      completed: 0,
      total: customers.length,
    };
  }

  private set(patch: Partial<SessionState>) {
    this.state = { ...this.state, ...patch };
    this.deps.onChange(this.state);
  }

  private get inCall(): boolean {
    return ['dialing', 'ringing', 'connected'].includes(this.state.phase);
  }

  // ------------------------------------------------------------ controls

  async start(): Promise<void> {
    if (this.state.phase !== 'idle') return;
    this.unsubscribe = this.deps.provider.onEvent((e) => this.onEvent(e));
    this.set({ phase: 'connecting_agent', message: 'Calling your cellphone… answer it and press 1.' });
    try {
      await this.deps.provider.connectAgent();
    } catch (e) {
      this.set({ phase: 'paused', message: `Couldn't call your cellphone: ${(e as Error).message}` });
    }
  }

  /** Finish the current call (if any), then stop before dialing the next customer. */
  pause(): void {
    if (this.state.phase === 'countdown' || this.state.phase === 'ready') {
      this.cancelTimer();
      this.set({ phase: 'paused', countdownEndsAt: null, pauseRequested: false, message: 'Paused.' });
    } else if (!['paused', 'done', 'ended', 'idle'].includes(this.state.phase)) {
      this.set({ pauseRequested: true, message: 'Will pause after this call.' });
    }
  }

  resume(): void {
    if (this.state.phase !== 'paused') return;
    this.set({ pauseRequested: false, message: null });
    if (!this.agentConnected) {
      // My phone line is down: call my cellphone again before dialing anyone.
      this.set({ phase: 'connecting_agent', message: 'Calling your cellphone… answer it and press 1.' });
      void this.deps.provider.connectAgent().catch((e: Error) => this.set({ phase: 'paused', message: `Couldn't call your cellphone: ${e.message}` }));
      return;
    }
    this.continueAfterCall(true);
  }

  /** Dial the next customer now (skips the countdown). While ringing: give up on this call. */
  async next(): Promise<void> {
    if (this.state.phase === 'ringing' && this.state.callId) {
      const id = this.state.callId;
      this.finishCall('NO_ANSWER', 'Stopped ringing — moved on.', true);
      await this.deps.provider.hangup(id).catch(() => undefined);
      this.continueAfterCall(true);
      return;
    }
    if (['countdown', 'ready', 'paused'].includes(this.state.phase)) {
      this.cancelTimer();
      this.set({ pauseRequested: false });
      await this.dialNext();
    }
  }

  /**
   * HANG UP the customer's call from Torque (your phone line stays open for the
   * next call). Goes straight to the result screen; a voicemail is pre-picked.
   */
  async hangUp(): Promise<void> {
    if (this.state.phase !== 'connected' || !this.state.callId) return;
    const id = this.state.callId;
    const talk = Math.round((this.deps.now() - (this.state.connectedAt ?? this.deps.now())) / 1000);
    this.set({ phase: 'wrap_up', lastTalkSeconds: talk, lastEvent: 'You hung up. Pick a result.' });
    await this.deps.provider.hangup(id).catch(() => undefined);
  }

  /** Skip the upcoming customer without calling them. */
  skipUpcoming(): void {
    if (this.inCall || this.state.phase === 'wrap_up') return;
    const [skipped, ...rest] = this.state.pending;
    if (!skipped) return;
    this.log(skipped, 'SKIP', 0, null, null, false, this.deps.now());
    this.set({ pending: rest, completed: this.state.completed + 1, lastEvent: `Skipped ${skipped.name}.` });
    if (rest.length === 0) this.finishQueue();
  }

  /** Record my result for the call in wrap-up, then continue. */
  disposition(result: Disposition, note: string | null, callbackAt: string | null): void {
    if (this.state.phase !== 'wrap_up' || !this.state.current) return;
    this.log(this.state.current, result, this.state.lastTalkSeconds, note, callbackAt, false, this.state.callStartedAt ?? this.deps.now());
    this.set({ phase: 'ready', current: null, callId: null, completed: this.state.completed + 1, lastEvent: null });
    this.continueAfterCall(false);
  }

  /** Queue edits apply to customers not yet dialed. */
  reorder(pending: SessionCustomer[]): void {
    this.set({ pending, total: this.state.completed + pending.length + (this.state.current ? 1 : 0) });
  }

  /**
   * End the session. A customer still ringing is hung up; a person on the line
   * is NOT cut off (you end that call on your phone). The agent line is closed.
   */
  async end(): Promise<void> {
    this.cancelTimer();
    if (this.state.phase === 'ringing' || this.state.phase === 'dialing') {
      const id = this.state.callId;
      if (this.state.current) this.finishCall('SKIP', 'Session ended while ringing.', true);
      if (id) await this.deps.provider.hangup(id).catch(() => undefined);
    }
    if (this.state.phase === 'wrap_up' && this.state.current) {
      this.log(this.state.current, 'CONNECTED_FOLLOW_UP', this.state.lastTalkSeconds, null, null, true, this.state.callStartedAt ?? this.deps.now());
    }
    await this.deps.provider.endSession().catch(() => undefined);
    this.unsubscribe?.();
    this.set({ phase: 'ended', current: null, callId: null, countdownEndsAt: null, message: 'Session ended.' });
  }

  // ------------------------------------------------------------ flow

  /** Queue exhausted: hang up my phone line too (an empty call still costs money). */
  private finishQueue() {
    this.cancelTimer();
    this.set({ phase: 'done', current: null, countdownEndsAt: null, message: 'Queue finished. Your phone line was hung up.' });
    this.agentConnected = false;
    this.unsubscribe?.();
    void this.deps.provider.endSession().catch(() => undefined);
  }

  private cancelTimer() {
    if (this.timer !== null) this.deps.clearTimer(this.timer);
    this.timer = null;
  }

  private async dialNext(): Promise<void> {
    if (this.inCall || this.state.phase === 'wrap_up') return; // ONE call at a time
    if (!this.agentConnected) {
      // Never ring a customer when nobody is on my end of the line.
      this.set({ phase: 'paused', countdownEndsAt: null, message: "Your phone isn't connected. Click Resume to call your cellphone." });
      return;
    }
    const [customer, ...rest] = this.state.pending;
    if (!customer) {
      this.finishQueue();
      return;
    }
    this.set({
      phase: 'dialing',
      pending: rest,
      current: customer,
      callId: null,
      callStartedAt: this.deps.now(),
      connectedAt: null,
      lastTalkSeconds: 0,
      countdownEndsAt: null,
      lastEvent: null,
      onVoicemail: false,
      message: null,
    });
    try {
      const { callId } = await this.deps.provider.dial({ e164: customer.e164, ref: this.deps.refFor(customer) });
      // An event may already have advanced the state (fast failure).
      if (this.state.current === customer && this.state.phase === 'dialing') this.set({ phase: 'ringing', callId });
      else if (this.state.current === customer && !this.state.callId) this.set({ callId });
    } catch (e) {
      this.finishCall('FAILED', `Call failed: ${(e as Error).message}`, true);
      this.continueAfterCall(false);
    }
  }

  private onEvent(e: DialerEvent) {
    if (e.type === 'AGENT') {
      if (e.state === 'CONNECTED') this.agentConnected = true;
      if (e.state === 'CONNECTED' && this.state.phase === 'connecting_agent') {
        this.set({ message: 'Your phone is connected.' });
        this.continueAfterCall(true);
      } else if (e.state === 'ENDED' || e.state === 'FAILED') {
        if (this.state.phase === 'ended') return;
        // My phone hung up: stop dialing. A ringing customer is let go.
        if (this.state.phase === 'ringing' || this.state.phase === 'dialing') {
          const id = this.state.callId;
          this.finishCall('SKIP', 'Your phone disconnected.', true);
          if (id) void this.deps.provider.hangup(id).catch(() => undefined);
        }
        this.cancelTimer();
        if (this.state.phase === 'connected') {
          // My phone hung up mid-conversation (which ends the customer's leg too): ask for the result.
          const talk = Math.round((this.deps.now() - (this.state.connectedAt ?? this.deps.now())) / 1000);
          this.set({ phase: 'wrap_up', lastTalkSeconds: talk, lastEvent: 'Call ended. Pick a result.', pauseRequested: true });
        }
        this.set({
          phase: this.state.phase === 'wrap_up' ? 'wrap_up' : 'paused',
          countdownEndsAt: null,
          message: e.state === 'FAILED' ? `Couldn't reach your cellphone${e.detail ? ` (${e.detail})` : ''}.` : 'Your phone line ended. Click Resume to call your cellphone again.',
        });
        this.agentConnected = false;
      }
      return;
    }

    if (!this.state.current || (this.state.callId && e.callId !== this.state.callId)) return; // stale event
    if (!this.state.callId) this.set({ callId: e.callId });

    switch (e.state) {
      case 'RINGING':
        if (this.state.phase === 'dialing') this.set({ phase: 'ringing' });
        break;
      case 'HUMAN':
      case 'UNKNOWN_ANSWER':
        if (this.state.phase === 'dialing' || this.state.phase === 'ringing') {
          this.set({ phase: 'connected', connectedAt: this.deps.now(), lastEvent: e.state === 'HUMAN' ? 'Connected.' : 'Answered — connected to you.' });
        }
        break;
      case 'MACHINE': {
        if (this.voicemail === 'connect') {
          // Stay on the line: you leave a short live message, then HANG UP (nothing recorded is played).
          if (this.state.phase === 'dialing' || this.state.phase === 'ringing') this.set({ phase: 'connected', connectedAt: this.deps.now() });
          if (this.state.phase === 'connected') this.set({ onVoicemail: true, lastEvent: 'Voicemail: leave a short message after the beep, then press HANG UP.' });
          break;
        }
        // Also when detection arrives after bridging: hang up the machine, nothing is played.
        const id = this.state.callId;
        this.finishCall('VOICEMAIL', AUTO_RESULT.MACHINE!.text, true);
        if (id) void this.deps.provider.hangup(id).catch(() => undefined);
        this.set({ phase: 'ready', connectedAt: null }); // leave 'connected' so the dialer can move on
        this.continueAfterCall(false);
        break;
      }
      case 'NO_ANSWER':
      case 'BUSY':
      case 'FAILED':
      case 'INVALID':
        if (this.state.phase === 'connected') break; // a person is on the line; ignore late noise
        this.finishCall(AUTO_RESULT[e.state]!.result, AUTO_RESULT[e.state]!.text, true);
        this.continueAfterCall(false);
        break;
      case 'COMPLETED':
        if (this.state.phase === 'connected') {
          const talk = Math.round((this.deps.now() - (this.state.connectedAt ?? this.deps.now())) / 1000);
          this.set({ phase: 'wrap_up', lastTalkSeconds: talk, lastEvent: 'Call ended. Pick a result.' });
        } else if (this.state.phase === 'ringing' || this.state.phase === 'dialing') {
          this.finishCall('NO_ANSWER', AUTO_RESULT.NO_ANSWER!.text, true);
          this.continueAfterCall(false);
        }
        break;
    }
  }

  /** Log an automatic result for the current call and clear it. */
  private finishCall(result: Disposition, text: string, automatic: boolean) {
    const c = this.state.current;
    if (!c) return;
    this.log(c, result, 0, null, null, automatic, this.state.callStartedAt ?? this.deps.now());
    this.set({ current: null, callId: null, completed: this.state.completed + 1, lastEvent: `${c.name}: ${text}` });
  }

  private continueAfterCall(immediate: boolean) {
    if (this.state.phase === 'connected' || this.state.phase === 'wrap_up') return;
    if (this.state.phase === 'ended') return;
    if (this.state.pending.length === 0) {
      this.finishQueue();
      return;
    }
    if (this.state.pauseRequested) {
      this.set({ phase: 'paused', pauseRequested: false, countdownEndsAt: null, message: 'Paused.' });
      return;
    }
    if (this.delaySeconds === null) {
      this.set({ phase: 'ready', countdownEndsAt: null });
      return;
    }
    const ms = immediate ? 0 : this.delaySeconds * 1000;
    this.set({ phase: 'countdown', countdownEndsAt: this.deps.now() + ms });
    this.cancelTimer();
    this.timer = this.deps.setTimer(() => {
      this.timer = null;
      if (this.state.phase === 'countdown') void this.dialNext();
    }, ms);
  }

  private log(c: SessionCustomer, result: Disposition, talkSeconds: number, note: string | null, callbackAt: string | null, automatic: boolean, startedAt: number) {
    this.deps.onLog({
      id: this.deps.newId(),
      at: new Date(startedAt).toISOString(),
      opportunityId: c.opportunityId,
      name: c.name,
      phone: c.phone,
      vehicle: c.vehicle,
      source: c.source,
      dateIn: c.dateIn,
      result,
      talkSeconds,
      callbackAt,
      note: note?.trim() || null,
      automatic,
    });
  }
}
