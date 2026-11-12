import { MarketplaceDialog } from '../ui/MarketplaceDialog';
import { markListed, useLister, useListed } from '../crm/lister';
import { AccessoriesEditor } from '../ui/AccessoriesEditor';
import { useEffect, useMemo, useState } from 'react';
import { allUnits, diffInventory, money, onFacebook, readUnit, searchAll, searchConfig, searchInventory, snapshotOf, toVehicleRef, usefulFacets, type InventoryChanges, type InventorySnapshot, type SearchResult, type Unit } from '../crm/inventory';
import { kv } from '../core/storage/kv';
import { fullName, logActivity, updateCustomer, useCustomers, useSettings, saveSettings } from '../crm/store';
import type { VehicleRef } from '../crm/types';
import { copy, Empty, go, Icon, Modal, when } from '../ui/kit';

/** Search state + results, shared by the Inventory page and the picker. */
/** The site's store field (DX1): "Shoals Outdoor Sports - Florence". */
const LOCATION_FACET = 'DealershipName';
/** "Shoals Outdoor Sports - Florence" → "Florence". */
export const storeName = (v: string) => v.replace(/^.*\s[-–]\s/, '');

function useInventory() {
  const settings = useSettings();
  // Facebook Marketplace: all units, not listed yet, or listed (remembered).
  const fb = settings.inventoryFacebook ?? 'all';
  const listedMap = useListed();
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
    // Your store (Settings → Location) on top of the other filters.
    const params = { query, index, filters: settings.inventoryLocation ? { ...filters, [LOCATION_FACET]: settings.inventoryLocation } : filters };
    // On/not on Facebook isn't something the website knows: load every match and filter here.
    (fb === 'all' ? searchInventory(settings.inventoryPage, { ...params, page }) : searchAll(settings.inventoryPage, params))
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
  }, [query, fb === 'all' ? page : -1, index, filters, settings.inventoryPage, settings.inventoryLocation, fb, reload]);
  // What's shown: the page from the website, or this page of the Facebook-filtered list.
  const view = useMemo(() => (res && fb !== 'all' ? onFacebook(res, listedMap, fb, page) : res), [res, fb, listedMap, page]);

  // REFRESH: read the whole inventory fresh from the website (no saved copies), show it, and say what changed since last time.
  const [refreshing, setRefreshing] = useState(false);
  const [changes, setChanges] = useState<{ at: string; first: boolean; c: InventoryChanges } | null>(null);
  const refresh = async () => {
    setRefreshing(true);
    setError(null);
    try {
      await searchConfig(settings.inventoryPage, true);
      const store = settings.inventoryLocation;
      const units = (await allUnits(settings.inventoryPage, true)).filter((u) => !store || u.location === store);
      const before = ((await kv.get('inventorySnapshot')).inventorySnapshot as InventorySnapshot | undefined) ?? null;
      const same = before && before.store === store ? before : null;
      const snap = snapshotOf(units, store);
      const c = diffInventory(same, units) ?? { added: [], gone: [], repriced: [], total: units.length };
      await kv.set({ inventorySnapshot: snap });
      setChanges({ at: snap.at, first: !same, c });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRefreshing(false);
      setReload((n) => n + 1);
    }
  };

  const controls = (
    <div className="filters">
      <div className="search" style={{ maxWidth: 320 }}>
        <Icon name="search" size={16} />
        <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Search make, model, stock #…" />
      </div>
      {res &&
        usefulFacets(res.facets).map((f) =>
          f.name === LOCATION_FACET ? (
            // Remembered (Settings): the store you list from.
            <select
              key={f.name}
              className={settings.inventoryLocation ? 'on' : ''}
              value={settings.inventoryLocation}
              onChange={(e) => (void saveSettings({ inventoryLocation: e.target.value }), setPage(0))}
              aria-label="Location"
            >
              <option value="">Location: every store</option>
              {[...new Set([settings.inventoryLocation, ...f.values.map(([v]) => v)].filter(Boolean))].map((v) => (
                <option key={v} value={v}>
                  {storeName(v)}
                  {f.values.find(([x]) => x === v) && !settings.inventoryLocation ? ` (${f.values.find(([x]) => x === v)![1]})` : ''}
                </option>
              ))}
            </select>
          ) : (
            <select key={f.name} value={filters[f.name] ?? ''} onChange={(e) => (setFilters((x) => ({ ...x, [f.name]: e.target.value })), setPage(0))} aria-label={f.label}>
              <option value="">{f.label}: any</option>
              {f.values.map(([v, n]) => (
                <option key={v} value={v}>
                  {v} ({n})
                </option>
              ))}
            </select>
          ),
        )}
      <select
        className={fb !== 'all' ? 'on' : ''}
        value={fb}
        onChange={(e) => (void saveSettings({ inventoryFacebook: e.target.value as 'all' | 'not' | 'listed' }), setPage(0))}
        aria-label="Facebook Marketplace"
      >
        <option value="all">Facebook: any</option>
        <option value="not">Not listed on Facebook yet</option>
        <option value="listed">Listed on Facebook</option>
      </select>
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
    view && view.nbPages > 1 ? (
      <div className="pager">
        <button className="btn sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
          Previous
        </button>
        <span className="muted small">
          Page {page + 1} of {view.nbPages}
        </span>
        <button className="btn sm" disabled={page + 1 >= view.nbPages} onClick={() => setPage((p) => p + 1)}>
          Next
        </button>
      </div>
    ) : null;

  return { res: view, fb, error, loading: loading || refreshing, refreshing, changes, dismiss: () => setChanges(null), controls, pager, refresh, units: (view?.hits ?? []).map(readUnit) };
}

