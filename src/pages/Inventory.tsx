import { useEffect, useState } from 'react';
import { money, readUnit, searchConfig, searchInventory, toVehicleRef, usefulFacets, type SearchResult, type Unit } from '../crm/inventory';
import { fullName, logActivity, updateCustomer, useCustomers, useSettings } from '../crm/store';
import type { VehicleRef } from '../crm/types';
import { copy, Empty, go, Icon, Modal } from '../ui/kit';

/** Search state + results, shared by the Inventory page and the picker. */
function useInventory() {
  const settings = useSettings();
  const [query, setQuery] = useState('');
  const [typed, setTyped] = useState('');
  const [page, setPage] = useState(0);
  const [index, setIndex] = useState('');
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [sorts, setSorts] = useState<{ indexName: string; label: string }[]>([]);
  const [res, setRes] = useState<SearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => (setQuery(typed), setPage(0)), 250);
    return () => clearTimeout(t);
  }, [typed]);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    searchInventory(settings.inventoryPage, { query, page, index, filters })
      .then(async (r) => {
        if (!live) return;
        setRes(r);
        if (!sorts.length) setSorts((await searchConfig(settings.inventoryPage)).sorts);
      })
      .catch((e: Error) => live && setError(e.message))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, page, index, filters, settings.inventoryPage, reload]);

  const refresh = async () => {
    await searchConfig(settings.inventoryPage, true).catch((e: Error) => setError(e.message));
    setReload((n) => n + 1);
  };

  const controls = (
    <div className="filters">
      <div className="search" style={{ maxWidth: 320 }}>
        <Icon name="search" size={16} />
        <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Search make, model, stock #…" />
      </div>
      {res &&
        usefulFacets(res.facets).map((f) => (
          <select key={f.name} value={filters[f.name] ?? ''} onChange={(e) => (setFilters((x) => ({ ...x, [f.name]: e.target.value })), setPage(0))} aria-label={f.label}>
            <option value="">{f.label}: any</option>
            {f.values.map(([v, n]) => (
              <option key={v} value={v}>
                {v} ({n})
              </option>
            ))}
          </select>
        ))}
      {sorts.length > 1 && (
        <select value={index} onChange={(e) => (setIndex(e.target.value), setPage(0))} aria-label="Sort">
          {sorts.map((s, i) => (
            <option key={s.indexName} value={i === 0 ? '' : s.indexName}>
              {s.label}
            </option>
          ))}
        </select>
      )}
      {Object.values(filters).some(Boolean) && (
        <button className="btn ghost sm" onClick={() => (setFilters({}), setPage(0))}>
          Clear filters
        </button>
      )}
    </div>
  );

  const pager =
    res && res.nbPages > 1 ? (
      <div className="pager">
        <button className="btn sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
          Previous
        </button>
        <span className="muted small">
          Page {page + 1} of {res.nbPages}
        </span>
        <button className="btn sm" disabled={page + 1 >= res.nbPages} onClick={() => setPage((p) => p + 1)}>
          Next
        </button>
      </div>
    ) : null;

  return { res, error, loading, controls, pager, refresh, units: (res?.hits ?? []).map(readUnit) };
}

function UnitCard({ u, onClick }: { u: Unit; onClick: () => void }) {
  return (
    <div className="card unit" onClick={onClick}>
      <div className="img">{u.image ? <img src={u.image} alt="" loading="lazy" /> : <Icon name="car" size={28} />}</div>
      <div className="body">
        <div className="title">{u.title}</div>
        <div className="price">
          {money(u.price)}
          {u.msrp ? <span className="msrp">{money(u.msrp)}</span> : null}
        </div>
        <div className="meta">{[u.condition, u.type, u.color, u.usage, u.stock ? `#${u.stock}` : null].filter(Boolean).join(' · ')}</div>
      </div>
    </div>
  );
}

