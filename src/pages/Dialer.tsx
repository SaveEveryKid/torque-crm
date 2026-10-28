import { useEffect, useMemo, useState } from 'react';
import { AFTER_CALL_CHOICES, DISPOSITIONS, type Disposition } from '../core/dialer/dispositions';
import type { SessionPhase } from '../core/dialer/session';
import { aiReady } from '../crm/ai';
import { clearFinished, getSession, practiceProvider, startDialer, toSessionCustomer, useDialer } from '../crm/dialer';
import { fullName, lastContact, openTasks, useCustomers, useSettings } from '../crm/store';
import { OPEN_STAGES, STAGES, type Customer, type Stage } from '../crm/types';
import { ago, daysFromToday, Empty, go, Icon, localInput, tomorrowAt } from '../ui/kit';

const PHASE: Record<SessionPhase, string> = {
  idle: 'Starting…',
  connecting_agent: 'Calling your cellphone — answer and press 1',
  ready: 'Ready',
  dialing: 'Dialing…',
  ringing: 'Ringing…',
  connected: 'On the line',
  wrap_up: 'Pick a result',
  countdown: 'Next call in a moment',
  paused: 'Paused',
  done: 'List finished',
  ended: 'Session ended',
};

type Who = 'followup' | 'due' | Stage | 'open';

export function Dialer() {
  const state = useDialer();
  return state && !['ended', 'done'].includes(state.phase) ? <Live /> : <Setup finished={state?.phase === 'done' || state?.phase === 'ended' ? state.message : null} />;
}

