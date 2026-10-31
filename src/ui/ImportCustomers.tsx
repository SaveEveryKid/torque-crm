import { useMemo, useRef, useState } from 'react';
import { readTorqueData } from '../core/analysis/customExport';
import { FIELDS, SAMPLE_CSV, guessMapping, planImport, readSheet, type Field, type Sheet } from '../crm/csvImport';
import { importCustomers } from '../crm/store';
import { STAGES, type Customer, type Stage } from '../crm/types';
import { Icon, Modal } from './kit';

/**
 * IMPORT CUSTOMERS: pick a CSV, check which column is which, see what will
 * happen, then import. Nothing is saved until you press Import.
 */
export function ImportCustomers({ existing, onClose, onDone }: { existing: Customer[]; onClose: () => void; onDone: (msg: string) => void }) {
  const [file, setFile] = useState<{ name: string; text: string; sheet: Sheet } | null>(null);
  const [mapping, setMapping] = useState<Field[]>([]);
  const [stage, setStage] = useState<Stage>('new');
  const [source, setSource] = useState('');
  const [fillExisting, setFillExisting] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const open = async (f: File | undefined) => {
    if (!f) return;
    setError(null);
    const text = await f.text();
    const sheet = readSheet(text);
    if ('error' in sheet) return setError(sheet.error);
    setFile({ name: f.name, text, sheet });
    setMapping(guessMapping(sheet.headers));
    setSource(`Import: ${f.name.replace(/\.csv$/i, '')}`);
  };

  const torque = useMemo(() => (file ? readTorqueData(file.text) : new Map()), [file]);
  const plan = useMemo(
    () => (file ? planImport(file.sheet, mapping, existing, { fileName: file.name, stage, source: source.trim(), fillExisting }, torque) : null),
    [file, mapping, existing, stage, source, fillExisting, torque],
  );
  const hasWho = mapping.some((m) => ['fullName', 'firstName', 'lastName', 'company'].includes(m));
  const hasReach = mapping.some((m) => ['phone', 'altPhone', 'email'].includes(m));

  const run = async () => {
    if (!plan) return;
    setBusy(true);
    try {
      await importCustomers(plan.add, plan.update);
      const n = plan.add.length;
      onDone(
        [
          `Imported ${n} customer${n === 1 ? '' : 's'}${plan.withHistory ? ` (${plan.withHistory} with their eLead history)` : ''}.`,
          plan.update.length && `Filled in details on ${plan.update.length} already here.`,
          plan.unchanged && `${plan.unchanged} already here were left alone.`,
          plan.repeats && `${plan.repeats} rows were the same person again and were merged.`,
          plan.skipped.length && `${plan.skipped.length} skipped (no way to reach them).`,
        ]
          .filter(Boolean)
          .join(' '),
      );
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const sample = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([SAMPLE_CSV], { type: 'text/csv' }));
    a.download = 'torque-customers-sample.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <Modal
      wide
      title="Import customers"
      onClose={onClose}
      foot={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          {plan && (
            <button className="btn primary" disabled={busy || !hasWho || !hasReach || (!plan.add.length && !plan.update.length)} onClick={() => void run()}>
              <Icon name="upload" size={16} />{' '}
              {busy ? 'Importing…' : `Import ${plan.add.length} customer${plan.add.length === 1 ? '' : 's'}${plan.update.length ? ` + update ${plan.update.length}` : ''}`}
            </button>
          )}
        </>
      }
    >
      <input ref={input} type="file" accept=".csv,text/csv" hidden onChange={(e) => void open(e.target.files?.[0])} />
      {!file ? (
        <div className="stack">
          <div
            className={`dropzone${drag ? ' on' : ''}`}
            onClick={() => input.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              void open(e.dataTransfer.files[0]);
            }}
          >
            <Icon name="upload" size={28} />
            <strong>Choose a CSV file</strong>
            <span className="soft small">or drop it here. From Excel or Google Sheets: File → Save as / Download → CSV.</span>
          </div>
          <p className="muted small">
            Any column names work: you'll check which column is which before anything is saved. Each row needs a name (or business name) and a phone or email.{' '}
            <button className="link small" onClick={sample}>
              Download a sample
            </button>
          </p>
        </div>
      ) : (
        <div className="stack">
          <div className="row between">
            <div>
              <strong>{file.name}</strong> <span className="soft">· {file.sheet.rows.length} rows</span>
            </div>
            <button className="btn sm" onClick={() => input.current?.click()}>
              Choose another file
            </button>
          </div>

          <div className="import-map">
            <div className="import-map-head">
              <span>Column in your file</span>
              <span>Example</span>
              <span>Goes into</span>
            </div>
            {file.sheet.headers.map((h, i) => {
              const ex = file.sheet.rows.map((r) => r.cells[i]?.trim()).find(Boolean) ?? '';
              return (
                <div key={i} className={`import-map-row${mapping[i] === 'ignore' ? ' off' : ''}`}>
                  <span className="strong">{h || `Column ${i + 1}`}</span>
                  <span className="soft small ellipsis" title={ex}>
                    {ex || '—'}
                  </span>
                  <select value={mapping[i]} aria-label={`What is ${h}?`} onChange={(e) => setMapping((m) => m.map((x, j) => (j === i ? (e.target.value as Field) : x)))}>
                    {FIELDS.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>
          {!hasWho && <p className="error">Pick which column has the name (or business name).</p>}
          {!hasReach && <p className="error">Pick which column has the phone (or email).</p>}

          <div className="form-grid">
            <label className="field">
              Stage for everyone (unless the file has one)
              <select value={stage} onChange={(e) => setStage(e.target.value as Stage)}>
                {STAGES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Source (unless the file has one)
              <input value={source} onChange={(e) => setSource(e.target.value)} placeholder="e.g. Commercial list, Oct 2026" />
            </label>
            <label className="check full">
              <input type="checkbox" checked={fillExisting} onChange={(e) => setFillExisting(e.target.checked)} /> Customers already here: fill in anything they're missing (never
              overwrites what you have)
            </label>
          </div>

          {plan && hasWho && hasReach && (
            <>
              <div className="import-summary">
                <div>
                  <b>{plan.add.length}</b> new
                </div>
                <div>
                  <b>{plan.update.length}</b> already here, will fill in
                </div>
                <div>
                  <b>{plan.unchanged}</b> already here, no change
                </div>
                <div>
                  <b>{plan.repeats}</b> repeats merged
                </div>
                <div>
                  <b>{plan.skipped.length}</b> skipped
                </div>
              </div>
              {plan.add.length > 0 && (
                <table className="table compact">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Business</th>
                      <th>Phone</th>
                      <th>Email</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.add.slice(0, 6).map((c) => (
                      <tr key={c.id}>
                        <td>{`${c.firstName} ${c.lastName}`.trim() || <span className="muted">(business)</span>}</td>
                        <td className="soft">{[c.company, c.title].filter(Boolean).join(' · ') || '—'}</td>
                        <td className="nowrap">{c.phone || '—'}</td>
                        <td className="soft">{c.email || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {plan.add.length > 6 && <p className="muted small">…and {plan.add.length - 6} more.</p>}
              {plan.skipped.length > 0 && (
                <details>
                  <summary className="small soft">Why {plan.skipped.length} row{plan.skipped.length === 1 ? ' was' : 's were'} skipped</summary>
                  <ul className="small soft">
                    {plan.skipped.slice(0, 50).map((s) => (
                      <li key={s.line}>
                        Line {s.line}: {s.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {plan.update.length > 0 && (
                <details>
                  <summary className="small soft">Who gets filled in</summary>
                  <ul className="small soft">
                    {plan.update.slice(0, 50).map((u) => (
                      <li key={u.id}>
                        {u.name}: {Object.keys(u.patch).join(', ')}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {plan.oddPhones > 0 && <p className="notice">{plan.oddPhones} phone numbers aren't a normal 10-digit US number. They're kept as written; check them before dialing.</p>}
            </>
          )}
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </Modal>
  );
}