export function Inventory() {
  const inv = useInventory();
  const [open, setOpen] = useState<Unit | null>(null);
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Inventory</h1>
          <p>In stock at Shoals Outdoor Sports{inv.res ? ` · ${inv.res.nbHits.toLocaleString()} units` : ''}</p>
        </div>
        <button className="btn" onClick={() => void inv.refresh()} disabled={inv.loading}>
          <Icon name="refresh" size={16} /> Refresh
        </button>
      </div>
      {inv.controls}
      {inv.error && <p className="error">{inv.error}</p>}
      {inv.res && inv.units.length === 0 && <Empty title="No units match">Try fewer filters.</Empty>}
      <div className="units">
        {inv.units.map((u) => (
          <UnitCard key={u.id} u={u} onClick={() => setOpen(u)} />
        ))}
      </div>
      {inv.pager}
      {open && <UnitDetails u={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function UnitDetails({ u, onClose }: { u: Unit; onClose: () => void }) {
  const customers = useCustomers();
  const [who, setWho] = useState('');
  const [raw, setRaw] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const people = Object.values(customers)
    .filter((c) => !['sold', 'lost'].includes(c.stage))
    .sort((a, b) => fullName(a).localeCompare(fullName(b)));
  const attach = async () => {
    const c = customers[who];
    if (!c) return;
    const v = toVehicleRef(u);
    await updateCustomer(c.id, { vehicle: v });
    await logActivity(c.id, { channel: 'NOTE', direction: 'INTERNAL', outcome: 'Vehicle', text: `Showing ${v.title}${v.stock ? ` (stock ${v.stock})` : ''}` });
    setDone(c.id);
  };
  const facts: [string, string | null][] = [
    ['Price', money(u.price)],
    ['MSRP', u.msrp ? money(u.msrp) : null],
    ['Condition', u.condition],
    ['Type', u.type],
    ['Color', u.color],
    ['Usage', u.usage],
    ['Stock #', u.stock],
    ['VIN', u.vin],
    ['Location', u.location],
  ];
  return (
    <Modal title={u.title} onClose={onClose} wide>
      {u.image && <img src={u.image} alt="" style={{ width: '100%', maxHeight: 380, objectFit: 'cover', borderRadius: 10 }} />}
      <dl className="facts">
        {facts
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k} style={{ display: 'contents' }}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
      </dl>
      <div className="row">
        {u.url && (
          <a className="btn" href={u.url} target="_blank" rel="noreferrer">
            <Icon name="external" size={15} /> Open on website
          </a>
        )}
        {u.url && (
          <button className="btn" onClick={() => void copy(u.url!)}>
            <Icon name="copy" size={15} /> Copy link
          </button>
        )}
      </div>
      <div className="row">
        <select value={who} onChange={(e) => (setWho(e.target.value), setDone(null))} className="grow" aria-label="Customer">
          <option value="">Attach to a customer…</option>
          {people.map((c) => (
            <option key={c.id} value={c.id}>
              {fullName(c)}
            </option>
          ))}
        </select>
        <button className="btn primary" disabled={!who} onClick={() => void attach()}>
          Attach
        </button>
      </div>
      {done && (
        <p className="success">
          Attached.{' '}
          <button className="link" onClick={() => go(`customers/${done}`)}>
            Open {fullName(customers[done])}
          </button>
        </p>
      )}
      <button className="link small" onClick={() => setRaw((x) => !x)} style={{ alignSelf: 'flex-start' }}>
        {raw ? 'Hide' : 'Show'} all listing data
      </button>
      {raw && <pre style={{ fontSize: 12, overflow: 'auto', maxHeight: 300, background: 'var(--panel-2)', padding: 12, borderRadius: 8 }}>{JSON.stringify(u.raw, null, 2)}</pre>}
    </Modal>
  );
}

/** Pick a unit for a customer (from their page). */
export function InventoryPicker({ onClose, onPick }: { onClose: () => void; onPick: (v: VehicleRef) => void }) {
  const inv = useInventory();
  return (
    <Modal title="Pick a vehicle" onClose={onClose} wide>
      {inv.controls}
      {inv.error && <p className="error">{inv.error}</p>}
      <div className="units">
        {inv.units.map((u) => (
          <UnitCard key={u.id} u={u} onClick={() => onPick(toVehicleRef(u))} />
        ))}
      </div>
      {inv.pager}
    </Modal>
  );
}
