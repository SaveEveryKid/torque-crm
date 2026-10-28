import { useMemo, useState } from 'react';
import { fullName, lastContact, setStage, useCustomers } from '../crm/store';
import { STAGES, type Stage } from '../crm/types';
import { money } from '../crm/inventory';
import { ago, go } from '../ui/kit';

/** Drag a customer to another column to move their stage. */
export function Pipeline() {
  const customers = useCustomers();
  const list = useMemo(() => Object.values(customers), [customers]);
  const [over, setOver] = useState<Stage | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  const stages = STAGES.filter((s) => showClosed || !['sold', 'lost'].includes(s.id));
  const month = new Date().toISOString().slice(0, 7);

  return (
    <div className="page" style={{ maxWidth: 'none' }}>
      <div className="page-head">
        <div>
          <h1>Pipeline</h1>
          <p>Drag a card to move a customer along.</p>
        </div>
        <label className="check">
          <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> Show Sold and Lost
        </label>
      </div>
      <div className="board">
        {stages.map((s) => {
          const cards = list
            .filter((c) => c.stage === s.id && (!['sold', 'lost'].includes(s.id) || c.updatedAt.startsWith(month)))
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
          return (
            <div
              key={s.id}
              className={`col${over === s.id ? ' over' : ''}`}
              onDragOver={(e) => (e.preventDefault(), setOver(s.id))}
              onDragLeave={() => setOver(null)}
              onDrop={(e) => {
                e.preventDefault();
                setOver(null);
                const id = e.dataTransfer.getData('text/plain');
                if (id) void setStage(id, s.id, s.label);
              }}
            >
              <div className="col-head">
                <span>{s.label}</span>
                <span className="muted small">{cards.length}{['sold', 'lost'].includes(s.id) ? ' this month' : ''}</span>
              </div>
              <div className="col-body">
                {cards.map((c) => (
                  <div key={c.id} className="deal" draggable onDragStart={(e) => e.dataTransfer.setData('text/plain', c.id)} onClick={() => go(`customers/${c.id}`)}>
                    <div className="name">{fullName(c)}</div>
                    <div className="line">{c.vehicle ? `${c.vehicle.title} · ${money(c.vehicle.price)}` : c.interest || c.phone}</div>
                    <div className="line">Contact {ago(lastContact(c))}</div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
