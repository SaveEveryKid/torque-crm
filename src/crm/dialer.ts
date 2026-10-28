import { useEffect, useState } from 'react';
import { PowerDialerSession, type SessionCustomer, type SessionState } from '../core/dialer/session';
import { MockDialerProvider } from '../core/dialer/mockProvider';
import { TwilioDialerProvider } from '../core/dialer/twilioProvider';
import type { DialerProvider } from '../core/dialer/provider';
import { DISPOSITIONS, type CallLogEntry } from '../core/dialer/dispositions';
import { normalizeUsPhone } from '../core/analysis/phone';
import { appendCall } from '../core/storage/callLog';
import { recordRef } from '../core/storage/hash';
import { addTask, fullName, logActivity, setStage } from './store';
import type { Customer, Settings } from './types';

/**
 * The one dialer session for this window (switching pages doesn't hang up).
 * One call at a time, no recordings, nothing automated is ever played.
 */
let session: PowerDialerSession | null = null;
let provider: DialerProvider | null = null;
let snapshot: SessionState | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export function toSessionCustomer(c: Customer): SessionCustomer | null {
  const n = normalizeUsPhone(c.phone);
  const alt = normalizeUsPhone(c.altPhone);
  const use = n.ok ? n : alt.ok ? alt : null;
  if (!use || c.doNotContact) return null;
  return { opportunityId: c.id, name: fullName(c), e164: use.e164, phone: use.display, vehicle: c.vehicle?.title || c.interest || null, source: c.source || null, dateIn: c.createdAt, notes: c.notes || null };
}

/** Each call result goes on the customer's timeline. */
async function logResult(e: CallLogEntry) {
  if (e.result === 'SKIP') return;
  const talk = e.talkSeconds ? ` (${Math.round(e.talkSeconds / 60) || '<1'} min)` : '';
  await logActivity(e.opportunityId, { channel: 'PHONE', direction: 'OUTBOUND', outcome: DISPOSITIONS[e.result] + talk, text: e.note ?? '' });
  if (e.callbackAt) await addTask(e.opportunityId, { kind: e.result === 'CONNECTED_APPOINTMENT' ? 'appointment' : 'call', dueAt: e.callbackAt, title: e.result === 'CONNECTED_APPOINTMENT' ? 'Appointment' : 'Call back' });
  if (e.result === 'CONNECTED_APPOINTMENT') await setStage(e.opportunityId, 'appointment', 'Appointment');
}

export function startDialer(customers: Customer[], s: Settings, practice: boolean): string | null {
  if (session && !['ended', 'done', 'idle'].includes(session.state.phase)) return 'The dialer is already running.';
  const list = customers.map(toSessionCustomer).filter((c): c is SessionCustomer => !!c);
  if (!list.length) return 'Nobody to call (no valid phone numbers).';
  if (practice) provider = new MockDialerProvider({ ringMs: 4000 + Math.round(Math.random() * 3000) });
  else {
    const p = new TwilioDialerProvider(s.dialerUrl, s.dialerPassword);
    p.voicemail = s.voicemail;
    provider = p;
  }
  session = new PowerDialerSession(
    {
      provider,
      now: () => Date.now(),
      setTimer: (f, ms) => setTimeout(f, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      onChange: (st) => {
        snapshot = st;
        notify();
      },
      onLog: (e) => {
        void appendCall(e);
        void logResult(e);
      },
      refFor: (c) => recordRef(c.opportunityId),
      newId: () => crypto.randomUUID(),
    },
    list,
    // One customer (CALL on their page): dial as soon as your phone is connected.
    list.length === 1 ? 1 : s.dialDelaySeconds > 0 ? s.dialDelaySeconds : null,
    s.voicemail,
  );
  snapshot = session.state;
  notify();
  void session.start();
  return null;
}

export const getSession = () => session;
export const practiceProvider = () => (provider instanceof MockDialerProvider ? provider : null);

export function clearFinished() {
  if (session && ['ended', 'done'].includes(session.state.phase)) {
    session = null;
    snapshot = null;
    notify();
  }
}

export function useDialer(): SessionState | null {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  return snapshot;
}

addEventListener('pagehide', () => void session?.end());