function Setup({ finished }: { finished: string | null }) {
  const customers = useCustomers();
  const settings = useSettings();
  const [who, setWho] = useState<Who>('followup');
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const real = aiReady();

  const list = useMemo(() => {
    const all = Object.values(customers).filter((c) => toSessionCustomer(c));
    const now = Date.now();
    const pick = (c: Customer) => {
      if (who === 'open') return OPEN_STAGES.includes(c.stage);
      if (who === 'due') return openTasks(c).some((t) => t.kind === 'call' && daysFromToday(t.dueAt) <= 0);
      if (who === 'followup') {
        const last = lastContact(c);
        return OPEN_STAGES.includes(c.stage) && (!last || now - new Date(last).getTime() > settings.followUpDays * 86_400_000);
      }
      return c.stage === who;
    };
    return all.filter(pick).sort((a, b) => (lastContact(a) ?? '').localeCompare(lastContact(b) ?? ''));
  }, [customers, who, settings.followUpDays]);
  const calling = list.filter((c) => !skip.has(c.id));

  const start = (practice: boolean) => {
    const err = startDialer(calling, settings, practice);
    setError(err);
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Dialer</h1>
          <p>One call at a time through your SignalWire number. Your cellphone rings first; press 1, and Torque dials each customer.</p>
        </div>
        <div className="row">
          <button className="btn" disabled={!calling.length} onClick={() => (clearFinished(), start(true))}>
            Practice
          </button>
          <button className="btn primary" disabled={!calling.length || !real} onClick={() => (clearFinished(), start(false))} title={real ? '' : 'Set up the dialer in Settings first'}>
            <Icon name="phone" size={16} /> Start calling {calling.length || ''}
          </button>
        </div>
      </div>
      {finished && <p className="notice">{finished}</p>}
      {!real && <p className="notice">Real calls need your dialer address and password in Settings. Practice mode works now.</p>}
      {error && <p className="error">{error}</p>}
      <div className="tabs">
        {(
          [
            ['followup', 'Needs follow-up'],
            ['due', 'Calls due'],
            ['open', 'All open'],
          ] as [Who, string][]
        )
          .concat(STAGES.filter((s) => OPEN_STAGES.includes(s.id)).map((s) => [s.id, s.label] as [Who, string]))
          .map(([id, label]) => (
            <button key={id} className={who === id ? 'on' : ''} onClick={() => setWho(id)}>
              {label}
            </button>
          ))}
      </div>
      <section className="card">
        {list.length === 0 ? (
          <Empty title="Nobody here">Only customers with a valid phone number (and not “do not contact”) can be called.</Empty>
        ) : (
          <div className="list">
            {list.map((c, i) => (
              <label key={c.id} className="list-item click">
                <input type="checkbox" checked={!skip.has(c.id)} onChange={(e) => setSkip((s) => (e.target.checked ? (s.delete(c.id), new Set(s)) : new Set(s).add(c.id)))} />
                <span className="muted small" style={{ width: 22 }}>
                  {i + 1}
                </span>
                <div className="grow">
                  <div className="title">{fullName(c)}</div>
                  <div className="muted small">
                    {c.phone} · {c.vehicle?.title || c.interest || 'no vehicle'}
                  </div>
                </div>
                <span className="when">last contact {ago(lastContact(c))}</span>
              </label>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Live() {
  const s = useDialer()!;
  const customers = useCustomers();
  const session = getSession()!;
  const [note, setNote] = useState('');
  const [result, setResult] = useState<Disposition | null>(null);
  const [at, setAt] = useState(localInput(tomorrowAt(10)));
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    setNote('');
    setResult(s.onVoicemail ? 'VOICEMAIL' : null);
  }, [s.current?.opportunityId, s.phase === 'wrap_up', s.onVoicemail]); // eslint-disable-line react-hooks/exhaustive-deps

  const c = s.current ? customers[s.current.opportunityId] : null;
  const upcoming = s.pending.slice(0, 8);
  const needsTime = result === 'CALL_BACK_LATER' || result === 'CONNECTED_APPOINTMENT';
  const talk = s.connectedAt ? Math.round((Date.now() - s.connectedAt) / 1000) : 0;
  const countdown = s.countdownEndsAt ? Math.max(0, Math.ceil((s.countdownEndsAt - Date.now()) / 1000)) : 0;
  const practice = practiceProvider();

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Dialer</h1>
          <p>
            {s.completed} of {s.total} done{practice ? ' · practice mode (no real calls)' : ''}
          </p>
        </div>
        <div className="row">
          {s.phase === 'paused' ? (
            <button className="btn" onClick={() => session.resume()}>
              Resume
            </button>
          ) : (
            <button className="btn" onClick={() => session.pause()} disabled={s.pauseRequested}>
              {s.pauseRequested ? 'Pausing after this call' : 'Pause'}
            </button>
          )}
          <button className="btn danger" onClick={() => void session.end()}>
            End session
          </button>
        </div>
      </div>

      <div className="grid side">
        <section className="card dialer-now">
          <div className="phase">
            <span className={`pulse${s.phase === 'connected' ? ' live' : s.phase === 'ringing' || s.phase === 'dialing' ? ' ring' : ''}`} />
            {s.onVoicemail ? 'Voicemail — leave your message, then hang up' : PHASE[s.phase]}
            {s.phase === 'connected' && <span className="muted">{`${Math.floor(talk / 60)}:${String(talk % 60).padStart(2, '0')}`}</span>}
            {s.phase === 'countdown' && <span className="muted">{countdown}s</span>}
          </div>
          {s.message && <p className="soft">{s.message}</p>}
          {s.lastEvent && <p className="muted small">{s.lastEvent}</p>}

          {s.current ? (
            <>
              <div>
                <div className="big-name">{s.current.name}</div>
                <div className="soft">
                  {s.current.phone}
                  {s.current.vehicle ? ` · ${s.current.vehicle}` : ''}
                </div>
              </div>
              {c && (
                <div className="stack tight">
                  {c.notes && <p className="why">{c.notes}</p>}
                  {c.activities.slice(0, 3).map((a) => (
                    <p key={a.id} className="small soft">
                      <strong>{a.direction === 'INBOUND' ? c.firstName || 'They' : a.direction === 'OUTBOUND' ? 'You' : 'Note'}</strong> ({ago(a.at)}): {a.text || a.outcome}
                    </p>
                  ))}
                  <button className="link small" style={{ alignSelf: 'flex-start' }} onClick={() => go(`customers/${c.id}`)}>
                    Open customer
                  </button>
                </div>
              )}
            </>
          ) : (
            s.pending[0] && <p className="soft">Next: {s.pending[0].name}</p>
          )}

          <div className="row">
            {s.phase === 'connected' && (
              <button className="btn danger" onClick={() => void session.hangUp()}>
                Hang up
              </button>
            )}
            {(s.phase === 'ringing' || s.phase === 'countdown' || s.phase === 'ready') && (
              <button className="btn primary" onClick={() => void session.next()}>
                {s.phase === 'ringing' ? 'Stop ringing, next' : 'Call next now'}
              </button>
            )}
            {['countdown', 'ready', 'paused'].includes(s.phase) && s.pending.length > 0 && (
              <button className="btn" onClick={() => session.skipUpcoming()}>
                Skip {s.pending[0].name.split(' ')[0]}
              </button>
            )}
            {practice && s.phase === 'connected' && (
              <button className="btn ghost" onClick={() => practice.customerHangsUp()}>
                (practice) customer hangs up
              </button>
            )}
          </div>

          {s.phase === 'wrap_up' && (
            <div className="stack">
              <h3>How did it go?</h3>
              <div className="results">
                {AFTER_CALL_CHOICES.map((d) => (
                  <button key={d} className={`chip${result === d ? ' on' : ''}`} onClick={() => setResult(d)}>
                    {DISPOSITIONS[d]}
                  </button>
                ))}
              </div>
              {needsTime && (
                <label className="field">
                  {result === 'CONNECTED_APPOINTMENT' ? 'Appointment time' : 'Call back at'}
                  <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
                </label>
              )}
              <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Notes from the call (go on their timeline)" />
              <button className="btn primary" disabled={!result} onClick={() => result && session.disposition(result, note.trim() || null, needsTime ? new Date(at).toISOString() : null)}>
                Save and continue
              </button>
            </div>
          )}
        </section>

        <section className="card">
          <div className="card-head">
            <h2>Up next</h2>
            <span className="sub">{s.pending.length} left</span>
          </div>
          {upcoming.length === 0 ? (
            <p className="card-pad muted small">That's everyone.</p>
          ) : (
            <div className="list">
              {upcoming.map((p) => (
                <div key={p.opportunityId} className="list-item">
                  <div className="grow">
                    <div className="title">{p.name}</div>
                    <div className="muted small">{p.vehicle ?? p.phone}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
