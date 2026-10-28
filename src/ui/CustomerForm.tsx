import { useState } from 'react';
import { normalizeUsPhone } from '../core/analysis/phone';
import { addCustomer, blankCustomer, formatPhone, updateCustomer } from '../crm/store';
import { STAGES, type Customer } from '../crm/types';
import { Modal } from './kit';

/** New customer, or edit one. */
export function CustomerForm({ customer, onClose, onSaved }: { customer?: Customer; onClose: () => void; onSaved?: (c: Customer) => void }) {
  const [c, setC] = useState<Customer>(customer ?? blankCustomer());
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof Customer>(k: K, v: Customer[K]) => setC((x) => ({ ...x, [k]: v }));

  const save = async () => {
    if (!c.firstName.trim() && !c.lastName.trim()) return setError('Add a name.');
    if (c.phone.trim() && !normalizeUsPhone(c.phone).ok) return setError("That phone number doesn't look right (10 digits).");
    if (customer) {
      await updateCustomer(c.id, { ...c, phone: formatPhone(c.phone), altPhone: c.altPhone ? formatPhone(c.altPhone) : '' });
      onSaved?.(c);
    } else onSaved?.(await addCustomer(c));
    onClose();
  };

  return (
    <Modal
      title={customer ? 'Edit customer' : 'New customer'}
      onClose={onClose}
      foot={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={() => void save()}>
            {customer ? 'Save' : 'Add customer'}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <label className="field">
          First name
          <input value={c.firstName} onChange={(e) => set('firstName', e.target.value)} autoFocus />
        </label>
        <label className="field">
          Last name
          <input value={c.lastName} onChange={(e) => set('lastName', e.target.value)} />
        </label>
        <label className="field">
          Phone
          <input value={c.phone} onChange={(e) => set('phone', e.target.value)} inputMode="tel" placeholder="(256) 555-1234" />
        </label>
        <label className="field">
          Other phone
          <input value={c.altPhone} onChange={(e) => set('altPhone', e.target.value)} inputMode="tel" />
        </label>
        <label className="field">
          Email
          <input value={c.email} onChange={(e) => set('email', e.target.value)} type="email" />
        </label>
        <label className="field">
          Stage
          <select value={c.stage} onChange={(e) => set('stage', e.target.value as Customer['stage'])}>
            {STAGES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field full">
          Looking for
          <input value={c.interest} onChange={(e) => set('interest', e.target.value)} placeholder="e.g. side-by-side for hunting, under $15k" />
        </label>
        <label className="field">
          Trade
          <input value={c.trade} onChange={(e) => set('trade', e.target.value)} placeholder="e.g. 2018 Rancher 420" />
        </label>
        <label className="field">
          Source
          <input value={c.source} onChange={(e) => set('source', e.target.value)} placeholder="Walk-in, website, referral…" />
        </label>
        <label className="field full">
          Address
          <input value={c.address} onChange={(e) => set('address', e.target.value)} />
        </label>
        <label className="field full">
          Notes
          <textarea rows={3} value={c.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Anything worth remembering. Claude reads these when it drafts." />
        </label>
        <label className="check">
          <input type="checkbox" checked={c.doNotText} onChange={(e) => set('doNotText', e.target.checked)} /> Do not text
        </label>
        <label className="check">
          <input type="checkbox" checked={c.doNotContact} onChange={(e) => set('doNotContact', e.target.checked)} /> Do not contact
        </label>
      </div>
      {error && <p className="error">{error}</p>}
    </Modal>
  );
}
