import { useState } from 'react';
import type { DraftResult } from '../core/ai/followUp';
import { LIST_TYPES, type ListType } from '../core/analysis/customList';
import { situationFor } from '../core/analysis/situation';
import { recordSent } from '../core/storage/sentLog';
import { EDIT_REASONS, recordEdit, setReasons } from '../core/storage/styleMemory';
import { aiReady, draftFor, maybeProposeProfile, replyFor } from '../crm/ai';
import { toRecord } from '../crm/record';
import { logActivity, useSettings } from '../crm/store';
import { smsReady } from '../crm/server';
import { quietHours, sendText } from '../crm/sms';
import type { Customer } from '../crm/types';
import { copy, go, Icon } from './kit';

/**
 * CLAUDE, for this customer: a follow-up (text + email) or a reply to what
 * they just said. You edit, copy and send it yourself, then MARK SENT so it's
 * on the timeline and Claude learns from what you changed.
 */
export function DraftPanel({ customer: c }: { customer: Customer }) {
  const settings = useSettings();
  const [type, setType] = useState<ListType | ''>('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'draft' | 'reply' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [res, setRes] = useState<DraftResult | null>(null);
  const [text, setText] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [reply, setReply] = useState<{ ai: string; gate: string; hold: boolean; note: string | null } | null>(null);
  const [edited, setEdited] = useState<string[]>([]);
  const [reasons, setReasonsOn] = useState<string[]>([]);
  const [done, setDone] = useState<string | null>(null);

  const latest = c.activities.find((a) => a.direction !== 'INTERNAL');
  const theyWroteLast = latest?.direction === 'INBOUND' && (latest.channel === 'TEXT' || latest.channel === 'EMAIL') && !!latest.text;

  if (!aiReady())
    return (
      <section className="card card-pad stack">
        <h2>
          <Icon name="sparkle" /> Claude
        </h2>
        <p className="soft small">Claude writes follow-ups in your voice, through your Torque dialer. Add the dialer address and password in Settings to turn it on.</p>
        <button className="btn" onClick={() => go('settings')}>
          Open Settings
        </button>
      </section>
    );

  const run = async (kind: 'draft' | 'reply') => {
    setBusy(kind);
    setError(null);
    setDone(null);
    setEdited([]);
    try {
      if (kind === 'draft') {
        setReply(null);
        const r = await draftFor(c, settings, { listType: type || null, note });
        setRes(r);
        setText(r.draft.text ?? '');
        setSubject(r.draft.emailSubject ?? '');
        setBody(r.draft.emailBody ?? '');
      } else {
        setRes(null);
        const thread = c.activities
          .filter((a) => (a.channel === 'TEXT' || a.channel === 'EMAIL') && a.text && a.direction !== 'INTERNAL')
          .slice(0, 12)
          .reverse()
          .map((a) => `${a.direction === 'INBOUND' ? c.firstName || 'Customer' : 'Me'}: ${a.text}`)
          .join('\n');
        const r = await replyFor(c, settings, thread);
        setReply({ ai: r.suggestion.reply ?? '', gate: r.suggestion.gate, hold: r.suggestion.hold, note: r.suggestion.note });
        setText(r.suggestion.reply ?? '');
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  /** viaSms: send the text now through your SignalWire number (otherwise you sent it yourself). */
  const markSent = async (kind: 'text' | 'email', viaSms = false) => {
    const ai = kind === 'text' ? (reply ? reply.ai : res?.draft.text) : res?.draft.emailBody;
    const sent = kind === 'text' ? text : body;
    if (!sent.trim()) return;
    if (viaSms) {
      if (quietHours() && !confirm("It's outside 8 AM–9 PM. Send anyway?")) return;
      setError(null);
      try {
        await sendText(c, sent.trim());
      } catch (e) {
        return setError((e as Error).message);
      }
    }
    const situation = situationFor(toRecord(c, settings.name));
    const id = await recordEdit(reply ? 'reply' : kind, ai, sent, c.firstName, new Date(), situation);
    await recordSent(c.id, { at: new Date().toISOString(), kind, subject: kind === 'email' ? subject : null, body: sent, source: reply ? 'reply' : 'followup' });
    if (!viaSms) await logActivity(c.id, { channel: kind === 'text' ? 'TEXT' : 'EMAIL', direction: 'OUTBOUND', outcome: kind === 'email' && subject ? `Subject: ${subject}` : null, text: sent });
    if (id) setEdited((x) => [...x, id]);
    setDone(viaSms ? 'Text sent.' : kind === 'text' ? 'Text logged.' : 'Email logged.');
    void maybeProposeProfile(settings).catch(() => undefined);
  };

  const saveReasons = async (r: string[]) => {
    setReasonsOn(r);
    await setReasons(edited, r, '');
  };

  return (
    <section className="card">
      <div className="card-head">
        <h2 className="row">
          <Icon name="sparkle" /> Claude
        </h2>
        {theyWroteLast && (
          <button className="btn sm" disabled={!!busy} onClick={() => void run('reply')}>
            {busy === 'reply' ? 'Thinking…' : 'Reply to their message'}
          </button>
        )}
      </div>
      <div className="card-pad draft">
        <div className="row">
          <select value={type} onChange={(e) => setType(e.target.value as ListType | '')} className="grow" aria-label="Kind of follow-up">
            <option value="">Regular follow-up</option>
            {Object.entries(LIST_TYPES).map(([k, t]) => (
              <option key={k} value={k}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything Claude should know for this one? (optional)" />
        <button className="btn primary" disabled={!!busy || c.doNotContact} onClick={() => void run('draft')}>
          {busy === 'draft' ? 'Writing…' : res ? 'Write another' : 'Write a follow-up'}
        </button>
        {c.doNotContact && <p className="muted small">Marked “do not contact”.</p>}
        {error && <p className="error">{error}</p>}

        {reply && (
          <>
            <p className="why">{reply.gate}</p>
            {reply.hold && <p className="notice">Claude suggests holding off: {reply.note}</p>}
            {!reply.hold && reply.note && <p className="notice">{reply.note}</p>}
          </>
        )}
        {res && (
          <>
            <p className="why">{res.draft.why}</p>
            {res.draft.skip && <p className="notice">Not needed today: {res.draft.skipReason}</p>}
            {res.warnings.length > 0 && <p className="small muted">Check: {res.warnings.join('; ')}</p>}
          </>
        )}
        {(reply || (res && !res.draft.skip && res.draft.text !== null)) && (
          <div className="stack tight">
            <h3>Text</h3>
            <textarea value={text} onChange={(e) => setText(e.target.value)} />
            <div className="row">
              <span className="muted small grow">{text.length} characters</span>
              <button className="btn sm" onClick={() => void copy(text)}>
                <Icon name="copy" size={14} /> Copy
              </button>
              <button className="btn sm" onClick={() => void markSent('text')} title="You sent it yourself: put it on the timeline">
                <Icon name="check" size={14} /> Mark sent
              </button>
              {smsReady() && !c.doNotText && (
                <button className="btn sm primary" onClick={() => void markSent('text', true)}>
                  <Icon name="text" size={14} /> Send text
                </button>
              )}
            </div>
          </div>
        )}
        {res && !res.draft.skip && res.draft.emailBody !== null && (
          <div className="stack tight">
            <h3>Email</h3>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} aria-label="Subject" />
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={6} />
            <div className="row">
              <span className="grow" />
              {c.email && (
                <a className="btn sm" href={`mailto:${c.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`}>
                  <Icon name="mail" size={14} /> Open in email
                </a>
              )}
              <button className="btn sm" onClick={() => void copy(`${body}`)}>
                <Icon name="copy" size={14} /> Copy
              </button>
              <button className="btn sm green" onClick={() => void markSent('email')}>
                <Icon name="check" size={14} /> Mark sent
              </button>
            </div>
          </div>
        )}
        {done && <p className="success">{done}</p>}
        {edited.length > 0 && (
          <div className="stack tight">
            <p className="small soft">You changed Claude's wording. Why? (teaches it)</p>
            <div className="chips">
              {EDIT_REASONS.map((r) => (
                <button key={r} className={`chip${reasons.includes(r) ? ' on' : ''}`} onClick={() => void saveReasons(reasons.includes(r) ? reasons.filter((x) => x !== r) : [...reasons, r])}>
                  {r}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
