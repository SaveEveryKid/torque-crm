import { useEffect, useMemo, useState } from 'react';
import { applyView, baseFilter, matchesStage, PAGE_SIZE, placeOf, rememberOrder, sortLetter, useView, type View } from '../crm/listView';
import { fullName, lastContact, openTasks, useCustomers } from '../crm/store';
import { STAGES } from '../crm/types';
import { ImportCustomers } from '../ui/ImportCustomers';
import { ListFilters } from '../ui/ListFilters';
import { ago, Avatar, Empty, go, Icon, StageBadge, when } from '../ui/kit';

const LETTERS = '#ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

export function Customers() {
  const customers = useCustomers();
  const list = useMemo(() => Object.values(customers), [customers]);
  const [v, set] = useView('customers');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [importing, setImporting] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const base = useMemo(() => baseFilter(list, v), [list, v]);
  const shown = useMemo(() => applyView(list, v), [list, v]);
  useEffect(() => rememberOrder(shown.map((c) => c.id)), [shown]);
  const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const page = Math.min(v.page, pages - 1);
  const rows = shown.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const count = (f: View['stage']) => base.filter((c) => matchesStage(c, f)).length;

  const lettered = ['name', 'first', 'name-desc', 'business'].includes(v.sort);
  const firstAt = useMemo(() => {
    const m = new Map<string, number>();
    if (lettered) shown.forEach((c, i) => !m.has(sortLetter(c, v.sort)) && m.set(sortLetter(c, v.sort), i));
    return m;
  }, [shown, v.sort, lettered]);
  const jump = (l: string) => {
    const i = firstAt.get(l);
    if (i === undefined) return;
    set({ page: Math.floor(i / PAGE_SIZE) });
    setFlash(shown[i].id);
  };
  useEffect(() => {
    if (!flash) return;
    document.getElementById(`row-${flash}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const t = setTimeout(() => setFlash(null), 1600);
    return () => clearTimeout(t);
  }, [flash, page]);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Customers</h1>
          <p>Everyone you're working, in one place.</p>
        </div>
        <div className="row">
          <button className="btn" onClick={() => setImporting(true)} title="Bring in customers from a spreadsheet (CSV). A Torque “EXPORT LIST + HISTORY” file brings each customer's eLead history.">
            <Icon name="upload" size={16} /> Import CSV
          </button>
        </div>
      </div>
      {msg && <p className={msg.ok ? 'success' : 'error'}>{msg.text}</p>}
      {importing && <ImportCustomers existing={list} onClose={() => setImporting(false)} onDone={(text) => setMsg({ ok: true, text })} />}

      <div className="tabs scroll-x">
        {(['open', 'all'] as View['stage'][]).concat(STAGES.map((s) => s.id)).map((f) => (
          <button key={f} className={v.stage === f ? 'on' : ''} onClick={() => set({ stage: f })}>
            {f === 'open' ? 'Open' : f === 'all' ? 'All' : STAGES.find((s) => s.id === f)!.label} <span className="muted">{count(f)}</span>
          </button>
        ))}
      </div>
      <ListFilters list={list} view={v} set={set} />

      {lettered && shown.length > PAGE_SIZE / 2 && (
        <div className="az" aria-label="Jump to letter">
          {LETTERS.map((l) => (
            <button key={l} disabled={!firstAt.has(l)} onClick={() => jump(l)}>
              {l}
            </button>
          ))}
        </div>
      )}

      <section className="card">
        {shown.length === 0 ? (
          <Empty title={list.length ? 'No one matches' : 'No customers yet'}>
            {list.length ? 'Try another filter.' : 'Add one with “New customer”, or import a CSV (your Torque list exports work, history included).'}
          </Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Stage</th>
                <th className="hide-sm">Location</th>
                <th className="hide-sm">Looking at</th>
                <th>Last contact</th>
                <th className="hide-sm">Next</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c, i) => {
                const next = openTasks(c)[0];
                const where = placeOf(c);
                const letter = lettered ? sortLetter(c, v.sort) : null;
                const prev = i > 0 ? rows[i - 1] : page > 0 ? shown[page * PAGE_SIZE - 1] : null;
                const newLetter = letter && (!prev || sortLetter(prev, v.sort) !== letter);
                return (
                  <tr key={c.id} id={`row-${c.id}`} className={`${flash === c.id ? 'flash' : ''}${newLetter ? ' letter-start' : ''}`} data-letter={newLetter ? letter : undefined} onClick={() => go(`customers/${c.id}`)}>
                    <td>
                      <div className="who">
                        <Avatar first={c.firstName} last={c.lastName} company={c.company} />
                        <div style={{ minWidth: 0 }}>
                          <div className="name">{fullName(c)}</div>
                          <div className="line">
                            {[`${c.firstName}${c.lastName}`.trim() ? c.company : c.title, c.phone || c.email || 'no phone'].filter(Boolean).join(' · ')}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <StageBadge stage={c.stage} />
                    </td>
                    <td className="soft nowrap hide-sm">{[where.city, where.state].filter(Boolean).join(', ') || <span className="muted">—</span>}</td>
                    <td className="soft hide-sm">{c.vehicle?.title || c.interest || <span className="muted">—</span>}</td>
                    <td className="soft nowrap">{ago(lastContact(c))}</td>
                    <td className="soft nowrap hide-sm">{next ? `${next.title} · ${when(next.dueAt)}` : <span className="muted">—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
      {shown.length > 0 && <Pager page={page} pages={pages} total={shown.length} set={(p) => (set({ page: p }), scrollTo({ top: 0 }))} />}
    </div>
  );
}

export function Pager({ page, pages, total, set }: { page: number; pages: number; total: number; set: (p: number) => void }) {
  return (
    <div className="pager">
      <span className="muted small">
        {page * PAGE_SIZE + 1}–{Math.min(total, (page + 1) * PAGE_SIZE)} of {total}
      </span>
      {pages > 1 && (
        <div className="row">
          <button className="btn sm" disabled={page === 0} onClick={() => set(page - 1)}>
            <Icon name="back" size={14} /> Previous
          </button>
          <select value={page} onChange={(e) => set(Number(e.target.value))} aria-label="Page">
            {Array.from({ length: pages }, (_, i) => (
              <option key={i} value={i}>
                Page {i + 1} of {pages}
              </option>
            ))}
          </select>
          <button className="btn sm" disabled={page >= pages - 1} onClick={() => set(page + 1)}>
            Next <Icon name="chevron" size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
