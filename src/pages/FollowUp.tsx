import { useEffect, useMemo, useRef, useState } from 'react';
import { LIST_TYPES, type ListType } from '../core/analysis/customList';
import { startRun, stopRun, targets, useDrafts, useRun, type PreDraft } from '../crm/predraft';
import { applyView, placeOf, useView } from '../crm/listView';
import { fullName, lastContact, useCustomers, useSettings } from '../crm/store';
import { STAGES, type Customer, type Stage } from '../crm/types';
import { DraftPanel } from '../ui/DraftPanel';
import { EmailComposer } from '../ui/EmailComposer';
import { ListFilters } from '../ui/ListFilters';
import { ago, Avatar, Empty, go, Icon, StageBadge } from '../ui/kit';

/** Reached out (text, email or call) since midnight. */
const doneToday = (c: Customer) => {
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return c.activities.some((a) => a.direction === 'OUTBOUND' && new Date(a.at) >= t);
};

/**
 * AI FOLLOW-UP: work down a list. Pick who (filters on the left), and for
 * each one Claude writes the follow-up; open it in Outlook or text it, it's
 * saved to their timeline, then Next.
 */
export function FollowUp() {
  const customers = useCustomers();
  const list = useMemo(() => Object.values(customers), [customers]);
  const [v, set] = useView('followup');
  const [hideDone, setHideDone] = useState(true);
  const [selected, setSelected] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem('tcrm.followup.sel');
    } catch {
      return null;
    }
  });
  const [shared, setShared] = useState<{ type: ListType | ''; note: string }>({ type: '', note: '' });
  const [emailing, setEmailing] = useState(false);
  // Someone you just contacted stays in the queue (checked) until you move on.
  const [keep, setKeep] = useState<string | null>(null);
  const queueRef = useRef<HTMLDivElement>(null);
  const drafts = useDrafts();
  const run = useRun();
  const settings = useSettings();
  const [mode, setMode] = useState<ListType | '' | 'auto'>('auto');
  const [redo, setRedo] = useState(false);
  const [reviewing, setReviewing] = useState(false);

  const viewList = useMemo(() => applyView(list, v), [list, v]);
  const queue = useMemo(
    () =>
      viewList.filter(
        (c) => !c.doNotContact && (reviewing ? drafts[c.id]?.status === 'ready' : !hideDone || !doneToday(c) || c.id === keep),
      ),
    [viewList, hideDone, keep, reviewing, drafts],
  );
  const toDraft = useMemo(() => targets(viewList, drafts, redo), [viewList, drafts, redo]);
  const tally = useMemo(() => {
    const t: Record<PreDraft['status'], number> = { ready: 0, sent: 0, denied: 0, skipped: 0, error: 0 };
    for (const d of Object.values(drafts)) t[d.status]++;
    return t;
  }, [drafts]);
  const c = (selected && customers[selected]) || queue[0] || null;
  const i = c ? queue.findIndex((x) => x.id === c.id) : -1;
  const sentToday = useMemo(() => list.filter(doneToday).length, [list]);

  useEffect(() => {
    try {
      if (c) sessionStorage.setItem('tcrm.followup.sel', c.id);
    } catch {
      // private window: start from the top next time
    }
  }, [c]);
  useEffect(() => {
    queueRef.current?.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
  }, [c?.id]);

  const pick = (id: string | null) => {
    setSelected(id);
    setKeep(null);
    setEmailing(false);
  };
  const next = () => pick(queue[i + 1]?.id ?? (i > 0 ? queue[0].id : null));
  const prev = () => i > 0 && pick(queue[i - 1].id);

  return (
    <div className="page wide">
      <div className="page-head">
        <div>
          <h1>AI Follow-up</h1>
          <p>Work down your list: Claude writes each one, you open it in Outlook or text it, and it's saved to their timeline.</p>
        </div>
        <span className="soft small">{sentToday} reached today</span>
      </div>

      <section className="card card-pad predraft">
        <div className="row between">
          <div className="stack tight">
            <h2 className="row">
              <Icon name="sparkle" /> Pre-draft emails
            </h2>
            <p className="soft small">
              Claude writes an email for everyone in the list on the left, from their history. Then review them: approve, edit or deny. Every one teaches it.
            </p>
          </div>
          <div className="tabs">
            <button className={!reviewing ? 'on' : ''} onClick={() => setReviewing(false)}>
              Everyone
            </button>
            <button className={reviewing ? 'on' : ''} onClick={() => (setReviewing(true), pick(null))}>
              Review drafts <span className="muted">{tally.ready}</span>
            </button>
          </div>
        </div>
        {run.running ? (
          <div className="stack tight">
            <div className="progress">
              <div style={{ width: `${run.total ? Math.round((run.done / run.total) * 100) : 0}%` }} />
            </div>
            <div className="row between">
              <span className="small soft">
                {run.stopping ? 'Stopping after the current ones…' : `Writing ${run.done + 1}–${Math.min(run.total, run.done + run.current.length)} of ${run.total}`}
                {run.errors ? ` · ${run.errors} didn't work` : ''} · keep this tab open; you can use other pages meanwhile
              </span>
              <button className="btn sm" disabled={run.stopping} onClick={stopRun}>
                Stop
              </button>
            </div>
          </div>
        ) : (
          <div className="row predraft-go">
            <select value={mode} onChange={(e) => setMode(e.target.value as ListType | '' | 'auto')} aria-label="Write them as">
              <option value="auto">Auto: Cold opener if we've never talked, follow-up for the rest</option>
              <option value="">Regular follow-up</option>
              {Object.entries(LIST_TYPES).map(([k, t]) => (
                <option key={k} value={k}>
                  {t.label}
                </option>
              ))}
            </select>
            <label className="check small">
              <input type="checkbox" checked={redo} onChange={(e) => setRedo(e.target.checked)} /> Redo ones already drafted
            </label>
            <button
              className="btn primary"
              disabled={!toDraft.length}
              onClick={() => {
                if (toDraft.length > 25 && !confirm(`Write ${toDraft.length} emails? It takes a few seconds each (about ${Math.max(1, Math.round((toDraft.length * 9) / 2 / 60))} min), and uses Claude through your dialer.`)) return;
                void startRun(toDraft, settings, mode, shared.note);
              }}
            >
              <Icon name="sparkle" size={16} /> Pre-draft {toDraft.length} email{toDraft.length === 1 ? '' : 's'}
            </button>
          </div>
        )}
        {run.message && <p className="error">{run.message}</p>}
        <p className="muted small">
          {tally.ready} ready to review · {tally.sent} approved · {tally.denied} denied{tally.skipped ? ` · ${tally.skipped} Claude said to skip` : ''}
          {tally.error ? ` · ${tally.error} didn't work (Pre-draft tries them again)` : ''}. Only customers with an email address are drafted.
        </p>
      </section>

      <div className="followup">
        <aside className="card fu-queue">
          <div className="card-pad stack tight">
            <select value={v.stage} onChange={(e) => set({ stage: e.target.value as Stage | 'open' | 'all' })} aria-label="Stage">
              <option value="open">Open customers</option>
              <option value="all">Everyone</option>
              {STAGES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
            <ListFilters list={list} view={v} set={set} compact />
            <label className="check small">
              <input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} /> Hide anyone already reached today
            </label>
            <div className="muted small">{queue.length} in this list</div>
          </div>
          <div className="fu-list" ref={queueRef}>
            {queue.map((x) => (
              <button key={x.id} className={x.id === c?.id ? 'sel' : ''} onClick={() => pick(x.id)}>
                <span className="grow" style={{ minWidth: 0 }}>
                  <span className="name">{fullName(x)}</span>
                  <span className="line">{[`${x.firstName}${x.lastName}`.trim() ? x.company : x.title, placeOf(x).city].filter(Boolean).join(' · ') || x.phone}</span>
                </span>
                {doneToday(x) ? (
                  <Icon name="check" size={15} />
                ) : drafts[x.id]?.status === 'ready' ? (
                  <span className="badge ready" title="Draft ready">
                    Draft
                  </span>
                ) : x.email ? (
                  <Icon name="mail" size={13} />
                ) : null}
              </button>
            ))}
            {!queue.length && (
              <p className="muted small card-pad">
                {reviewing ? 'No drafts waiting in this list. Pre-draft some above, or switch to Everyone.' : 'No one left in this list. Change the filters, or untick “Hide anyone already reached today”.'}
              </p>
            )}
          </div>
        </aside>

        <div className="stack">
          {!c ? (
            <section className="card">
              <Empty title="Pick who to follow up with">Use the filters on the left, e.g. Has email + Never contacted.</Empty>
            </section>
          ) : (
            <>
              <section className="card card-pad">
                <div className="row between">
                  <div className="profile">
                    <Avatar first={c.firstName} last={c.lastName} company={c.company} lg />
                    <div className="stack tight" style={{ minWidth: 0 }}>
                      <h2>{fullName(c)}</h2>
                      {(c.title || (c.company && `${c.firstName}${c.lastName}`.trim())) && (
                        <div className="soft">{[c.title, `${c.firstName}${c.lastName}`.trim() ? c.company : ''].filter(Boolean).join(' · ')}</div>
                      )}
                      <div className="row soft small">
                        {c.phone && <span>{c.phone}</span>}
                        {c.email && <span>· {c.email}</span>}
                        {c.address && <span>· {c.address}</span>}
                      </div>
                      <div className="row small">
                        <StageBadge stage={c.stage} />
                        <span className="muted">Last contact: {ago(lastContact(c))}</span>
                      </div>
                    </div>
                  </div>
                  <div className="row">
                    <button className="btn sm" disabled={i <= 0} onClick={prev}>
                      <Icon name="back" size={14} /> Previous
                    </button>
                    <button className="btn sm primary" onClick={next}>
                      {keep === c.id ? 'Next' : 'Skip'} <Icon name="chevron" size={14} />
                    </button>
                  </div>
                </div>
                {c.notes && <p className="small soft fu-notes">{c.notes}</p>}
                <div className="row" style={{ marginTop: 10 }}>
                  <button className="btn sm" disabled={!c.email} onClick={() => setEmailing(true)} title={c.email ? 'Write your own email' : 'No email address'}>
                    <Icon name="mail" size={14} /> Write my own email
                  </button>
                  <button className="btn sm ghost" onClick={() => go(`customers/${c.id}`)}>
                    Open customer
                  </button>
                  <span className="muted small grow" style={{ textAlign: 'right' }}>
                    {i >= 0 ? `${i + 1} of ${queue.length}` : ''}
                  </span>
                </div>
              </section>
              <DraftPanel
                key={c.id}
                customer={c}
                pre={drafts[c.id]}
                shared={{ ...shared, set: (p) => setShared((x) => ({ ...x, ...p })) }}
                onLogged={() => setKeep(c.id)}
                // Approved as written or denied: straight on to the next one. Edited: stay so you can say why.
                onDecided={(outcome, edited) => (outcome === 'denied' || !edited) && setTimeout(next, 700)}
              />
              {emailing && <EmailComposer customer={c} onClose={() => (setEmailing(false), setKeep(c.id))} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
