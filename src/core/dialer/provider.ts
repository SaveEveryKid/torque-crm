/**
 * Telephony provider abstraction. The power dialer talks only to this
 * interface; implementations: MockDialerProvider (practice mode) and the
 * Twilio provider (via the dialer backend). A provider has no access to eLead.
 *
 * Only the customer's phone number (E.164) and an opaque reference leave the
 * extension through a provider.
 */
export type AgentState = 'CALLING' | 'CONNECTED' | 'ENDED' | 'FAILED';

/** Outcomes the provider can report for a customer call. */
export type CallState =
  | 'RINGING'
  | 'HUMAN' // a person answered (bridged to the agent)
  | 'UNKNOWN_ANSWER' // answered, machine detection unsure: treated as a person
  | 'MACHINE' // confident voicemail / answering machine
  | 'NO_ANSWER'
  | 'BUSY'
  | 'FAILED'
  | 'INVALID' // number not in service / invalid
  | 'COMPLETED'; // the call has ended

export type DialerEvent =
  | { type: 'AGENT'; state: AgentState; detail?: string }
  | { type: 'CALL'; callId: string; state: CallState; detail?: string };

export interface DialTarget {
  /** E.164, e.g. +17316138558 */
  e164: string;
  /** Opaque reference (hashed), never a name. */
  ref: string;
}

export interface DialerProvider {
  readonly name: string;
  /** Call the agent's (my) cellphone and hold that line for the session. */
  connectAgent(): Promise<void>;
  /** Dial ONE customer and bridge them to the agent if a person answers. */
  dial(target: DialTarget): Promise<{ callId: string }>;
  /** Hang up a customer call (used for voicemail / giving up while ringing). Never plays anything. */
  hangup(callId: string): Promise<void>;
  /** End the session: hang up the agent line. */
  endSession(): Promise<void>;
  /** Subscribe to agent/call events. Returns an unsubscribe function. */
  onEvent(listener: (e: DialerEvent) => void): () => void;
}