function UnitCard({ u, onClick, listed }: { u: Unit; onClick: () => void; listed?: string }) {
  return (
    <div className="card unit" onClick={onClick}>
      {listed && <span className="badge ready mp-listed" title={`Sent to Marketplace ${when(listed)}`}>Listed</span>}
      <div className="img">{u.image ? <img src={u.image} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <Icon name="car" size={28} />}</div>
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
  const [listing, setListing] = useState<Unit | null>(null);
  const [offering, setOffering] = useState<Unit | null>(null);
  const listed = useListed();
  useLister(); // also picks up what the extension has sent to Facebook
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Inventory</h1>
          <p>
            In stock at Shoals Outdoor Sports
            {inv.res ? ` · ${inv.res.nbHits.toLocaleString()} ${inv.fb === 'not' ? 'not on Facebook yet' : inv.fb === 'listed' ? 'listed on Facebook' : 'units'}` : ''}
          </p>
        </div>
        <button className="btn" onClick={() => void inv.refresh()} disabled={inv.loading} title="Read the inventory fresh from the website and show what changed">
          <Icon name="refresh" size={16} /> {inv.refreshing ? 'Refreshing from the website…' : 'Refresh'}
        </button>
      </div>
      {inv.changes && <RefreshReport r={inv.changes} onClose={inv.dismiss} />}
      {inv.controls}
      {inv.error && <p className="error">{inv.error}</p>}
      {inv.res && inv.units.length === 0 && (inv.fb === "not" ? <Empty title="Everything here is already on Facebook">Nice work. Change the Facebook filter to see them.</Empty> : <Empty title="No units match">Try fewer filters.</Empty>)}
      <div className="units">
        {inv.units.map((u) => (
          <UnitCard key={u.id} u={u} onClick={() => setOpen(u)} listed={listed[u.id]?.at} />
        ))}
      </div>
      {inv.pager}
      {open && <UnitDetails u={open} onClose={() => setOpen(null)} onList={() => (setListing(open), setOpen(null))} onOfferUp={() => (setOffering(open), setOpen(null))} />}
      {listing && <MarketplaceDialog u={listing} onClose={() => setListing(null)} />}
      {offering && <MarketplaceDialog u={offering} site="offerup" onClose={() => setOffering(null)} />}
    </div>
  );
}

