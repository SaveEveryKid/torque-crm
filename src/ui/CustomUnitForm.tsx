import { useState } from 'react';
import { customTitle, newCustomId, saveCustomUnit, type CustomUnit } from '../crm/customUnits';
import { Modal } from './kit';

const money = (v: string) => {
  const t = v.replace(/[$,\s]/g, '');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : NaN;
};

/**
 * NEW (OR EDIT) CUSTOM UNIT: a unit that isn't on the website yet. Type its
 * details; photos are added when you list it (Add your own photos).
 */
export function CustomUnitForm({ unit, onClose, onSaved }: { unit?: CustomUnit; onClose: () => void; onSaved: (c: CustomUnit) => void }) {
  const [f, setF] = useState({
    year: unit?.year ?? String(new Date().getFullYear() + (new Date().getMonth() >= 6 ? 1 : 0)),
    make: unit?.make ?? 'Polaris',
    model: unit?.model ?? '',
    condition: unit?.condition ?? ('New' as 'New' | 'Used'),
    type: unit?.type ?? '',
    color: unit?.color ?? '',
    price: unit?.price != null ? String(unit.price) : '',
    msrp: unit?.msrp != null ? String(unit.msrp) : '',
    stock: unit?.stock ?? '',
    vin: unit?.vin ?? '',
    miles: unit?.miles != null ? String(unit.miles) : '',
    about: unit?.about ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));

  const save = async () => {
    const price = money(f.price);
    const msrp = money(f.msrp);
    const miles = f.miles.trim() ? Number(f.miles.replace(/[,\s]/g, '')) : null;
    if (!f.model.trim()) return setError('Type the model (e.g. Ranger 500).');
    if (!/^\d{4}$/.test(f.year.trim())) return setError('Year should be four digits, like 2027.');
    if (Number.isNaN(price) || Number.isNaN(msrp)) return setError('Prices should be numbers, like 9999.');
    if (miles !== null && !(miles >= 0)) return setError('Miles should be a number.');
    const c: CustomUnit = {
      id: unit?.id ?? newCustomId(),
      year: f.year.trim(),
      make: f.make.trim(),
      model: f.model.trim(),
      condition: f.condition,
      type: f.type.trim(),
      color: f.color.trim(),
      price,
      msrp,
      stock: f.stock.trim(),
      vin: f.vin.trim().toUpperCase(),
      miles,
      about: f.about.trim(),
      createdAt: unit?.createdAt ?? new Date().toISOString(),
    };
    await saveCustomUnit(c);
    onSaved(c);
  };

  return (
    <Modal
      title={unit ? `Edit ${customTitle(unit)}` : 'New custom unit'}
      onClose={onClose}
      foot={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={() => void save()}>
            {unit ? 'Save' : 'Add unit'}
          </button>
        </>
      }
    >
      <div className="stack">
        <p className="muted small">A unit that isn’t on the website yet (on order, coming in). List it like any other; add its photos in the List window.</p>
        <div className="form-grid">
          <label className="field">
            Year
            <input value={f.year} onChange={set('year')} inputMode="numeric" maxLength={4} />
          </label>
          <label className="field">
            Make
            <input value={f.make} onChange={set('make')} />
          </label>
          <label className="field">
            Model
            <input value={f.model} onChange={set('model')} placeholder="Ranger 500" autoFocus />
          </label>
          <label className="field">
            Condition
            <select value={f.condition} onChange={(e) => setF((x) => ({ ...x, condition: e.target.value as 'New' | 'Used' }))}>
              <option>New</option>
              <option>Used</option>
            </select>
          </label>
          <label className="field">
            Price
            <input value={f.price} onChange={set('price')} inputMode="decimal" placeholder="9999" />
          </label>
          <label className="field">
            MSRP (optional)
            <input value={f.msrp} onChange={set('msrp')} inputMode="decimal" />
          </label>
          <label className="field">
            Color
            <input value={f.color} onChange={set('color')} placeholder="Stealth Gray" />
          </label>
          <label className="field">
            Type (optional)
            <input value={f.type} onChange={set('type')} placeholder="Regular Cab, ATV…" />
          </label>
          <label className="field">
            Stock # (optional)
            <input value={f.stock} onChange={set('stock')} />
          </label>
          <label className="field">
            VIN (optional)
            <input value={f.vin} onChange={set('vin')} maxLength={20} />
          </label>
          {f.condition === 'Used' && (
            <label className="field">
              Miles
              <input value={f.miles} onChange={set('miles')} inputMode="numeric" />
            </label>
          )}
        </div>
        <label className="field">
          About it (optional: a few words for the short description)
          <textarea rows={2} value={f.about} onChange={set('about')} placeholder="e.g. Work-ready mid-size utility side-by-side with a dump box and winch." />
        </label>
        {error && <p className="error">{error}</p>}
      </div>
    </Modal>
  );
}
