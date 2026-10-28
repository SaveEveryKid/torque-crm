import type { CallState, DialerEvent, DialerProvider, DialTarget } from './provider';

/**
 * Real calls through YOUR dialer backend: the SignalWire Cloudflare Worker
 * (signalwire/worker.js, https://<name>.<you>.workers.dev) or the older Twilio
 * Functions (twilio/functions, https://<service>.twil.io).
 *
 * The extension's only network traffic: plain form POSTs to
 *   https://<your-service>.twil.io/api
 * carrying the dialer password, a session ID, call IDs and — when dialing —
 * the customer's phone number. Never a name, never anything from eLead.
 * The address must be https and end in .twil.io (checked here; the manifest
 * CSP allows nothing else).
 */
export function twilioBaseOk(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && /^[a-z0-9-]+(\.[a-z0-9-]+)*\.(twil\.io|workers\.dev)$/i.test(u.hostname) && !u.username && !u.password && !u.port;
  } catch {
    return false;
  }
}

export interface TwilioStatus {
  agent: { status: string; inConference: boolean };
  call: { status: string; answeredBy: string | null; duration: number } | null;
}

/** Twilio says machine_start/machine_end_*; SignalWire says machine. */
const MACHINE = /^(machine|fax)/;
const POLL_MS = 2000;
const MAX_FAILURES = 5;

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export class TwilioDialerProvider implements DialerProvider {
  readonly name = 'twilio';
  private listeners = new Set<(e: DialerEvent) => void>();
  private session: string | null = null;
  private agentSid: string | null = null;
  private agentConnected = false;
  private callSid: string | null = null;
  private lastCallState: CallState | null = null;
  private poller: ReturnType<typeof setInterval> | null = null;
  private failures = 0;
  private stopped = false;

  /** 'connect': ask the dialer to keep voicemails connected (you leave a live message). */
  voicemail: 'connect' | 'hangup' = 'hangup';

  constructor(
    private readonly baseUrl: string,
    private readonly password: string,
    private readonly fetchImpl: Fetch = (u, i) => fetch(u, i),
  ) {}

  private emit(e: DialerEvent) {
    for (const l of this.listeners) l(e);
  }

  onEvent(listener: (e: DialerEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** The single network call (to your /api, or /draft for follow-up drafts). */
  private async api<T>(action: string, fields: Record<string, string> = {}, path: '/api' | '/draft' = '/api'): Promise<T> {
    if (!twilioBaseOk(this.baseUrl)) throw new Error('The dialer address must look like https://torque-dialer.yourname.workers.dev');
    const url = new URL(path, this.baseUrl).toString();
    // Form-encoded POST: a "simple" request (no CORS preflight, no custom headers).
    let res: Response;
    try {
      res = await this.fetchImpl(url, { method: 'POST', body: new URLSearchParams({ token: this.password, action, ...fields }) });
    } catch {
      // The browser hides the host's own error pages (not deployed, crashed, timed out) as a bare "Failed to fetch".
      throw new Error(
        `Couldn't get an answer from ${url}. Open that address in a Chrome tab: "Wrong dialer password" means it's running; anything else means the dialer isn't deployed or is set up wrong.`,
      );
    }
    const body = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) throw new Error(body.error ?? `Dialer error ${res.status}`);
    return body;
  }

  /** Settings → Test connection. */
  async ping(): Promise<{ callerId: string }> {
    return this.api('ping');
  }

  /** Settings → Call forwarding: the address to paste into SignalWire for incoming calls (carries a private key). */
  async incomingUrl(): Promise<string> {
    return (await this.api<{ url: string }>('incoming-url')).url;
  }

  /** Settings → Test Claude: is ANTHROPIC_API_KEY set up in your dialer? */
  async pingDrafts(): Promise<void> {
    await this.api('ping', {}, '/draft');
  }

  /**
   * One follow-up draft written by Claude in YOUR Twilio Function (/draft), with
   * your Anthropic key kept in Twilio. Sends the writing instructions and one
   * customer's history summary; returns the draft JSON. Never sends anything to a customer.
   */
  async draft(system: string, messages: Array<{ role: 'user' | 'assistant'; content: string }>, quality: 'fast' | 'better'): Promise<unknown> {
    const fields = { system, messages: JSON.stringify(messages), quality };
    try {
      return (await this.api<{ draft: unknown }>('draft', fields, '/draft')).draft;
    } catch (e) {
      // No answer at all (e.g. a time limit on a slow reply): try once more before giving up.
      if (!/Couldn't get an answer/.test((e as Error).message)) throw e;
      await new Promise((r) => setTimeout(r, 1500));
      return (await this.api<{ draft: unknown }>('draft', fields, '/draft')).draft;
    }
  }

  async connectAgent() {
    this.stopped = false;
    this.agentConnected = false;
    const r = await this.api<{ session: string; agentSid: string }>('start');
    this.session = r.session;
    this.agentSid = r.agentSid;
    this.emit({ type: 'AGENT', state: 'CALLING' });
    this.startPolling();
  }

  async dial(target: DialTarget) {
    if (!this.session || !this.agentSid) throw new Error('Your phone is not connected.');
    // Only the phone number leaves the extension (target.ref stays local).
    const r = await this.api<{ callSid: string }>('dial', { session: this.session, agentSid: this.agentSid, to: target.e164, voicemail: this.voicemail });
    this.callSid = r.callSid;
    this.lastCallState = null;
    return { callId: r.callSid };
  }

  async hangup(callId: string) {
    await this.api('hangup', { callSid: callId });
  }

  async endSession() {
    this.stopped = true;
    this.stopPolling();
    if (this.agentSid) await this.api('end', { session: this.session ?? '', agentSid: this.agentSid }).catch(() => undefined);
  }

  private startPolling() {
    this.stopPolling();
    this.poller = setInterval(() => void this.poll(), POLL_MS);
  }

  private stopPolling() {
    if (this.poller) clearInterval(this.poller);
    this.poller = null;
  }

  /** Exposed for tests. */
  async poll(): Promise<void> {
    if (this.stopped || !this.session || !this.agentSid) return;
    let s: TwilioStatus;
    try {
      s = await this.api<TwilioStatus>('status', {
        session: this.session,
        agentSid: this.agentSid,
        checkConference: this.agentConnected ? '0' : '1',
        ...(this.callSid ? { callSid: this.callSid } : {}),
      });
      this.failures = 0;
    } catch (e) {
      if (++this.failures >= MAX_FAILURES) {
        this.stopPolling();
        this.emit({ type: 'AGENT', state: 'FAILED', detail: `lost contact with your dialer: ${(e as Error).message}` });
      }
      return;
    }

    // My phone line.
    if (!this.agentConnected && s.agent.inConference) {
      this.agentConnected = true;
      this.emit({ type: 'AGENT', state: 'CONNECTED' });
    }
    if (['completed', 'busy', 'no-answer', 'failed', 'canceled'].includes(s.agent.status)) {
      this.stopPolling();
      this.emit({ type: 'AGENT', state: this.agentConnected ? 'ENDED' : 'FAILED', detail: this.agentConnected ? undefined : `your phone: ${s.agent.status}` });
      this.agentConnected = false;
    }

    // The customer call.
    if (this.callSid && s.call) {
      const state = mapCall(s.call.status, s.call.answeredBy, this.lastCallState);
      if (state && state !== this.lastCallState) {
        this.lastCallState = state;
        this.emit({ type: 'CALL', callId: this.callSid, state });
      }
      if (['completed', 'busy', 'no-answer', 'failed', 'canceled'].includes(s.call.status)) this.callSid = null;
    }
  }
}

/** Twilio call status + answering-machine result → dialer call state. */
export function mapCall(status: string, answeredBy: string | null, previous: CallState | null): CallState | null {
  const machine = !!answeredBy && MACHINE.test(answeredBy);
  switch (status) {
    case 'queued':
    case 'ringing':
      return 'RINGING';
    case 'in-progress':
      // Connected to me the moment they pick up; a later confident machine result hangs up.
      return machine ? 'MACHINE' : answeredBy === 'human' ? 'HUMAN' : previous === 'HUMAN' ? 'HUMAN' : 'UNKNOWN_ANSWER';
    case 'completed':
      // A call you stayed on (person, or a voicemail you left a message on) has ended.
      if (previous === 'HUMAN' || previous === 'UNKNOWN_ANSWER' || previous === 'MACHINE') return 'COMPLETED';
      return machine ? 'MACHINE' : 'NO_ANSWER';
    case 'busy':
      return 'BUSY';
    case 'no-answer':
      return 'NO_ANSWER';
    case 'canceled':
      return 'COMPLETED';
    case 'failed':
      return 'FAILED';
    default:
      return null;
  }
}