function UnitDetails({ u, onClose, onList, onOfferUp }: { u: Unit; onClose: () => void; onList: () => void; onOfferUp: () => void }) {
  const customers = useCustomers();
  const listed = useListed()[u.id];
  const onOffer = useListed('offerup')[u.id];
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
      <Gallery photos={u.photos} />
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
      <AccessoriesEditor u={u} />
      <div className="row mp-status">
        {listed ? (
          <>
            <span className="badge ready">Listed on Marketplace</span>
            <span className="muted small">{when(listed.at)}</span>
            <button className="link small" onClick={() => void markListed(u.id, u.title, true)}>
              Mark not listed
            </button>
          </>
        ) : (
          <>
            <span className="muted small">Not on Marketplace yet</span>
            <button className="link small" onClick={() => void markListed(u.id, u.title)}>
              Mark as listed
            </button>
          </>
        )}
      </div>
      <div className="row mp-status">
        {onOffer ? (
          <>
            <span className="badge ready">Sent to OfferUp</span>
            <span className="muted small">{when(onOffer.at)}</span>
            <button className="link small" onClick={() => void markListed(u.id, u.title, true, 'offerup')}>
              Mark not listed
            </button>
          </>
        ) : (
          <>
            <span className="muted small">Not on OfferUp yet</span>
            <button className="link small" onClick={() => void markListed(u.id, u.title, false, 'offerup')}>
              Mark as listed
            </button>
          </>
        )}
      </div>
      <div className="row">
        <button className="btn primary" disabled={!u.photos.length} onClick={onList} title="Fill a Facebook Marketplace draft with this unit and your watermarked photos">
          <Icon name="upload" size={15} /> {listed ? 'List again' : 'List on Marketplace'}
        </button>
        <button className="btn primary" disabled={!u.photos.length} onClick={onOfferUp} title="Open OfferUp's posting page and fill it with this unit and your watermarked photos">
          <Icon name="upload" size={15} /> {onOffer ? 'List on OfferUp again' : 'List on OfferUp'}
        </button>
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

/** Big photo with thumbnails underneath. */
function Gallery({ photos }: { photos: string[] }) {
  const [i, setI] = useState(0);
  if (!photos.length) return null;
  return (
    <div className="gallery">
      <img className="main" src={photos[i]} alt="" referrerPolicy="no-referrer" />
      {photos.length > 1 && (
        <div className="thumbs">
          {photos.map((p, n) => (
            <button key={p} className={n === i ? 'on' : ''} onClick={() => setI(n)} aria-label={`Photo ${n + 1}`}>
              <img src={p} alt="" loading="lazy" referrerPolicy="no-referrer" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** What the last Refresh found on the website. */
function RefreshReport({ r, onClose }: { r: { at: string; first: boolean; c: InventoryChanges }; onClose: () => void }) {
  const { added, gone, repriced, total } = r.c;
  const none = !added.length && !gone.length && !repriced.length;
  const name = (t: string, stock: string | null) => `${t}${stock ? ` (#${stock})` : ''}`;
  return (
    <div className="notice stack tight refresh-report">
      <div className="row between">
        <strong>
          Updated from the website at {new Date(r.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · {total.toLocaleString()} units
          {r.first
            ? ' (saved; the next refresh shows what changed)'
            : none
              ? ' · no changes since last refresh'
              : ` · ${[added.length && `${added.length} new`, gone.length && `${gone.length} gone`, repriced.length && `${repriced.length} price change${repriced.length === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}`}
        </strong>
        <button className="link small" onClick={onClose}>
          Close
        </button>
      </div>
      {!r.first && !none && (
        <details className="small">
          <summary>What changed</summary>
          <ul className="refresh-list">
            {added.map((u) => (
              <li key={`a${u.id}`}>
                <span className="badge ready">New</span> {name(u.title, u.stock)} · {money(u.price)}
              </li>
            ))}
            {repriced.map(({ unit: u, from, to }) => (
              <li key={`p${u.id}`}>
                <span className="badge">Price</span> {name(u.title, u.stock)} · {money(from)} → <strong>{money(to)}</strong>
              </li>
            ))}
            {gone.map((g) => (
              <li key={`g${g.id}`}>
                <span className="badge">Gone</span> {name(g.title, g.stock)} · no longer on the website (sold or moved)
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
