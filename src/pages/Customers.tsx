import { useMemo, useRef, useState } from 'react';
import { addCustomers, fullName, lastContact, openTasks, useCustomers } from '../crm/store';
import { importCsv } from '../crm/record';
import { STAGES, type Stage } from '../crm/types';
import { ago, Avatar, Empty, go, Icon, StageBadge, when } from '../ui/kit';

type Filter = Stage | 'all' | 'open';
type Sort = 'recent' | 'name' | 'contact';

export function Customers() {
  const customers = useCustomers();
  const list = useMemo(() => Object.values(customers), [customers]);
  const [filter, setFilter] = useState<Filter>('open');
  const [sort, setSort] = useState<Sort>('recent');
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return list
      .filter((c) => (filter === 'all' ? true : filter === 'open' ? !['sold', 'lost'].includes(c.stage) : c.stage === filter))
      .filter((c) => !s || [fullName(c), c.phone, c.email, c.interest, c.vehicle?.title ?? ''].some((v) => v.toLowerCase().includes(s)))
      .sort((a, b) =>
        sort === 'name' ? fullName(a).localeCompare(fullName(b)) : sort === 'contact' ? (lastContact(a) ?? '').localeCompare(lastContact(b) ?? '') : b.updatedAt.localeCompare(a.updatedAt),
      );
  }, [list, filter, sort, q]);

  const count = (f: Filter) => list.filter((c) => (f === 'all' ? true : f === 'open' ? !['sold', 'lost'].includes(c.stage) : c.stage === f)).length;

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    const res = importCsv(await f.text(), f.name, list);
    if (!res.ok) return setMsg({ ok: false, text: res.error });
    await addCustomers(res.customers);
    setMsg({
      ok: true,
      text: `Imported ${res.customers.length} customer${res.customers.length === 1 ? '' : 's'}${res.withHistory ? ` (${res.withHistory} with their eLead history)` : ''}.${
        res.duplicates ? ` ${res.duplicates} already here (same phone) were left alone.` : ''
      }${res.skipped ? ` ${res.skipped} rows had no usable phone.` : ''}`,
    });
    if (file.current) file.current.value = '';
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Customers</h1>
          <p>Everyone you're working, in one place.</p>
        </div>
        <div className="row">
          <input ref={file} type="file" accept=".csv,text/csv" hidden onChange={(e) => void onFile(e.target.files?.[0])} />
          <button className="btn" onClick={() => file.current?.click()} title="A spreadsheet (CSV) with name and phone columns. A Torque “EXPORT LIST + HISTORY” file brings each customer's eLead history.">
            <Icon name="upload" size={16} /> Import CSV
          </button>
        </div>
      </div>
      {msg && <p className={msg.ok ? 'success' : 'error'}>{msg.text}</p>}

      <div className="row between">
        <div className="tabs">
          {(['open', 'all'] as Filter[]).concat(STAGES.map((s) => s.id)).map((f) => (
            <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
              {f === 'open' ? 'Open' : f === 'all' ? 'All' : STAGES.find((s) => s.id === f)!.label} <span className="muted">{count(f)}</span>
            </button>
          ))}
        </div>
        <div className="row">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter…" style={{ width: 200 }} />
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort">
            <option value="recent">Recently updated</option>
            <option value="contact">Longest since contact</option>
            <option value="name">Name</option>
          </select>
        </div>
      </div>

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
                <th>Looking at</th>
                <th>Last contact</th>
                <th>Next</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((c) => {
                const next = openTasks(c)[0];
                return (
                  <tr key={c.id} onClick={() => go(`customers/${c.id}`)}>
                    <td>
                      <div className="who">
                        <Avatar first={c.firstName} last={c.lastName} />
                        <div style={{ minWidth: 0 }}>
                          <div className="name">{fullName(c)}</div>
                          <div className="line">{c.phone || c.email || 'no phone'}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <StageBadge stage={c.stage} />
                    </td>
                    <td className="soft">{c.vehicle?.title || c.interest || <span className="muted">—</span>}</td>
                    <td className="soft nowrap">{ago(lastContact(c))}</td>
                    <td className="soft nowrap">{next ? `${next.title} · ${when(next.dueAt)}` : <span className="muted">—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
