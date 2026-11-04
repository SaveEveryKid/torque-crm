import { useEffect, useState } from 'react';
import {
  accessoryBlock,
  choiceLabel,
  choices,
  installed,
  MAX_ACCESSORIES,
  money,
  readCatalog,
  saveCatalog,
  saveUnitAccessories,
  useCatalog,
  useUnitAccessories,
  type CatalogItem,
  type UnitAccessory,
} from '../crm/accessories';
import type { Unit } from '../crm/inventory';
import { Icon } from './kit';

type Row = { key: string; price: string };

/**
 * ACCESSORIES on this unit: pick each part number and type its price. The
 * labor from your list is added for you; the ad shows each accessory's price
 * with labor and the total as equipped.
 */
export function AccessoriesEditor({ u }: { u: Unit }) {
  const catalog = useCatalog();
  const saved = useUnitAccessories()[u.id];
  const all = choices(catalog);
  const byKey = new Map(all.map((c) => [c.key, c]));
  const [rows, setRows] = useState<Row[] | null>(null);
  // Start from what's saved for this unit (once it has loaded).
  useEffect(() => {
    if (rows === null && saved !== undefined) setRows(saved.map((a) => ({ key: a.key, price: a.free ? '0' : String(a.price) })));
  }, [saved, rows]);
  const list = rows ?? (saved ?? []).map((a) => ({ key: a.key, price: a.free ? '0' : String(a.price) }));

  const toAccessories = (rs: Row[]): UnitAccessory[] =>
    rs
      .map((r) => {
        const c = byKey.get(r.key);
        if (!c) return null;
        const price = c.free ? 0 : Number(r.price.replace(/[$,\s]/g, ''));
        if (!c.free && !(price >= 0 && r.price.trim())) return null;
        return { key: c.key, part: c.part, description: c.description, price, labor: c.labor, ...(c.free ? { free: true } : {}) };
      })
      .filter((a): a is UnitAccessory => !!a);

  const update = (rs: Row[]) => {
    setRows(rs);
    void saveUnitAccessories(u.id, toAccessories(rs));
  };
  const set = (i: number, patch: Partial<Row>) => update(list.map((r, k) => (k === i ? { ...r, ...patch, ...(patch.key && byKey.get(patch.key)?.free ? { price: '0' } : {}) } : r)));

  const done = toAccessories(list);
  const extra = done.reduce((s, a) => s + installed(a), 0);

  return (
    <div className="stack tight accessories">
      <div className="row between">
        <h3>Accessories on this unit</h3>
        <CatalogUpload catalog={catalog} />
      </div>
      {!catalog.length && <p className="muted small">Upload your accessory labor list (the CSV) once to pick part numbers here. PassTime GPS works without it.</p>}
      {list.map((r, i) => {
        const c = byKey.get(r.key);
        return (
          <div className="row tight acc-row" key={i}>
            <select className="grow" value={r.key} onChange={(e) => set(i, { key: e.target.value })} aria-label={`Accessory ${i + 1} part number`}>
              <option value="">Pick a part number…</option>
              {all.map((o) => (
                <option key={o.key} value={o.key}>
                  {choiceLabel(o, all)}
                </option>
              ))}
            </select>
            <span className="muted">$</span>
            <input
              className="acc-price"
              inputMode="decimal"
              placeholder="Price"
              value={c?.free ? '0' : r.price}
              disabled={!!c?.free}
              onChange={(e) => set(i, { price: e.target.value })}
              aria-label={`Accessory ${i + 1} price`}
            />
            <span className="muted small acc-total" title="Your price plus the install labor from your list">
              {c && (c.free ? 'no charge' : r.price.trim() && Number(r.price.replace(/[$,\s]/g, '')) >= 0 ? `= ${money(installed({ price: Number(r.price.replace(/[$,\s]/g, '')), labor: c.labor }))} installed` : '')}
            </span>
            <button className="btn sm" onClick={() => update(list.filter((_, k) => k !== i))} aria-label={`Remove accessory ${i + 1}`} title="Remove">
              ×
            </button>
          </div>
        );
      })}
      <div className="row between">
        <button className="btn sm" disabled={list.length >= MAX_ACCESSORIES} onClick={() => update([...list, { key: '', price: '' }])}>
          <Icon name="plus" size={14} /> {list.length ? 'Add another accessory' : 'Add an accessory'}
        </button>
        {done.length > 0 && (
          <span className="small">
            Accessories {money(extra)}
            {u.price ? (
              <>
                {' '}
                · <strong>Total as equipped {money(u.price + extra)}</strong>
              </>
            ) : null}
          </span>
        )}
      </div>
      {done.length > 0 && (
        <details className="small">
          <summary className="muted">How it reads in the Facebook ad</summary>
          <pre className="mp-desc">{accessoryBlock(done, u.price)}</pre>
        </details>
      )}
    </div>
  );
}

function CatalogUpload({ catalog }: { catalog: CatalogItem[] }) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const load = async (f: File | undefined) => {
    if (!f) return;
    const r = readCatalog(await f.text());
    if ('error' in r) return setMsg({ ok: false, text: r.error });
    await saveCatalog(r.items);
    setMsg({ ok: true, text: `${r.items.length} accessories loaded${r.skipped.length ? ` (left out ${r.skipped.length} "unspecified" rows)` : ''}.` });
  };
  return (
    <span className="row tight small">
      {msg && <span className={msg.ok ? 'success' : 'error'}>{msg.text}</span>}
      <label className="link small" style={{ cursor: 'pointer' }}>
        {catalog.length ? `Accessory list: ${catalog.length} parts · replace` : 'Upload accessory labor list (CSV)'}
        <input type="file" accept=".csv,text/csv" hidden onChange={(e) => (void load(e.target.files?.[0]), (e.target.value = ''))} />
      </label>
    </span>
  );
}
