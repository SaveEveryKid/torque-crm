import { useEffect, useMemo, useRef, useState } from 'react';
import { recordEdit } from '../core/storage/styleMemory';
import { recordSent } from '../core/storage/sentLog';
import { aiReady, replyFor } from '../crm/ai';
import { loadStatus, smsReady, smsSetup } from '../crm/server';
import { quietHours, sendText, statusLabel, unreadCount, useSms, type SmsMap } from '../crm/sms';
import { fullName, updateCustomer, useCustomers, useSettings } from '../crm/store';
import type { Customer } from '../crm/types';
import { Avatar, Empty, go, Icon, when } from '../ui/kit';

/** All your text conversations, newest first, with a reply box. */
export function Texts({ id }: { id?: string }) {
  const customers = useCustomers();
  const sms = useSms();
  const threads = useMemo(
    () =>
      Object.values(customers)
        .map((c) => ({ c, last: c.activities.find((a) => a.channel === 'TEXT' && a.direction !== 'INTERNAL') }))
        .filter((t) => t.last)
        .sort((a, b) => b.last!.at.localeCompare(a.last!.at)),
    [customers],
  );
  const open = id ? customers[id] : threads[0]?.c;
  // Re-check the texting setup each time Texts opens (settings added on Cloudflare show up without a reload).
  const [, setChecked] = useState(0);
  useEffect(() => void loadStatus().then(() => setChecked((n) => n + 1)), []);
  const missing = smsSetup().missing ?? [];
  const [perm, setPerm] = useState(typeof Notification === 'undefined' ? 'denied' : Notification.permission);

  return (
    <div className="page" style={{ maxWidth: 1200 }}>
      <div className="page-head">
        <div>
          <h1>Texts</h1>
          <p>{smsReady() ? 'Texts to and from your SignalWire number.' : `Texting isn’t set up yet${missing.length ? `: missing ${missing.join(', ')} on the torque-crm Worker in Cloudflare` : ''}. See Settings → Texting.`}</p>
        </div>
        {perm === 'default' && (
          <button className="btn" onClick={() => void Notification.requestPermission().then(setPerm)}>
            Notify me of new texts
          </button>
        )}
      </div>
      <section className="card inbox">
        <div className="threads">
          {threads.length === 0 ? (
            <Empty title="No texts yet">Text a customer from their page, or here once a conversation starts.</Empty>
          ) : (
            threads.map(({ c, last }) => {
              const unread = unreadCount(c, sms);
              return (
                <div key={c.id} className={`thread-item${open?.id === c.id ? ' on' : ''}${unread ? ' unread' : ''}`} onClick={() => go(`texts/${c.id}`)}>
                  <Avatar first={c.firstName} last={c.lastName} />
                  <div className="grow">
                    <div className="row between">
                      <span className="name">{fullName(c)}</span>
                      <span className="muted small">{when(last!.at).replace(/, .*$/, '')}</span>
                    </div>
                    <div className="preview">
                      {last!.direction === 'OUTBOUND' ? 'You: ' : ''}
                      {last!.text}
                    </div>
                  </div>
                  {unread > 0 && <span className="dot-unread" />}
                </div>
              );
            })
          )}
        </div>
        {open ? <Conversation key={open.id} c={open} sms={sms} /> : <Empty title="Pick a conversation" />}
      </section>
    </div>
  );
}

function Conversation({ c, sms }: { c: Customer; sms: SmsMap }) {
  const settings = useSettings();
  const [text, setText] = useState('');
  const [ai, setAi] = useState<string | null>(null);
  const [busy, setBusy] = useState<'send' | 'ai' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const msgs = c.activities.filter((a) => a.channel === 'TEXT' && a.direction !== 'INTERNAL').reverse();
  const unread = unreadCount(c, sms);
  const lastIn = [...msgs].reverse().find((m) => m.direction === 'INBOUND');
  const theyWroteLast = msgs.at(-1)?.direction === 'INBOUND';

  useEffect(() => {
    // Braces: newer browsers return a promise from scrollIntoView, which React would take for a cleanup.
    end.current?.scrollIntoView({ block: 'end' });
  }, [msgs.length]);
  useEffect(() => {
    if (unread) void updateCustomer(c.id, { textsReadAt: new Date().toISOString() });
  }, [unread, c.id]);

  const send = async () => {
    if (quietHours() && !confirm("It's outside 8 AM–9 PM. Send anyway?")) return;
    setBusy('send');
    setError(null);
    try {
      await sendText(c, text.trim());
      if (ai) await recordEdit('reply', ai, text.trim(), c.firstName);
      await recordSent(c.id, { at: new Date().toISOString(), kind: 'text', body: text.trim(), source: ai ? 'reply' : 'followup' });
      setText('');
      setAi(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const suggest = async () => {
    setBusy('ai');
    setError(null);
    setNote(null);
    try {
      const thread = msgs
        .slice(-12)
        .map((m) => `${m.direction === 'INBOUND' ? c.firstName || 'Customer' : 'Me'}: ${m.text}`)
        .join('\n');
      const r = await replyFor(c, settings, thread);
      setAi(r.suggestion.reply ?? '');
      setText(r.suggestion.reply ?? '');
      setNote([r.suggestion.gate, r.suggestion.hold ? `Claude suggests holding off: ${r.suggestion.note}` : r.suggestion.note].filter(Boolean).join(' · '));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const blocked = c.doNotText || c.doNotContact;
  return (
    <div className="convo">
      <div className="card-head">
        <div className="who">
          <Avatar first={c.firstName} last={c.lastName} />
          <div>
            <div className="name">{fullName(c)}</div>
            <div className="line">{c.phone}</div>
          </div>
        </div>
        <button className="btn sm" onClick={() => go(`customers/${c.id}`)}>
          Open customer
        </button>
      </div>
      <div className="messages">
        {msgs.map((m) => {
          const s = sms[m.id];
          const st = s ? statusLabel(s) : null;
          const out = m.direction === 'OUTBOUND';
          return (
            <div key={m.id} style={{ display: 'contents' }}>
              <div className={`msg ${out ? 'out' : 'in'}`}>{m.text}</div>
              <div className={`msg-meta${out ? ' out' : ''}${st?.bad ? ' bad' : ''}`}>
                {when(m.at)}
                {st?.text ? ` · ${st.text}` : !s && out ? ' · logged' : ''}
              </div>
            </div>
          );
        })}
        <div ref={end} />
      </div>
      <div className="reply">
        {blocked ? (
          <p className="notice">{fullName(c)} is marked do not text.</p>
        ) : (
          <>
            {note && <p className="why">{note}</p>}
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={smsReady() ? `Text ${c.firstName || 'them'}…` : 'Texting isn’t set up yet (Settings → Texting).'}
              onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && text.trim() && void send()}
            />
            <div className="row">
              {aiReady() && theyWroteLast && lastIn && (
                <button className="btn sm" disabled={!!busy} onClick={() => void suggest()}>
                  <Icon name="sparkle" size={14} /> {busy === 'ai' ? 'Thinking…' : 'Claude, suggest a reply'}
                </button>
              )}
              <span className="grow muted small">{text.length ? `${text.length} characters` : ''}</span>
              <button className="btn primary sm" disabled={!text.trim() || !!busy || !smsReady()} onClick={() => void send()}>
                {busy === 'send' ? 'Sending…' : 'Send text'}
              </button>
            </div>
          </>
        )}
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}
