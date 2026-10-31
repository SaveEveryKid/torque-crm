import { useState } from 'react';
import { download } from '../crm/backup';
import { customersCsv } from '../crm/csvImport';
import { removeDrafts } from '../crm/predraft';
import { deleteCustomers } from '../crm/store';
import type { Customer } from '../crm/types';
import { Icon, Modal } from './kit';

/**
 * DELETE CUSTOMERS: everyone the list is showing (all of them with no
 * filters). Permanent, so you type DELETE first, and can download them as a
 * CSV (re-importable) before you do.
 */
export function DeleteCustomers({ list, everyone, onClose, onDone }: { list: Customer[]; everyone: boolean; onClose: () => void; onDone: (msg: string) => void }) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const n = list.length;

  const run = async () => {
    setBusy(true);
    const ids = list.map((c) => c.id);
    await deleteCustomers(ids);
    await removeDrafts(ids);
    onDone(`Deleted ${n} customer${n === 1 ? '' : 's'}.`);
    onClose();
  };

  return (
    <Modal
      title={everyone ? `Delete all ${n} customers?` : `Delete the ${n} customers in this list?`}
      onClose={onClose}
      foot={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary danger-fill" disabled={busy || typed.trim().toUpperCase() !== 'DELETE' || !n} onClick={() => void run()}>
            <Icon name="trash" size={16} /> {busy ? 'Deleting…' : `Delete ${n}`}
          </button>
        </>
      }
    >
      <div className="stack">
        <p>
          {everyone ? 'Every customer in the CRM' : 'Everyone the list is showing right now (your filters and stage tab)'} is deleted, with their timeline, tasks and pre-written drafts.{' '}
          <strong>This can't be undone.</strong>
        </p>
        <div className="row">
          <button
            className="btn sm"
            onClick={() => {
              download(`torque-customers-${new Date().toISOString().slice(0, 10)}.csv`, customersCsv(list), 'text/csv');
              setSaved(true);
            }}
          >
            <Icon name="download" size={14} /> Download them first (CSV)
          </button>
          {saved && <span className="small success-text">Saved. You can import that file again later.</span>}
        </div>
        <label className="field">
          Type DELETE to confirm
          <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="DELETE" autoFocus />
        </label>
      </div>
    </Modal>
  );
}
