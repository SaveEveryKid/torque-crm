import { useEffect, useState } from 'react';
import { APPOINTMENT_TEXT_LABEL, type AppointmentTextKind } from '../core/ai/appointmentTexts';
import { aiReady, appointmentTextFor } from '../crm/ai';
import { startDialer } from '../crm/dialer';
import { money } from '../crm/inventory';
import {
  addTask,
  deleteActivity,
  deleteCustomer,
  deleteTask,
  fullName,
  logActivity,
  setStage,
  updateCustomer,
  updateTask,
  useCustomers,
  useSettings,
} from '../crm/store';
import { STAGES, STAGE_LABEL, TASK_LABEL, type Activity, type Customer, type Stage, type Task, type TaskKind } from '../crm/types';
import { CustomerForm } from '../ui/CustomerForm';
import { DraftPanel } from '../ui/DraftPanel';
import { smsReady } from '../crm/server';
import { quietHours, sendText, statusLabel, unreadCount, useSms } from '../crm/sms';
import { InventoryPicker } from './Inventory';
import { Avatar, copy, daysFromToday, Empty, go, Icon, localInput, Modal, tomorrowAt, when } from '../ui/kit';

export function CustomerPage({ id }: { id: string }) {
  const customers = useCustomers();
  const settings = useSettings();
  const c = customers[id];
  const [editing, setEditing] = useState(false);
  const [picking, setPicking] = useState(false);
  const [callError, setCallError] = useState<string | null>(null);
  const sms = useSms();
  // Opening a customer marks their texts as read.
  useEffect(() => {
    if (c && unreadCount(c, sms)) void updateCustomer(c.id, { textsReadAt: new Date().toISOString() });
  }, [c, sms]);

  if (!c)
    return (
      <div className="page">
        <Empty title="Customer not found">
          <button className="link" onClick={() => go('customers')}>
            Back to customers
          </button>
        </Empty>
      </div>
    );

  const call = () => {
    const practice = !aiReady();
    const err = startDialer([c], settings, practice);
    if (err) return setCallError(err);
    go('dialer');
  };

  return (
    <div className="page">
      <div className="row">
        <button className="btn ghost sm" onClick={() => history.back()}>
          <Icon name="back" size={16} /> Back
        </button>
      </div>
      <section className="card card-pad">
        <div className="row between">
          <div className="profile">
            <Avatar first={c.firstName} last={c.lastName} lg />
            <div className="stack tight">
              <h1>{fullName(c)}</h1>
              <div className="row soft">
                {c.phone && <span>{c.phone}</span>}
                {c.email && <span>· {c.email}</span>}
                {c.doNotText && <span className="badge warn">Do not text</span>}
                {c.doNotContact && <span className="badge warn">Do not contact</span>}
              </div>
            </div>
          </div>
          <div className="row">
            <select value={c.stage} onChange={(e) => void setStage(c.id, e.target.value as Stage, STAGE_LABEL[e.target.value as Stage])} aria-label="Stage">
              {STAGES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
            <button className="btn primary" disabled={!c.phone || c.doNotContact} onClick={call} title={aiReady() ? 'Call through your dialer' : 'Practice call (set up the dialer in Settings for real calls)'}>
              <Icon name="phone" size={16} /> Call
            </button>
            {c.email && (
              <a className="btn" href={`mailto:${c.email}`}>
                <Icon name="mail" size={16} /> Email
              </a>
            )}
            <button className="btn" onClick={() => setEditing(true)}>
              Edit
            </button>
          </div>
        </div>
        {callError && <p className="error" style={{ marginTop: 12 }}>{callError}</p>}
      </section>

      <div className="grid side">
        <div className="stack">
          <section className="card">
            <div className="card-head">
              <h2>Activity</h2>
              <span className="sub">{c.activities.length} entries</span>
            </div>
            <Composer customer={c} />
            <Timeline customer={c} />
          </section>
        </div>

        <div className="stack">
          <DraftPanel customer={c} />
          <Tasks customer={c} />
          <section className="card">
            <div className="card-head">
              <h2>Vehicle</h2>
              <button className="btn sm" onClick={() => setPicking(true)}>
                {c.vehicle ? 'Change' : 'Pick from inventory'}
              </button>
            </div>
            <div className="card-pad stack">
              {c.vehicle ? (
                <div className="vehicle">
                  {c.vehicle.image ? <img src={c.vehicle.image} alt="" /> : null}
                  <div className="stack tight" style={{ minWidth: 0 }}>
                    <strong>{c.vehicle.title}</strong>
                    <span className="soft small">
                      {money(c.vehicle.price)}
                      {c.vehicle.stock ? ` · Stock ${c.vehicle.stock}` : ''}
                    </span>
                    <div className="row">
                      {c.vehicle.url && (
                        <a href={c.vehicle.url} target="_blank" rel="noreferrer" className="small">
                          View on website <Icon name="external" size={12} />
                        </a>
                      )}
                      {c.vehicle.url && (
                        <button className="link small" onClick={() => void copy(c.vehicle!.url!)}>
                          Copy link
                        </button>
                      )}
                      <button className="link small" onClick={() => void updateCustomer(c.id, { vehicle: null })}>
                        Remove
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="muted small">{c.interest ? `Looking for: ${c.interest}` : 'Nothing picked yet.'}</p>
              )}
            </div>
          </section>
          <section className="card card-pad">
            <h3>Details</h3>
            <dl className="facts">
              <dt>Looking for</dt>
              <dd>{c.interest || '—'}</dd>
              <dt>Trade</dt>
              <dd>{c.trade || '—'}</dd>
              <dt>Other phone</dt>
              <dd>{c.altPhone || '—'}</dd>
              <dt>Source</dt>
              <dd>{c.source || '—'}</dd>
              <dt>Address</dt>
              <dd>{c.address || '—'}</dd>
              <dt>Added</dt>
              <dd>{new Date(c.createdAt).toLocaleDateString()}</dd>
              <dt>Notes</dt>
              <dd style={{ whiteSpace: 'pre-wrap' }}>{c.notes || '—'}</dd>
            </dl>
            <button
              className="btn ghost sm danger"
              style={{ marginTop: 14 }}
              onClick={() => {
                if (confirm(`Delete ${fullName(c)} and their whole history? This can't be undone (unless you have a backup).`)) {
                  void deleteCustomer(c.id);
                  go('customers');
                }
              }}
            >
              <Icon name="trash" size={14} /> Delete customer
            </button>
          </section>
        </div>
      </div>

      {editing && <CustomerForm customer={c} onClose={() => setEditing(false)} />}
      {picking && (
        <InventoryPicker
          onClose={() => setPicking(false)}
          onPick={(v) => {
            void updateCustomer(c.id, { vehicle: v });
            void logActivity(c.id, { channel: 'NOTE', direction: 'INTERNAL', outcome: 'Vehicle', text: `Showing ${v.title}${v.stock ? ` (stock ${v.stock})` : ''}` });
            setPicking(false);
          }}
        />
      )}
    </div>
  );
}

/* ---------- log something ---------- */
type Kind = 'NOTE' | 'TEXT' | 'PHONE' | 'EMAIL' | 'VISIT';
const KINDS: { id: Kind; label: string; icon: string }[] = [
  { id: 'NOTE', label: 'Note', icon: 'note' },
  { id: 'TEXT', label: 'Text', icon: 'text' },
  { id: 'PHONE', label: 'Call', icon: 'phone' },
  { id: 'EMAIL', label: 'Email', icon: 'mail' },
  { id: 'VISIT', label: 'Visit', icon: 'walk' },
];
const CALL_OUTCOMES = ['Talked', 'Left voicemail', 'No answer', 'Wrong number'];

function Composer({ customer: c }: { customer: Customer }) {
  const [kind, setKind] = useState<Kind>('NOTE');
  const [dir, setDir] = useState<'OUTBOUND' | 'INBOUND'>('OUTBOUND');
  const [outcome, setOutcome] = useState(CALL_OUTCOMES[0]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const two = kind === 'TEXT' || kind === 'EMAIL' || kind === 'PHONE';
  // Text tab, "I sent": send it for real through your SignalWire number.
  const canSend = kind === 'TEXT' && dir === 'OUTBOUND' && smsReady() && !c.doNotText && !c.doNotContact;

  const send = async () => {
    if (!text.trim()) return;
    if (quietHours() && !confirm("It's outside 8 AM–9 PM. Send anyway?")) return;
    setSending(true);
    setError(null);
    try {
      await sendText(c, text.trim());
      setText('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  const save = async () => {
    if (!text.trim() && kind !== 'PHONE' && kind !== 'VISIT') return;
    await logActivity(c.id, {
      channel: kind === 'VISIT' ? 'APPOINTMENT' : kind,
      direction: kind === 'NOTE' ? 'INTERNAL' : kind === 'VISIT' ? 'INBOUND' : dir,
      outcome: kind === 'PHONE' ? outcome : kind === 'VISIT' ? 'Showroom visit' : null,
      text: text.trim(),
    });
    if (kind === 'VISIT' && ['new', 'contacted', 'appointment'].includes(c.stage)) await setStage(c.id, 'showed', 'Showed');
    setText('');
  };

  return (
    <div className="composer">
      <div className="row between">
        <div className="tabs">
          {KINDS.map((k) => (
            <button key={k.id} className={kind === k.id ? 'on' : ''} onClick={() => setKind(k.id)}>
              {k.label}
            </button>
          ))}
        </div>
        {two && (
          <div className="tabs">
            <button className={dir === 'OUTBOUND' ? 'on' : ''} onClick={() => setDir('OUTBOUND')}>
              {kind === 'PHONE' ? 'I called' : 'I sent'}
            </button>
            <button className={dir === 'INBOUND' ? 'on' : ''} onClick={() => setDir('INBOUND')}>
              {kind === 'PHONE' ? 'They called' : 'They sent'}
            </button>
          </div>
        )}
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={
          kind === 'NOTE'
            ? 'Add a note…'
            : kind === 'PHONE'
              ? 'What was said? (optional)'
              : kind === 'VISIT'
                ? 'How did the visit go? (optional)'
                : dir === 'INBOUND'
                  ? `Paste what ${c.firstName || 'they'} sent…`
                  : 'What you sent…'
        }
        onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && void (canSend ? send() : save())}
      />
      <div className="row">
        {kind === 'PHONE' && (
          <select value={outcome} onChange={(e) => setOutcome(e.target.value)} aria-label="Call result">
            {CALL_OUTCOMES.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        )}
        <span className="grow muted small">{canSend ? 'Ctrl + Enter to send' : 'Ctrl + Enter to save'}</span>
        {canSend ? (
          <>
            <button className="btn ghost sm" onClick={() => void save()} title="Just note it on the timeline (you sent it some other way)">
              Log only
            </button>
            <button className="btn primary sm" disabled={!text.trim() || sending} onClick={() => void send()}>
              {sending ? 'Sending…' : 'Send text'}
            </button>
          </>
        ) : (
          <button className="btn primary sm" onClick={() => void save()}>
            Log {KINDS.find((k) => k.id === kind)!.label.toLowerCase()}
          </button>
        )}
      </div>
      {kind === 'TEXT' && dir === 'OUTBOUND' && (c.doNotText || c.doNotContact) && <p className="notice">Marked do not text.</p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

const ICON: Record<Activity['channel'], string> = { TEXT: 'text', PHONE: 'phone', EMAIL: 'mail', APPOINTMENT: 'calendar', NOTE: 'note', OTHER: 'note' };

function label(a: Activity, first: string): string {
  const who = a.direction === 'INBOUND' ? first || 'Customer' : a.direction === 'OUTBOUND' ? 'You' : '';
  const what = { TEXT: 'text', PHONE: 'call', EMAIL: 'email', APPOINTMENT: 'visit', NOTE: 'note', OTHER: 'activity' }[a.channel];
  if (a.outcome === 'Stage' || a.outcome === 'Vehicle') return a.text;
  if (a.channel === 'NOTE') return 'Note';
  if (a.channel === 'APPOINTMENT') return a.outcome ?? 'Appointment';
  return `${who} · ${what}${a.outcome ? ` · ${a.outcome}` : ''}`;
}

function Timeline({ customer: c }: { customer: Customer }) {
  const [all, setAll] = useState(false);
  const sms = useSms();
  if (!c.activities.length) return <Empty title="No activity yet">Log a call, text or note above.</Empty>;
  const shown = all ? c.activities : c.activities.slice(0, 40);
  return (
    <>
      <ul className="timeline">
        {shown.map((a) => {
          const system = a.outcome === 'Stage' || a.outcome === 'Vehicle';
          return (
            <li key={a.id}>
              <div className={`dot ${a.direction === 'INBOUND' ? 'in' : a.direction === 'OUTBOUND' ? 'out' : a.channel === 'APPOINTMENT' ? 'appt' : ''}`}>
                <Icon name={ICON[a.channel]} size={15} />
              </div>
              <div style={{ minWidth: 0 }}>
                <div className="tl-head">
                  <strong className={system ? 'soft' : ''}>{label(a, c.firstName)}</strong>
                  <span className="muted">{when(a.at)}</span>
                  {a.imported && <span className="muted small">eLead</span>}
                  <button className="link small del" onClick={() => confirm('Delete this entry?') && void deleteActivity(c.id, a.id)}>
                    delete
                  </button>
                </div>
                {!system && a.text && <div className={`tl-body${a.channel === 'TEXT' || a.channel === 'EMAIL' ? ' bubble' : ''}`}>{a.text}</div>}
                {sms[a.id] && statusLabel(sms[a.id]).text && <div className={`status-line${statusLabel(sms[a.id]).bad ? ' bad' : ''}`}>{statusLabel(sms[a.id]).text}</div>}
              </div>
            </li>
          );
        })}
      </ul>
      {!all && c.activities.length > 40 && (
        <div className="card-pad" style={{ paddingTop: 0 }}>
          <button className="link" onClick={() => setAll(true)}>
            Show all {c.activities.length}
          </button>
        </div>
      )}
    </>
  );
}

/* ---------- next steps ---------- */
function Tasks({ customer: c }: { customer: Customer }) {
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<TaskKind>('call');
  const [at, setAt] = useState(localInput(tomorrowAt(10)));
  const [title, setTitle] = useState('');
  const [apptText, setApptText] = useState<Task | null>(null);
  const open = c.tasks.filter((t) => !t.done).sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const doneRecent = c.tasks.filter((t) => t.done).slice(-3);

  const add = async () => {
    await addTask(c.id, { kind, dueAt: new Date(at).toISOString(), title: title.trim() || TASK_LABEL[kind] });
    if (kind === 'appointment') await logActivity(c.id, { channel: 'APPOINTMENT', direction: 'OUTBOUND', outcome: 'Appointment set', text: `For ${when(new Date(at).toISOString())}` });
    setAdding(false);
    setTitle('');
  };

  const showed = async (t: Task, result: 'showed' | 'no_show') => {
    await updateTask(c.id, t.id, { done: true, doneAt: new Date().toISOString(), result });
    await logActivity(c.id, { channel: 'APPOINTMENT', direction: result === 'showed' ? 'INBOUND' : 'INTERNAL', outcome: result === 'showed' ? 'Showed for appointment' : 'No-show', text: '' });
    if (result === 'showed' && ['new', 'contacted', 'appointment'].includes(c.stage)) await setStage(c.id, 'showed', 'Showed');
  };

  return (
    <section className="card">
      <div className="card-head">
        <h2>Next steps</h2>
        <button className="btn sm" onClick={() => setAdding((x) => !x)}>
          <Icon name="plus" size={14} /> Add
        </button>
      </div>
      {adding && (
        <div className="composer">
          <div className="row">
            <select value={kind} onChange={(e) => setKind(e.target.value as TaskKind)} aria-label="Kind">
              {Object.entries(TASK_LABEL).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
            <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} className="grow" />
          </div>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={kind === 'appointment' ? 'e.g. Test ride the Grizzly' : 'What to do (optional)'} />
          <div className="row">
            <span className="grow" />
            <button className="btn sm" onClick={() => setAdding(false)}>
              Cancel
            </button>
            <button className="btn primary sm" onClick={() => void add()}>
              Save
            </button>
          </div>
        </div>
      )}
      {open.length === 0 && !adding ? (
        <p className="card-pad muted small">Nothing scheduled.</p>
      ) : (
        <div className="list">
          {open.map((t) => {
            const late = daysFromToday(t.dueAt) < 0 || (daysFromToday(t.dueAt) === 0 && new Date(t.dueAt) < new Date());
            return (
              <div key={t.id} className="list-item">
                {t.kind !== 'appointment' && <input type="checkbox" aria-label="Done" onChange={() => void updateTask(c.id, t.id, { done: true, doneAt: new Date().toISOString() })} />}
                <div className="grow">
                  <div className="title">{t.title}</div>
                  <div className={`when${late ? ' late' : ''}`}>{when(t.dueAt)}</div>
                  {t.kind === 'appointment' && (
                    <div className="row" style={{ marginTop: 6 }}>
                      {new Date(t.dueAt) < new Date() ? (
                        <>
                          <button className="btn sm green" onClick={() => void showed(t, 'showed')}>
                            Showed
                          </button>
                          <button className="btn sm" onClick={() => void showed(t, 'no_show')}>
                            No-show
                          </button>
                        </>
                      ) : null}
                      {aiReady() && (
                        <button className="btn sm" onClick={() => setApptText(t)}>
                          <Icon name="sparkle" size={14} /> Text about it
                        </button>
                      )}
                    </div>
                  )}
                </div>
                <button className="btn ghost icon sm" aria-label="Delete" onClick={() => void deleteTask(c.id, t.id)}>
                  <Icon name="x" size={14} />
                </button>
              </div>
            );
          })}
          {doneRecent.map((t) => (
            <div key={t.id} className="list-item done">
              <div className="grow">
                <div className="title">{t.title}</div>
                <div className="when">{t.result === 'showed' ? 'Showed' : t.result === 'no_show' ? 'No-show' : 'Done'}</div>
              </div>
            </div>
          ))}
        </div>
      )}
      {apptText && <AppointmentText customer={c} task={apptText} onClose={() => setApptText(null)} />}
    </section>
  );
}

function AppointmentText({ customer: c, task, onClose }: { customer: Customer; task: Task; onClose: () => void }) {
  const settings = useSettings();
  const past = new Date(task.dueAt) < new Date();
  const [kind, setKind] = useState<AppointmentTextKind>(past ? 'noshow' : daysFromToday(task.dueAt) === 0 ? 'dayof' : 'confirm');
  const [text, setText] = useState('');
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await appointmentTextFor(c, settings, kind, task.dueAt);
      setText(r.text);
      setWhy(r.why);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const sent = async () => {
    await logActivity(c.id, { channel: 'TEXT', direction: 'OUTBOUND', outcome: null, text });
    onClose();
  };
  const sendNow = async () => {
    if (quietHours() && !confirm("It's outside 8 AM–9 PM. Send anyway?")) return;
    setError(null);
    try {
      await sendText(c, text);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Modal
      title={`Text ${c.firstName || 'them'} about the appointment`}
      onClose={onClose}
      foot={
        text ? (
          <>
            <button className="btn" onClick={() => void copy(text)}>
              <Icon name="copy" size={14} /> Copy
            </button>
            <button className="btn" onClick={() => void sent()}>
              Mark sent
            </button>
            {smsReady() && !c.doNotText && (
              <button className="btn primary" onClick={() => void sendNow()}>
                Send text
              </button>
            )}
          </>
        ) : undefined
      }
    >
      <div className="row">
        <select value={kind} onChange={(e) => setKind(e.target.value as AppointmentTextKind)} className="grow">
          {Object.entries(APPOINTMENT_TEXT_LABEL).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
        <button className="btn primary" disabled={busy} onClick={() => void run()}>
          {busy ? 'Writing…' : 'Write it'}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {why && <p className="why">{why}</p>}
      {text && <textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} />}
      <p className="muted small">Appointment: {when(task.dueAt)}</p>
    </Modal>
  );
}
