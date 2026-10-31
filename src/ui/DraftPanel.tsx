import { useEffect, useState } from 'react';
import type { DraftResult } from '../core/ai/followUp';
import { LIST_TYPES, type ListType } from '../core/analysis/customList';
import { situationFor } from '../core/analysis/situation';
import { recordSent } from '../core/storage/sentLog';
import { EDIT_REASONS, recordDenial, recordEdit, setReasons } from '../core/storage/styleMemory';
import { setDraftStatus, type PreDraft } from '../crm/predraft';
import { aiReady, draftFor, maybeProposeProfile, replyFor } from '../crm/ai';
import { toRecord } from '../crm/record';
import { logActivity, useSettings } from '../crm/store';
import { smsReady } from '../crm/server';
import { quietHours, sendText } from '../crm/sms';
import type { Customer } from '../crm/types';
import { openCompose } from '../crm/email';
import { copy, go, Icon } from './kit';

/**
 * CLAUDE, for this customer: a follow-up (text + email) or a reply to what
 * they just said. You edit, copy and send it yourself, then MARK SENT so it's
 * on the timeline and Claude learns from what you changed.
 */
export function DraftPanel({
  customer: c,
  shared,
  onLogged,
  pre,
  onDecided,
}: {
  customer: Customer;
  /** Kind of follow-up + note kept from one customer to the next (AI Follow-up). */
  shared?: { type: ListType | ''; note: string; set: (p: { type?: ListType | ''; note?: string }) => void };
  /** After a text or email is sent or logged. */
  onLogged?: () => void;
  /** A draft Claude wrote ahead of time (Pre-draft), ready to review. */
  pre?: PreDraft;
  /** You approved (sent / opened in Outlook) or denied the draft; `edited` when you changed it first. */
  onDecided?: (outcome: 'sent' | 'denied', edited: boolean) => void;
}) {
  const settings = useSettings();
  const [ownType, setOwnType] = useState<ListType | ''>('');
  const [ownNote, setOwnNote] = useState('');
  const type = shared ? shared.type : ownType;
  const note = shared ? shared.note : ownNote;
  const setType = (t: ListType | '') => (shared ? shared.set({ type: t }) : setOwnType(t));
  const setNote = (n: string) => (shared ? shared.set({ note: n }) : setOwnNote(n));
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
  const [denying, setDenying] = useState(false);
  const [denyWhy, setDenyWhy] = useState<string[]>([]);
  const [denyNote, setDenyNote] = useState('');

  // A pre-written draft (from Pre-draft) loads ready to review, unless you already started one.
  useEffect(() => {
    if (!pre || pre.status !== 'ready' || res || reply) return;
    setRes({ draft: { skip: false, skipReason: null, text: pre.text || null, emailSubject: pre.subject, emailBody: pre.body, why: pre.why }, warnings: pre.warnings, attempts: 1 });
    setText(pre.text);
    setSubject(pre.subject);
    setBody(pre.body);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pre?.at, pre?.status]);

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
  const markSent = async (kind: 'text' | 'email', viaSms = false, outlook = false) => {
    const ai = kind === 'text' ? (reply ? reply.ai : res?.draft.text) : res?.draft.emailBody;
    const sent = kind === 'text' ? text : body;
    if (!sent.trim()) return;
    if (outlook) openCompose({ to: c.email, subject, body: sent }, settings);
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
    onLogged?.();
    if (pre?.status === 'ready') await setDraftStatus(c.id, 'sent');
    onDecided?.('sent', !!id);
    setDone(viaSms ? 'Text sent.' : outlook ? 'Opened in Outlook and saved to the timeline. Press Send in Outlook.' : kind === 'text' ? 'Text logged.' : 'Email logged.');
    void maybeProposeProfile(settings).catch(() => undefined);
  };

  /** Throw the draft out; why you did teaches Claude as much as an edit. */
  const deny = async () => {
    const situation = situationFor(toRecord(c, settings.name));
    const ai = res?.draft.emailBody || res?.draft.text;
    await recordDenial(res?.draft.emailBody ? 'email' : 'text', ai, c.firstName, denyWhy, denyNote, new Date(), situation);
    if (pre) await setDraftStatus(c.id, 'denied');
    setDenying(false);
    setRes(null);
    setDone('Denied. Claude will learn from it.');
    void maybeProposeProfile(settings).catch(() => undefined);
    onDecided?.('denied', false);
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
            {pre?.status === 'ready' && (
              <p className="small soft">
                Pre-drafted as <strong>{pre.type ? LIST_TYPES[pre.type].label : 'Regular follow-up'}</strong>. Approve, edit, or deny it below.
              </p>
            )}
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
                <button className="btn sm primary" onClick={() => void markSent('email', false, true)} title="Opens it in Outlook and saves it to the timeline">
                  <Icon name="mail" size={14} /> {pre?.status === 'ready' ? 'Approve · open in Outlook' : 'Open in Outlook'}
                </button>
              )}
              <button className="btn sm" onClick={() => void copy(`${body}`)}>
                <Icon name="copy" size={14} /> Copy
              </button>
              <button className="btn sm" onClick={() => void markSent('email')} title="Sent it another way: just save it to the timeline">
                <Icon name="check" size={14} /> Mark sent
              </button>
              <button className="btn sm ghost danger" onClick={() => setDenying((x) => !x)} title="Throw this draft out (teaches Claude)">
                <Icon name="x" size={14} /> Deny
              </button>
            </div>
          </div>
        )}
        {denying && res && (
          <div className="stack tight deny">
            <p className="small soft">What was wrong with it? (teaches Claude)</p>
            <div className="chips">
              {[...EDIT_REASONS, 'Wrong person / not a fit', 'Not the right time'].map((r) => (
                <button key={r} className={`chip${denyWhy.includes(r) ? ' on' : ''}`} onClick={() => setDenyWhy((x) => (x.includes(r) ? x.filter((y) => y !== r) : [...x, r]))}>
                  {r}
                </button>
              ))}
            </div>
            <input value={denyNote} onChange={(e) => setDenyNote(e.target.value)} placeholder="Anything else? (optional)" />
            <div className="row">
              <button className="btn sm" onClick={() => setDenying(false)}>
                Cancel
              </button>
              <button className="btn sm danger" onClick={() => void deny()}>
                Deny draft
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
