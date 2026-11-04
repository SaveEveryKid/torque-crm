import { useEffect, useState } from 'react';
import { accessoryBlock, installed, isGps, MAX_ACCESSORIES, money, saveUnitAccessories, useUnitAccessories, type UnitAccessory } from '../crm/accessories';
import type { Unit } from '../crm/inventory';
import { Icon } from './kit';

type Row = { id: string; name: string; cost: string; labor: string };

const newId = () => `acc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const dollars = (v: string) => {
  const t = v.replace(/[$,\s]/g, '');
  if (!t) return 0;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : NaN;
};
const fromSaved = (a: UnitAccessory): Row => ({ id: a.key || newId(), name: a.description, cost: a.free ? '0' : String(a.price), labor: String(a.labor) });

/**
 * ACCESSORIES on this unit: type each one's name, cost and install labor.
 * The ad lists the names, then the total as equipped (unit + every cost and
 * labor); prices and labor per item are never shown.
 */
export function AccessoriesEditor({ u }: { u: Unit }) {
  const saved = useUnitAccessories()[u.id];
  const [rows, setRows] = useState<Row[] | null>(null);
  // Start from what's saved for this unit (once it has loaded).
  useEffect(() => {
    if (rows === null && saved !== undefined) setRows(saved.map(fromSaved));
  }, [saved, rows]);
  const list = rows ?? (saved ?? []).map(fromSaved);

  const toAccessories = (rs: Row[]): UnitAccessory[] =>
    rs
      .map((r) => {
        const name = r.name.trim();
        const price = dollars(r.cost);
        const labor = dollars(r.labor);
        if (!name || !(price >= 0) || !(labor >= 0)) return null;
        return { key: r.id, part: '', description: name, price, labor };
      })
      .filter((a): a is UnitAccessory => !!a);

  const update = (rs: Row[]) => {
    setRows(rs);
    void saveUnitAccessories(u.id, toAccessories(rs));
  };
  const set = (i: number, patch: Partial<Row>) => update(list.map((r, k) => (k === i ? { ...r, ...patch } : r)));

  const done = toAccessories(list);
  const extra = done.filter((a) => !isGps(a)).reduce((s, a) => s + installed(a), 0);

  return (
    <div className="stack tight accessories">
      <h3>Accessories on this unit</h3>
      {list.length > 0 && (
        <div className="row tight acc-head muted small">
          <span className="grow">Accessory</span>
          <span className="acc-num">Cost</span>
          <span className="acc-num">Labor</span>
          <span className="acc-total" />
          <span className="acc-x" />
        </div>
      )}
      {list.map((r, i) => {
        const cost = dollars(r.cost);
        const labor = dollars(r.labor);
        const bad = (r.cost.trim() && !(cost >= 0)) || (r.labor.trim() && !(labor >= 0));
        return (
          <div className="row tight acc-row" key={r.id}>
            <input className="grow" placeholder="e.g. Ranger Roof" value={r.name} onChange={(e) => set(i, { name: e.target.value })} aria-label={`Accessory ${i + 1} name`} />
            <span className="acc-num row tight">
              <span className="muted">$</span>
              <input inputMode="decimal" placeholder="0" value={r.cost} onChange={(e) => set(i, { cost: e.target.value })} aria-label={`Accessory ${i + 1} cost`} />
            </span>
            <span className="acc-num row tight">
              <span className="muted">$</span>
              <input inputMode="decimal" placeholder="0" value={r.labor} onChange={(e) => set(i, { labor: e.target.value })} aria-label={`Accessory ${i + 1} labor`} />
            </span>
            <span className="muted small acc-total">{bad ? <span className="error-text">numbers only</span> : r.name.trim() ? `= ${money(installed({ price: cost, labor }))}` : ''}</span>
            <button className="btn sm acc-x" onClick={() => update(list.filter((_, k) => k !== i))} aria-label={`Remove accessory ${i + 1}`} title="Remove">
              ×
            </button>
          </div>
        );
      })}
      <div className="row between">
        <button className="btn sm" disabled={list.length >= MAX_ACCESSORIES} onClick={() => update([...list, { id: newId(), name: '', cost: '', labor: '' }])}>
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
          <pre className="mp-desc">{accessoryBlock(done, u.price) || 'Nothing to list (GPS is never mentioned in the ad).'}</pre>
        </details>
      )}
    </div>
  );
}
